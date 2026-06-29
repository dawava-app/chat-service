import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Inject,
  forwardRef,
  InternalServerErrorException,
} from '@nestjs/common';
import { FileServiceClient } from './file-service.client';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConversationsService } from '../conversations/conversations.service';
import { UsersService } from '../users/users.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { PresenceService } from '../presence/presence.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { WebhookEventType } from '../webhooks/enums/webhook-event-type.enum';
import { EditMessageDto } from './dto/edit-message.dto';
import { QueryMessagesDto } from './dto/query-messages.dto';
import { SendMessageDto } from './dto/send-message.dto';
import {
  Message,
  MessageDocument,
  MessageType,
  Reaction,
  ReadReceipt,
} from './schemas/message.schema';

export type MessageWithSender = Omit<Message, 'reactions' | 'readBy'> & {
  sender: {
    externalUserId: string;
    displayName?: string;
    avatarUrl?: string;
  } | null;
  reactions?: Array<{
    emoji: string;
    userIds: string[];
    count: number;
    hasReacted?: boolean;
  }>;
  readBy?: Array<{ userId: string; readAt: Date }>;
  readCount?: number;
  isReadByMe?: boolean;
};

export interface ReplyPreview {
  _id: Types.ObjectId;
  content: string;
  senderId: string;
  sender: {
    displayName?: string;
  } | null;
}

export interface MessageWithSenderAndReply extends MessageWithSender {
  replyToMessage?: ReplyPreview | null;
}

export interface MessagesPage {
  data: MessageWithSender[];
  pagination: {
    hasMore: boolean;
    oldestId: string | null;
    newestId: string | null;
  };
}

@Injectable()
export class MessagesService {
  constructor(
    @InjectModel(Message.name)
    private readonly messageModel: Model<MessageDocument>,
    private readonly conversationsService: ConversationsService,
    private readonly usersService: UsersService,
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway?: ChatGateway,
    @Inject(forwardRef(() => PresenceService))
    private readonly presenceService?: PresenceService,
    private readonly webhooksService?: WebhooksService,
    private readonly fileServiceClient?: FileServiceClient,
  ) {}

  async send(
    conversationId: string,
    senderId: string,
    dto: SendMessageDto,
  ): Promise<MessageWithSender> {
    const conversation = await this.conversationsService.findById(conversationId);
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const isParticipant = conversation.participants.some(
      (participant) => participant.externalUserId === senderId,
    );

    if (!isParticipant) {
      throw new ForbiddenException('Not a participant in this conversation');
    }

    if (dto.replyTo) {
      const parentMessage = await this.messageModel.findOne({
        _id: dto.replyTo,
        conversationId: new Types.ObjectId(conversationId),
        isDeleted: false,
      });

      if (!parentMessage) {
        throw new BadRequestException('Reply target message not found');
      }
    }

    if (dto.attachments && dto.attachments.length > 0) {
      if (!this.fileServiceClient) {
        throw new InternalServerErrorException('File service is not configured.');
      }
      const fileIds = dto.attachments.map((att) => att.externalFileId);
      await this.fileServiceClient.commitFiles(fileIds);
    }

    const message = await this.messageModel.create({
      conversationId: new Types.ObjectId(conversationId),
      senderId,
      content: dto.content,
      type: MessageType.Text,
      attachments: dto.attachments ?? [],
      replyTo: dto.replyTo ? new Types.ObjectId(dto.replyTo) : undefined,
      metadata: dto.metadata ?? {},
    });

    await this.conversationsService.updateLastMessage(conversationId, {
      messageId: message._id.toString(),
      content: this.truncateContent(message.content, 100),
      senderId: message.senderId,
      sentAt: message.createdAt ?? new Date(),
    });

    const populatedForSender = await this.populateMessageWithSender(message, senderId);
    const broadcastPayload = await this.populateMessageWithSender(message);
    this.chatGateway?.emitToConversation(conversationId, 'message:new', broadcastPayload);
    await this.webhooksService?.emitEvent(WebhookEventType.MESSAGE_CREATED, {
      messageId: message._id.toString(),
      conversationId,
      conversationType: conversation.type,
      senderId: message.senderId,
      content: message.content,
      contentPreview: this.truncateContent(message.content, 100),
      createdAt: message.createdAt ?? new Date(),
      type: message.type,
    });
    await this.presenceService?.updateActivity(senderId);
    return populatedForSender;
  }

  async createSystemMessage(
    conversationId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<MessageWithSender> {
    const conversation = await this.conversationsService.findById(conversationId);
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const message = await this.messageModel.create({
      conversationId: new Types.ObjectId(conversationId),
      senderId: 'system',
      content,
      type: MessageType.System,
      attachments: [],
      metadata: metadata ?? {},
    });

    await this.conversationsService.updateLastMessage(conversationId, {
      messageId: message._id.toString(),
      content: this.truncateContent(message.content, 100),
      senderId: message.senderId,
      sentAt: message.createdAt ?? new Date(),
    });

    const populated = await this.populateMessageWithSender(message);
    this.chatGateway?.emitToConversation(conversationId, 'message:new', populated);
    await this.webhooksService?.emitEvent(WebhookEventType.MESSAGE_CREATED, {
      messageId: message._id.toString(),
      conversationId,
      senderId: message.senderId,
      content: message.content,
      contentPreview: this.truncateContent(message.content, 100),
      createdAt: message.createdAt ?? new Date(),
      type: message.type,
    });
    return populated;
  }

  async findByConversation(
    conversationId: string,
    query: QueryMessagesDto,
    currentUserId?: string,
  ): Promise<MessagesPage> {
    if (query.before && query.after) {
      throw new BadRequestException('before and after cannot be provided together');
    }

    const limit = query.limit ?? 50;
    const filter: Record<string, unknown> = {
      conversationId: new Types.ObjectId(conversationId),
    };

    if (!query.includeDeleted) {
      filter.isDeleted = false;
    }

    if (query.before) {
      filter._id = { $lt: new Types.ObjectId(query.before) };
    } else if (query.after) {
      filter._id = { $gt: new Types.ObjectId(query.after) };
    }

    const sortDirection = query.after ? 1 : -1;

    let messages = await this.messageModel
      .find(filter)
      .sort({ _id: sortDirection })
      .limit(limit + 1)
      .lean();

    if (query.includeDeleted) {
      messages.forEach((message) => {
        if (message.isDeleted) {
          message.content = '';
          message.attachments = [];
        }
      });
    }

    const hasMore = messages.length > limit;
    if (hasMore) {
      messages = messages.slice(0, limit);
    }

    const oldest = messages.length > 0 ? messages[messages.length - 1] : null;
    const newest = messages.length > 0 ? messages[0] : null;

    if (sortDirection === 1) {
      // Ascending: oldest first, newest last
      return {
        data: await this.populateMessages(messages, currentUserId),
        pagination: {
          hasMore,
          oldestId: messages.length > 0 ? messages[0]._id.toString() : null,
          newestId: messages.length > 0 ? messages[messages.length - 1]._id.toString() : null,
        },
      };
    }

    return {
      data: await this.populateMessages(messages, currentUserId),
      pagination: {
        hasMore,
        oldestId: oldest ? oldest._id.toString() : null,
        newestId: newest ? newest._id.toString() : null,
      },
    };
  }

  async findById(messageId: string): Promise<Message | null> {
    return this.messageModel.findById(messageId).exec();
  }

  async edit(messageId: string, userId: string, dto: EditMessageDto): Promise<MessageWithSender> {
    const message = await this.messageModel.findById(messageId);
    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (message.isDeleted) {
      throw new BadRequestException('Cannot edit deleted message');
    }

    if (message.senderId !== userId) {
      throw new ForbiddenException('Can only edit your own messages');
    }

    message.content = dto.content;
    message.isEdited = true;
    await message.save();

    await this.updateLastMessageIfNeeded(message);

    const populated = await this.populateMessageWithSender(message, userId);
    this.chatGateway?.emitToConversation(message.conversationId.toString(), 'message:updated', {
      messageId: message._id.toString(),
      content: message.content,
      isEdited: message.isEdited,
      updatedAt: message.updatedAt,
    });
    await this.webhooksService?.emitEvent(WebhookEventType.MESSAGE_UPDATED, {
      messageId: message._id.toString(),
      conversationId: message.conversationId.toString(),
      senderId: message.senderId,
      content: message.content,
      contentPreview: this.truncateContent(message.content, 100),
      updatedAt: message.updatedAt ?? new Date(),
    });
    await this.presenceService?.updateActivity(userId);

    return populated;
  }

  async delete(messageId: string, userId: string): Promise<{ deleted: true }> {
    const message = await this.messageModel.findById(messageId);
    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (message.isDeleted) {
      throw new BadRequestException('Message already deleted');
    }

    if (message.senderId !== userId) {
      throw new ForbiddenException('Can only delete your own messages');
    }

    message.isDeleted = true;
    message.deletedAt = new Date();
    await message.save();

    await this.recalculateLastMessage(message.conversationId.toString());
    this.chatGateway?.emitToConversation(message.conversationId.toString(), 'message:deleted', {
      messageId: message._id.toString(),
      conversationId: message.conversationId.toString(),
      deletedAt: message.deletedAt.toISOString(),
    });
    await this.webhooksService?.emitEvent(WebhookEventType.MESSAGE_DELETED, {
      messageId: message._id.toString(),
      conversationId: message.conversationId.toString(),
      senderId: message.senderId,
      deletedAt: message.deletedAt,
    });
    await this.presenceService?.updateActivity(userId);

    return { deleted: true };
  }

  async hardDelete(messageId: string): Promise<void> {
    const message = await this.messageModel.findById(messageId);
    if (!message) {
      throw new NotFoundException('Message not found');
    }

    const conversationId = message.conversationId.toString();
    await message.deleteOne();

    await this.recalculateLastMessage(conversationId);
    this.chatGateway?.emitToConversation(conversationId, 'message:deleted', {
      messageId: message._id.toString(),
      conversationId,
      deletedAt: new Date().toISOString(),
    });
    await this.webhooksService?.emitEvent(WebhookEventType.MESSAGE_DELETED, {
      messageId: message._id.toString(),
      conversationId,
      senderId: message.senderId,
      deletedAt: new Date(),
    });
  }

  async getContext(messageId: string, count: number): Promise<MessageWithSenderAndReply[]> {
    const target = await this.messageModel.findById(messageId).lean();
    if (!target) {
      throw new NotFoundException('Message not found');
    }

    const beforeCount = Math.floor((count - 1) / 2);
    const afterCount = Math.max(count - 1 - beforeCount, 0);

    const beforeMessages = await this.messageModel
      .find({
        conversationId: target.conversationId,
        _id: { $lt: target._id },
      })
      .sort({ _id: -1 })
      .limit(beforeCount)
      .lean();

    const afterMessages = await this.messageModel
      .find({
        conversationId: target.conversationId,
        _id: { $gt: target._id },
      })
      .sort({ _id: 1 })
      .limit(afterCount)
      .lean();

    const combined = [...beforeMessages.reverse(), target, ...afterMessages];
    const withSender = await this.populateMessages(combined);
    return this.attachReplyContext(withSender);
  }

  async populateReplyPreview(message: MessageWithSender): Promise<MessageWithSenderAndReply> {
    if (!message.replyTo) {
      return { ...message, replyToMessage: undefined };
    }

    const parent = await this.messageModel.findById(message.replyTo).lean();
    if (!parent || parent.isDeleted) {
      return { ...message, replyToMessage: null };
    }

    const profile = await this.usersService.findByExternalId(parent.senderId);

    return {
      ...message,
      replyToMessage: {
        _id: parent._id,
        content: this.truncateContent(parent.content, 50),
        senderId: parent.senderId,
        sender: profile ? { displayName: profile.displayName } : null,
      },
    };
  }

  private truncateContent(content: string, maxLength: number = 100): string {
    if (content.length <= maxLength) {
      return content;
    }
    return `${content.substring(0, maxLength - 3)}...`;
  }

  private async updateLastMessageIfNeeded(message: MessageDocument): Promise<void> {
    const conversation = await this.conversationsService.findById(
      message.conversationId.toString(),
    );
    if (!conversation?.lastMessage?.messageId) {
      return;
    }

    if (conversation.lastMessage.messageId === message._id.toString()) {
      await this.conversationsService.updateLastMessage(message.conversationId.toString(), {
        messageId: message._id.toString(),
        content: this.truncateContent(message.content, 100),
        senderId: message.senderId,
        sentAt: message.createdAt ?? new Date(),
      });
    }
  }

  private async recalculateLastMessage(conversationId: string): Promise<void> {
    const lastMessage = await this.messageModel
      .findOne({
        conversationId: new Types.ObjectId(conversationId),
        isDeleted: false,
      })
      .sort({ _id: -1 });

    if (lastMessage) {
      await this.conversationsService.updateLastMessage(conversationId, {
        messageId: lastMessage._id.toString(),
        content: this.truncateContent(lastMessage.content, 100),
        senderId: lastMessage.senderId,
        sentAt: lastMessage.createdAt ?? new Date(),
      });
      return;
    }

    await this.conversationsService.clearLastMessage(conversationId);
  }

  async populateMessageWithSender(
    message: MessageDocument | Message,
    currentUserId?: string,
  ): Promise<MessageWithSender> {
    const plain =
      typeof (message as any).toObject === 'function' ? (message as any).toObject() : message;
    const profile = await this.usersService.findByExternalId(plain.senderId);

    return {
      ...this.applyReactionAndReadMeta(plain, currentUserId),
      sender: profile
        ? {
            externalUserId: profile.externalUserId,
            displayName: profile.displayName,
            avatarUrl: profile.avatarUrl,
          }
        : null,
    } as MessageWithSender;
  }

  private async populateMessages(
    messages: Message[],
    currentUserId?: string,
  ): Promise<MessageWithSender[]> {
    if (!messages.length) {
      return [];
    }

    const senderIds = Array.from(new Set(messages.map((message) => message.senderId)));
    const profiles = await this.usersService.findManyByExternalIds(senderIds);
    const profileMap = new Map(profiles.map((profile) => [profile.externalUserId, profile]));

    return messages.map((message) => {
      const profile = profileMap.get(message.senderId);
      return {
        ...this.applyReactionAndReadMeta(message, currentUserId),
        sender: profile
          ? {
              externalUserId: profile.externalUserId,
              displayName: profile.displayName,
              avatarUrl: profile.avatarUrl,
            }
          : null,
      } as MessageWithSender;
    });
  }

  private applyReactionAndReadMeta(
    message: Message,
    currentUserId?: string,
  ): Message & {
    reactions?: Array<{ emoji: string; userIds: string[]; count: number; hasReacted?: boolean }>;
    readBy?: Array<{ userId: string; readAt: Date }>;
    readCount?: number;
    isReadByMe?: boolean;
  } {
    const reactions = (message.reactions ?? []).map((reaction: Reaction) => ({
      emoji: reaction.emoji,
      userIds: reaction.userIds ?? [],
      count: reaction.userIds?.length ?? 0,
      ...(currentUserId ? { hasReacted: reaction.userIds?.includes(currentUserId) ?? false } : {}),
    }));

    const readBy = (message.readBy ?? []).map((entry: ReadReceipt) => ({
      userId: entry.userId,
      readAt: entry.readAt,
    }));

    return {
      ...message,
      reactions,
      readBy,
      readCount: readBy.length,
      ...(currentUserId
        ? { isReadByMe: readBy.some((entry) => entry.userId === currentUserId) }
        : {}),
    };
  }

  private async attachReplyContext(
    messages: MessageWithSender[],
  ): Promise<MessageWithSenderAndReply[]> {
    const replyIds = messages
      .map((message) => message.replyTo)
      .filter((id): id is Types.ObjectId => Boolean(id));

    if (!replyIds.length) {
      return messages as MessageWithSenderAndReply[];
    }

    const parents = await this.messageModel.find({ _id: { $in: replyIds } }).lean();

    const parentMap = new Map(parents.map((parent) => [parent._id.toString(), parent]));
    const senderIds = Array.from(new Set(parents.map((parent) => parent.senderId)));
    const profiles = await this.usersService.findManyByExternalIds(senderIds);
    const profileMap = new Map(profiles.map((profile) => [profile.externalUserId, profile]));

    return messages.map((message) => {
      if (!message.replyTo) {
        return { ...message, replyToMessage: undefined };
      }

      const parent = parentMap.get(message.replyTo.toString());
      if (!parent || parent.isDeleted) {
        return { ...message, replyToMessage: null };
      }

      const profile = profileMap.get(parent.senderId);
      return {
        ...message,
        replyToMessage: {
          _id: parent._id,
          content: this.truncateContent(parent.content, 50),
          senderId: parent.senderId,
          sender: profile ? { displayName: profile.displayName } : null,
        },
      };
    });
  }
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { AddParticipantDto } from './dto/add-participant.dto';
import { UpdateParticipantRoleDto } from './dto/update-participant-role.dto';
import { QueryConversationsDto } from './dto/query-conversations.dto';
import {
  Conversation,
  ConversationDocument,
  ConversationType,
  LastMessage,
} from './schemas/conversation.schema';
import { Participant, ParticipantRole } from './schemas/participant.schema';
import { ChatGateway } from '../gateway/chat.gateway';
import { ReadReceiptsService } from '../read-receipts/read-receipts.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { WebhookEventType } from '../webhooks/enums/webhook-event-type.enum';

export interface PaginatedConversations {
  data: Conversation[];
  pagination: {
    hasMore: boolean;
    nextCursor: string | null;
  };
}

export interface LastMessageInput {
  messageId: string;
  content: string;
  senderId: string;
  sentAt: Date;
}

interface CursorPayload {
  updatedAt: string;
  id: string;
}

@Injectable()
export class ConversationsService {
  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway?: ChatGateway,
    @Inject(forwardRef(() => ReadReceiptsService))
    private readonly readReceiptsService?: ReadReceiptsService,
    private readonly webhooksService?: WebhooksService,
  ) {}

  async create(userId: string, dto: CreateConversationDto): Promise<Conversation> {
    if (!dto.participantIds.includes(userId)) {
      throw new BadRequestException('participantIds must include the current user');
    }

    if (dto.type === ConversationType.Direct && dto.participantIds.length !== 2) {
      throw new BadRequestException('Direct conversations must include exactly 2 participants');
    }

    if (dto.type === ConversationType.Group && dto.participantIds.length < 2) {
      throw new BadRequestException('Group conversations must include at least 2 participants');
    }

    const participantIds = this.normalizeParticipantIds(dto.participantIds);
    const joinedAt = new Date();

    const participants = this.buildParticipants(dto.type, participantIds, userId, joinedAt);

    const payload: Partial<Conversation> = {
      type: dto.type,
      name: dto.type === ConversationType.Group ? dto.name : undefined,
      participants,
      participantIds,
      metadata: dto.metadata ?? {},
      createdBy: userId,
    };

    try {
      const created = await this.conversationModel.create(payload);
      await this.chatGateway?.notifyNewConversation(created._id.toString(), created.participantIds);
      await this.webhooksService?.emitEvent(WebhookEventType.CONVERSATION_CREATED, {
        conversationId: created._id.toString(),
        type: created.type,
        participantIds: created.participantIds,
        createdBy: created.createdBy,
        createdAt: created.createdAt ?? new Date(),
      });
      return created.toObject({ getters: true, virtuals: false });
    } catch (error) {
      if (this.isDuplicateKeyError(error) && dto.type === ConversationType.Direct) {
        const otherUserId = participantIds.find((id) => id !== userId);
        if (!otherUserId) {
          throw new BadRequestException('Direct conversation requires another participant');
        }
        return this.findOrCreateDirect(userId, otherUserId, dto.metadata);
      }
      throw error;
    }
  }

  async findAllForUser(
    userId: string,
    query: QueryConversationsDto,
  ): Promise<PaginatedConversations> {
    const limit = query.limit ?? 20;
    const filter: Record<string, unknown> = {
      'participants.externalUserId': userId,
    };

    if (query.type) {
      filter.type = query.type;
    }

    if (query.with?.length) {
      const participantIds = [...new Set(query.with)].filter((participantId) => participantId !== userId);
      if (participantIds.length) {
        filter.participantIds = { $in: participantIds };
      }
    }

    if (query.cursor) {
      const cursor = this.decodeCursor(query.cursor);
      const cursorDate = new Date(cursor.updatedAt);
      if (Number.isNaN(cursorDate.valueOf())) {
        throw new BadRequestException('Invalid cursor');
      }
      filter.$or = [
        { updatedAt: { $lt: cursorDate } },
        { updatedAt: cursorDate, _id: { $lt: new Types.ObjectId(cursor.id) } },
      ];
    }

    const results = await this.conversationModel
      .find(filter)
      .sort({ updatedAt: -1, _id: -1 })
      .limit(limit + 1)
      .exec();

    const hasMore = results.length > limit;
    const data = hasMore ? results.slice(0, limit) : results;

    const lastItem = data[data.length - 1];
    const nextCursor =
      hasMore && lastItem?.updatedAt
        ? this.encodeCursor({
            updatedAt: lastItem.updatedAt.toISOString(),
            id: lastItem._id.toString(),
          })
        : null;

    const plainData = data.map((item) => (item.toObject ? item.toObject() : item));
    if (this.readReceiptsService) {
      const conversationIds = plainData.map((item) => item._id.toString());
      const counts = await this.readReceiptsService.getUnreadCounts(conversationIds, userId);
      return {
        data: plainData.map((item) => ({
          ...item,
          unreadCount: counts.get(item._id.toString()) ?? 0,
        })),
        pagination: {
          hasMore,
          nextCursor,
        },
      };
    }

    return {
      data: plainData,
      pagination: {
        hasMore,
        nextCursor,
      },
    };
  }

  async findAllIdsForUser(userId: string): Promise<string[]> {
    const results = await this.conversationModel
      .find({ 'participants.externalUserId': userId })
      .select({ _id: 1 })
      .exec();

    return results.map((conversation) => conversation._id.toString());
  }

  async findById(conversationId: string): Promise<Conversation | null> {
    return this.conversationModel.findById(conversationId).exec();
  }

  async findByIdForUser(conversationId: string, userId: string): Promise<Conversation> {
    const conversation = await this.ensureConversation(conversationId);
    if (!this.isParticipantInConversation(conversation, userId)) {
      throw new ForbiddenException('User is not a participant in this conversation');
    }
    return conversation;
  }

  async findOrCreateDirect(
    userId: string,
    otherUserId: string,
    metadata?: Record<string, unknown>,
  ): Promise<Conversation> {
    if (userId === otherUserId) {
      throw new BadRequestException('Direct conversation requires two distinct users');
    }

    const participantIds = this.normalizeParticipantIds([userId, otherUserId]);

    const existing = await this.conversationModel
      .findOne({ type: ConversationType.Direct, participantIds })
      .exec();

    if (existing) {
      // Update metadata if provided
      if (metadata !== undefined) {
        existing.metadata = metadata;
        await existing.save();
        return existing.toObject({ getters: true, virtuals: false });
      }
      return existing.toObject({ getters: true, virtuals: false });
    }

    const joinedAt = new Date();
    const participants = this.buildParticipants(
      ConversationType.Direct,
      participantIds,
      userId,
      joinedAt,
    );

    const created = await this.conversationModel.create({
      type: ConversationType.Direct,
      participants,
      participantIds,
      metadata: metadata ?? {},
      createdBy: userId,
    });

    await this.webhooksService?.emitEvent(WebhookEventType.CONVERSATION_CREATED, {
      conversationId: created._id.toString(),
      type: created.type,
      participantIds: created.participantIds,
      createdBy: created.createdBy,
      createdAt: created.createdAt ?? new Date(),
    });

    return created.toObject({ getters: true, virtuals: false });
  }

  async addParticipant(
    conversationId: string,
    userId: string,
    dto: AddParticipantDto,
  ): Promise<Conversation> {
    const conversation = await this.ensureConversation(conversationId);

    if (conversation.type === ConversationType.Direct) {
      throw new BadRequestException('Cannot add participants to direct conversations');
    }

    if (!this.isAdminInConversation(conversation, userId)) {
      throw new ForbiddenException('Only admins can add participants');
    }

    if (this.isParticipantInConversation(conversation, dto.externalUserId)) {
      throw new ConflictException('Participant already exists');
    }

    const joinedAt = new Date();
    const participant: Participant = {
      externalUserId: dto.externalUserId,
      role: dto.role ?? ParticipantRole.Member,
      joinedAt,
      addedBy: userId,
    };

    conversation.participants.push(participant);
    conversation.participantIds = this.normalizeParticipantIds([
      ...conversation.participantIds,
      dto.externalUserId,
    ]);

    await conversation.save();
    await this.chatGateway?.notifyUserAdded(conversationId, dto.externalUserId);
    await this.webhooksService?.emitEvent(WebhookEventType.PARTICIPANT_ADDED, {
      conversationId,
      type: conversation.type,
      userId: dto.externalUserId,
      addedBy: userId,
      role: participant.role,
      timestamp: new Date().toISOString(),
    });
    return conversation;
  }

  async removeParticipant(
    conversationId: string,
    userId: string,
    targetUserId: string,
  ): Promise<Conversation> {
    const conversation = await this.ensureConversation(conversationId);

    if (conversation.type === ConversationType.Direct) {
      throw new BadRequestException('Cannot remove participants from direct conversations');
    }

    if (!this.isAdminInConversation(conversation, userId)) {
      throw new ForbiddenException('Only admins can remove participants');
    }

    const index = conversation.participants.findIndex(
      (participant) => participant.externalUserId === targetUserId,
    );

    if (index === -1) {
      throw new NotFoundException('Participant not found');
    }

    conversation.participants.splice(index, 1);
    conversation.participantIds = this.normalizeParticipantIds(
      conversation.participants.map((participant) => participant.externalUserId),
    );

    this.promoteOldestAdminIfNeeded(conversation);

    if (conversation.participants.length === 0) {
      await conversation.deleteOne();
      await this.chatGateway?.notifyUserRemoved(conversationId, targetUserId);
      await this.webhooksService?.emitEvent(WebhookEventType.PARTICIPANT_REMOVED, {
        conversationId,
        type: conversation.type,
        userId: targetUserId,
        removedBy: userId,
        timestamp: new Date().toISOString(),
      });
      await this.webhooksService?.emitEvent(WebhookEventType.CONVERSATION_DELETED, {
        conversationId,
        type: conversation.type,
        deletedBy: userId,
        deletedAt: new Date().toISOString(),
      });
      return conversation;
    }

    await conversation.save();
    await this.chatGateway?.notifyUserRemoved(conversationId, targetUserId);
    await this.webhooksService?.emitEvent(WebhookEventType.PARTICIPANT_REMOVED, {
      conversationId,
      type: conversation.type,
      userId: targetUserId,
      removedBy: userId,
      timestamp: new Date().toISOString(),
    });
    return conversation;
  }

  async updateParticipantRole(
    conversationId: string,
    userId: string,
    targetUserId: string,
    dto: UpdateParticipantRoleDto,
  ): Promise<Conversation> {
    const conversation = await this.ensureConversation(conversationId);

    if (conversation.type === ConversationType.Direct) {
      throw new BadRequestException('Cannot update roles in direct conversations');
    }

    if (!this.isAdminInConversation(conversation, userId)) {
      throw new ForbiddenException('Only admins can update participant roles');
    }

    const participant = conversation.participants.find(
      (item) => item.externalUserId === targetUserId,
    );

    if (!participant) {
      throw new NotFoundException('Participant not found');
    }

    participant.role = dto.role;

    await conversation.save();
    return conversation;
  }

  async leave(conversationId: string, userId: string): Promise<void> {
    const conversation = await this.ensureConversation(conversationId);

    if (conversation.type === ConversationType.Direct) {
      throw new BadRequestException('Cannot leave direct conversations');
    }

    const index = conversation.participants.findIndex(
      (participant) => participant.externalUserId === userId,
    );

    if (index === -1) {
      throw new ForbiddenException('User is not a participant in this conversation');
    }

    conversation.participants.splice(index, 1);
    conversation.participantIds = this.normalizeParticipantIds(
      conversation.participants.map((participant) => participant.externalUserId),
    );

    this.promoteOldestAdminIfNeeded(conversation);

    if (conversation.participants.length === 0) {
      await conversation.deleteOne();
      await this.chatGateway?.notifyUserRemoved(conversationId, userId);
      await this.webhooksService?.emitEvent(WebhookEventType.PARTICIPANT_REMOVED, {
        conversationId,
        type: conversation.type,
        userId,
        removedBy: userId,
        timestamp: new Date().toISOString(),
      });
      await this.webhooksService?.emitEvent(WebhookEventType.CONVERSATION_DELETED, {
        conversationId,
        type: conversation.type,
        deletedBy: userId,
        deletedAt: new Date().toISOString(),
      });
      return;
    }

    await conversation.save();
    await this.chatGateway?.notifyUserRemoved(conversationId, userId);
    await this.webhooksService?.emitEvent(WebhookEventType.PARTICIPANT_REMOVED, {
      conversationId,
      type: conversation.type,
      userId,
      removedBy: userId,
      timestamp: new Date().toISOString(),
    });
  }

  async delete(conversationId: string, userId: string): Promise<void> {
    const conversation = await this.ensureConversation(conversationId);

    if (conversation.type === ConversationType.Direct) {
      if (!this.isParticipantInConversation(conversation, userId)) {
        throw new ForbiddenException('User is not a participant in this conversation');
      }
    } else if (!this.isAdminInConversation(conversation, userId)) {
      throw new ForbiddenException('Only admins can delete group conversations');
    }

    await conversation.deleteOne();
    this.deleteMessagesForConversation(conversationId);
    await this.webhooksService?.emitEvent(WebhookEventType.CONVERSATION_DELETED, {
      conversationId,
      type: conversation.type,
      deletedBy: userId,
      deletedAt: new Date().toISOString(),
    });
  }

  async updateLastMessage(
    conversationId: string,
    message: LastMessageInput,
  ): Promise<Conversation | null> {
    const content = message.content.length > 200 ? message.content.slice(0, 200) : message.content;

    return this.conversationModel
      .findByIdAndUpdate(
        conversationId,
        {
          $set: {
            lastMessage: {
              messageId: message.messageId,
              content,
              senderId: message.senderId,
              sentAt: message.sentAt,
            } satisfies LastMessage,
          },
        },
        { new: true },
      )
      .exec();
  }

  async clearLastMessage(conversationId: string): Promise<void> {
    await this.conversationModel
      .findByIdAndUpdate(conversationId, { $unset: { lastMessage: 1 } })
      .exec();
  }

  async isParticipant(conversationId: string, userId: string): Promise<boolean> {
    const exists = await this.conversationModel.exists({
      _id: conversationId,
      'participants.externalUserId': userId,
    });

    return Boolean(exists);
  }

  async isAdmin(conversationId: string, userId: string): Promise<boolean> {
    const exists = await this.conversationModel.exists({
      _id: conversationId,
      type: ConversationType.Group,
      participants: {
        $elemMatch: { externalUserId: userId, role: ParticipantRole.Admin },
      },
    });

    return Boolean(exists);
  }

  async canDelete(conversationId: string, userId: string): Promise<boolean> {
    const conversation = await this.ensureConversation(conversationId);

    if (conversation.type === ConversationType.Direct) {
      return this.isParticipantInConversation(conversation, userId);
    }

    return this.isAdminInConversation(conversation, userId);
  }

  async canManageParticipants(conversationId: string, userId: string): Promise<boolean> {
    const conversation = await this.ensureConversation(conversationId);

    if (conversation.type === ConversationType.Direct) {
      return false;
    }

    return this.isAdminInConversation(conversation, userId);
  }

  async getParticipantCount(conversationId: string): Promise<number> {
    const conversation = await this.conversationModel
      .findById(conversationId)
      .select({ participants: 1 })
      .lean();
    return conversation?.participants?.length ?? 0;
  }

  private async ensureConversation(conversationId: string): Promise<ConversationDocument> {
    const conversation = await this.conversationModel.findById(conversationId).exec();
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    return conversation;
  }

  private normalizeParticipantIds(participantIds: string[]): string[] {
    return Array.from(new Set(participantIds)).sort();
  }

  private buildParticipants(
    type: ConversationType,
    participantIds: string[],
    creatorId: string,
    joinedAt: Date,
  ): Participant[] {
    if (type === ConversationType.Direct) {
      return participantIds.map((externalUserId) => ({
        externalUserId,
        joinedAt,
      }));
    }

    return participantIds.map((externalUserId) => ({
      externalUserId,
      role: externalUserId === creatorId ? ParticipantRole.Admin : ParticipantRole.Member,
      joinedAt,
      addedBy: externalUserId === creatorId ? undefined : creatorId,
    }));
  }

  private isParticipantInConversation(conversation: ConversationDocument, userId: string): boolean {
    return conversation.participants.some((participant) => participant.externalUserId === userId);
  }

  private isAdminInConversation(conversation: ConversationDocument, userId: string): boolean {
    return conversation.participants.some(
      (participant) =>
        participant.externalUserId === userId && participant.role === ParticipantRole.Admin,
    );
  }

  private promoteOldestAdminIfNeeded(conversation: ConversationDocument): void {
    const hasAdmin = conversation.participants.some(
      (participant) => participant.role === ParticipantRole.Admin,
    );

    if (hasAdmin || conversation.participants.length === 0) {
      return;
    }

    const oldest = [...conversation.participants].sort(
      (a, b) => a.joinedAt.getTime() - b.joinedAt.getTime(),
    )[0];

    if (oldest) {
      oldest.role = ParticipantRole.Admin;
    }
  }

  private encodeCursor(payload: CursorPayload): string {
    return Buffer.from(JSON.stringify(payload)).toString('base64');
  }

  private decodeCursor(cursor: string): CursorPayload {
    try {
      const decoded = Buffer.from(cursor, 'base64').toString('utf8');
      return JSON.parse(decoded) as CursorPayload;
    } catch {
      throw new BadRequestException('Invalid cursor');
    }
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return Boolean(
      error && typeof error === 'object' && 'code' in error && (error as any).code === 11000,
    );
  }

  private deleteMessagesForConversation(conversationId: string): void {
    void conversationId;
    // TODO: wire message deletion once MessagesService exists.
  }
}

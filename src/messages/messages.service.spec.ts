import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { EditMessageDto } from './dto/edit-message.dto';
import { QueryMessagesDto } from './dto/query-messages.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { MessagesService } from './messages.service';
import { MessageType } from './schemas/message.schema';

const makeMessageDoc = (overrides: Record<string, unknown> = {}) => {
  const doc = {
    _id: new Types.ObjectId(),
    conversationId: new Types.ObjectId(),
    senderId: 'user-1',
    content: 'hello',
    type: MessageType.Text,
    isDeleted: false,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    save: jest.fn().mockResolvedValue(undefined),
    deleteOne: jest.fn().mockResolvedValue(undefined),
    toObject() {
      return { ...this };
    },
    ...overrides,
  };

  return doc;
};

describe('MessagesService', () => {
  const createModel = () => ({
    create: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    findOne: jest.fn(),
  });

  const createConversationService = () => ({
    findById: jest.fn(),
    updateLastMessage: jest.fn(),
    clearLastMessage: jest.fn(),
  });

  const createUsersService = () => ({
    findByExternalId: jest.fn(),
    findManyByExternalIds: jest.fn(),
  });

  it('send rejects non-participants', async () => {
    const model = createModel();
    const conversationsService = createConversationService();
    const usersService = createUsersService();
    const conversationId = new Types.ObjectId().toString();

    conversationsService.findById.mockResolvedValue({ participants: [] });

    const service = new MessagesService(
      model as any,
      conversationsService as any,
      usersService as any,
    );

    await expect(
      service.send(conversationId, 'user-1', { content: 'hi' } as SendMessageDto),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('send creates message and updates lastMessage', async () => {
    const model = createModel();
    const conversationsService = createConversationService();
    const usersService = createUsersService();
    const conversationId = new Types.ObjectId().toString();

    const conversation = {
      participants: [{ externalUserId: 'user-1' }],
    };

    const message = makeMessageDoc({
      _id: new Types.ObjectId('507f1f77bcf86cd799439011'),
      content: 'Hello world',
      senderId: 'user-1',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
    });

    conversationsService.findById.mockResolvedValue(conversation);
    model.create.mockResolvedValue(message);
    usersService.findByExternalId.mockResolvedValue({
      externalUserId: 'user-1',
      displayName: 'User 1',
      avatarUrl: 'a',
    });

    const service = new MessagesService(
      model as any,
      conversationsService as any,
      usersService as any,
    );

    const result = await service.send(conversationId, 'user-1', {
      content: 'Hello world',
    } as SendMessageDto);

    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {},
      }),
    );
    expect(conversationsService.updateLastMessage).toHaveBeenCalled();
    expect(result.sender?.displayName).toBe('User 1');
  });

  it('send persists provided metadata', async () => {
    const model = createModel();
    const conversationsService = createConversationService();
    const usersService = createUsersService();
    const conversationId = new Types.ObjectId().toString();

    const conversation = {
      participants: [{ externalUserId: 'user-1' }],
    };

    const message = makeMessageDoc({
      senderId: 'user-1',
      content: 'Hello world',
    });

    conversationsService.findById.mockResolvedValue(conversation);
    model.create.mockResolvedValue(message);
    usersService.findByExternalId.mockResolvedValue({
      externalUserId: 'user-1',
    });

    const service = new MessagesService(
      model as any,
      conversationsService as any,
      usersService as any,
    );

    await service.send(conversationId, 'user-1', {
      content: 'Hello world',
      metadata: { source: 'mobile' },
    } as SendMessageDto);

    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { source: 'mobile' },
      }),
    );
  });

  it('createSystemMessage creates system message and updates lastMessage', async () => {
    const model = createModel();
    const conversationsService = createConversationService();
    const usersService = createUsersService();
    const conversationId = new Types.ObjectId().toString();

    conversationsService.findById.mockResolvedValue({ participants: [] });

    const message = makeMessageDoc({
      senderId: 'system',
      content: 'User joined',
    });

    model.create.mockResolvedValue(message);
    usersService.findByExternalId.mockResolvedValue(null);

    const service = new MessagesService(
      model as any,
      conversationsService as any,
      usersService as any,
    );

    const result = await service.createSystemMessage(conversationId, 'User joined');

    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({
        senderId: 'system',
        type: MessageType.System,
      }),
    );
    expect(conversationsService.updateLastMessage).toHaveBeenCalled();
    expect(result.sender).toBeNull();
  });

  it('findByConversation paginates and preserves order', async () => {
    const model = createModel();
    const conversationsService = createConversationService();
    const usersService = createUsersService();
    const conversationId = new Types.ObjectId().toString();

    const msg1 = { _id: new Types.ObjectId('507f1f77bcf86cd799439011'), senderId: 'user-1' };
    const msg2 = { _id: new Types.ObjectId('507f1f77bcf86cd799439012'), senderId: 'user-2' };
    const queryChain = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([msg2, msg1]),
    };

    model.find.mockReturnValue(queryChain);
    usersService.findManyByExternalIds.mockResolvedValue([
      { externalUserId: 'user-1' },
      { externalUserId: 'user-2' },
    ]);

    const service = new MessagesService(
      model as any,
      conversationsService as any,
      usersService as any,
    );

    const result = await service.findByConversation(conversationId, {
      limit: 1,
    } as QueryMessagesDto);

    expect(result.pagination.hasMore).toBe(true);
    expect(result.pagination.newestId).toBe(msg2._id.toString());
  });

  it('edit enforces sender-only', async () => {
    const model = createModel();
    const conversationsService = createConversationService();
    const usersService = createUsersService();

    const message = makeMessageDoc({ senderId: 'user-1' });
    model.findById.mockResolvedValue(message);

    const service = new MessagesService(
      model as any,
      conversationsService as any,
      usersService as any,
    );

    await expect(
      service.edit('msg-1', 'user-2', { content: 'new' } as EditMessageDto),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('delete soft-deletes and clears lastMessage when empty', async () => {
    const model = createModel();
    const conversationsService = createConversationService();
    const usersService = createUsersService();

    const message = makeMessageDoc({ senderId: 'user-1' });
    model.findById.mockResolvedValue(message);
    model.findOne.mockReturnValue({ sort: jest.fn().mockResolvedValue(null) });

    const service = new MessagesService(
      model as any,
      conversationsService as any,
      usersService as any,
    );

    const result = await service.delete('msg-1', 'user-1');

    expect(result.deleted).toBe(true);
    expect(conversationsService.clearLastMessage).toHaveBeenCalled();
  });

  it('getContext returns messages with reply context', async () => {
    const model = createModel();
    const conversationsService = createConversationService();
    const usersService = createUsersService();

    const target = {
      _id: new Types.ObjectId('507f1f77bcf86cd799439011'),
      conversationId: new Types.ObjectId('507f1f77bcf86cd799439021'),
      senderId: 'user-1',
      replyTo: new Types.ObjectId('507f1f77bcf86cd799439099'),
      content: 'target',
      isDeleted: false,
    };

    model.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(target) });

    model.find
      .mockReturnValueOnce({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      })
      .mockReturnValueOnce({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      })
      .mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue([
          {
            _id: target.replyTo,
            senderId: 'user-2',
            content: 'parent content',
            isDeleted: false,
          },
        ]),
      });

    usersService.findManyByExternalIds.mockResolvedValue([
      { externalUserId: 'user-1', displayName: 'User 1' },
      { externalUserId: 'user-2', displayName: 'User 2' },
    ]);

    const service = new MessagesService(
      model as any,
      conversationsService as any,
      usersService as any,
    );

    const result = await service.getContext(target._id.toString(), 1);

    expect(result[0].replyToMessage).toBeDefined();
    expect(result[0].replyToMessage?.sender?.displayName).toBe('User 2');
  });

  it('populateReplyPreview returns null when parent deleted', async () => {
    const model = createModel();
    const conversationsService = createConversationService();
    const usersService = createUsersService();

    const replyId = new Types.ObjectId('507f1f77bcf86cd799439099');
    const message = {
      _id: new Types.ObjectId('507f1f77bcf86cd799439011'),
      senderId: 'user-1',
      replyTo: replyId,
      content: 'child',
    } as any;

    model.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: replyId, isDeleted: true }),
    });
    usersService.findByExternalId.mockResolvedValue({ externalUserId: 'user-1' });

    const service = new MessagesService(
      model as any,
      conversationsService as any,
      usersService as any,
    );

    const populated = await service.populateMessageWithSender(message);
    const result = await service.populateReplyPreview(populated);

    expect(result.replyToMessage).toBeNull();
  });

  it('hardDelete throws if message missing', async () => {
    const model = createModel();
    const conversationsService = createConversationService();
    const usersService = createUsersService();

    model.findById.mockResolvedValue(null);

    const service = new MessagesService(
      model as any,
      conversationsService as any,
      usersService as any,
    );

    await expect(service.hardDelete('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('send with attachments calls commitFiles on FileServiceClient', async () => {
    const model = createModel();
    const conversationsService = createConversationService();
    const usersService = createUsersService();
    const conversationId = new Types.ObjectId().toString();

    const conversation = {
      participants: [{ externalUserId: 'user-1' }],
    };

    const message = makeMessageDoc({
      senderId: 'user-1',
      content: 'Hello with files',
      attachments: [{ externalFileId: 'file-1' }, { externalFileId: 'file-2' }],
    });

    conversationsService.findById.mockResolvedValue(conversation);
    model.create.mockResolvedValue(message);
    usersService.findByExternalId.mockResolvedValue({
      externalUserId: 'user-1',
    });

    const fileServiceClient = {
      commitFiles: jest.fn().mockResolvedValue(undefined),
    };

    const service = new MessagesService(
      model as any,
      conversationsService as any,
      usersService as any,
      undefined,
      undefined,
      undefined,
      fileServiceClient as any,
    );

    await service.send(conversationId, 'user-1', {
      content: 'Hello with files',
      attachments: [{ externalFileId: 'file-1' }, { externalFileId: 'file-2' }],
    } as SendMessageDto);

    expect(fileServiceClient.commitFiles).toHaveBeenCalledWith(['file-1', 'file-2']);
  });

  it('send with attachments throws InternalServerErrorException if FileServiceClient is not defined', async () => {
    const model = createModel();
    const conversationsService = createConversationService();
    const usersService = createUsersService();
    const conversationId = new Types.ObjectId().toString();

    const conversation = {
      participants: [{ externalUserId: 'user-1' }],
    };

    conversationsService.findById.mockResolvedValue(conversation);

    const service = new MessagesService(
      model as any,
      conversationsService as any,
      usersService as any,
    );

    await expect(
      service.send(conversationId, 'user-1', {
        content: 'Hello with files',
        attachments: [{ externalFileId: 'file-1' }],
      } as SendMessageDto),
    ).rejects.toThrow('File service is not configured.');
  });
});

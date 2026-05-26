import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ConversationsService } from './conversations.service';
import { ConversationType } from './schemas/conversation.schema';
import { ParticipantRole } from './schemas/participant.schema';

const createDoc = (overrides: Record<string, unknown> = {}) => {
  const doc = {
    _id: new Types.ObjectId(),
    type: ConversationType.Group,
    participants: [],
    participantIds: [],
    save: jest.fn().mockResolvedValue(undefined),
    deleteOne: jest.fn().mockResolvedValue(undefined),
    toObject: jest.fn().mockImplementation(function () {
      return { ...this };
    }),
    ...overrides,
  };
  return doc;
};

describe('ConversationsService', () => {
  const createModel = () => ({
    create: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    find: jest.fn(),
    exists: jest.fn(),
  });

  const createService = (model: ReturnType<typeof createModel>) =>
    new ConversationsService(model as any, undefined, {
      getUnreadCounts: jest.fn().mockResolvedValue(new Map()),
    } as any);

  it('creates a direct conversation with no roles', async () => {
    const model = createModel();
    const service = createService(model);

    const createdDoc = createDoc({
      type: ConversationType.Direct,
      participants: [
        { externalUserId: 'user-1', joinedAt: new Date() },
        { externalUserId: 'user-2', joinedAt: new Date() },
      ],
      participantIds: ['user-1', 'user-2'],
    });

    model.create.mockResolvedValue(createdDoc);

    const result = await service.create('user-1', {
      type: ConversationType.Direct,
      participantIds: ['user-1', 'user-2'],
    } as any);

    expect(model.create).toHaveBeenCalled();
    const payload = model.create.mock.calls[0][0];
    expect(payload.type).toBe(ConversationType.Direct);
    expect(payload.participants[0].role).toBeUndefined();
    expect(result).toMatchObject({ type: ConversationType.Direct });
  });

  it('creates a group conversation with creator as admin', async () => {
    const model = createModel();
    const service = createService(model);

    const createdDoc = createDoc({
      type: ConversationType.Group,
      participants: [],
      participantIds: ['user-1', 'user-2'],
    });

    model.create.mockResolvedValue(createdDoc);

    await service.create('user-1', {
      type: ConversationType.Group,
      name: 'Team',
      participantIds: ['user-1', 'user-2'],
    } as any);

    const payload = model.create.mock.calls[0][0];
    const creator = payload.participants.find((p: any) => p.externalUserId === 'user-1');
    const member = payload.participants.find((p: any) => p.externalUserId === 'user-2');

    expect(creator.role).toBe(ParticipantRole.Admin);
    expect(member.role).toBe(ParticipantRole.Member);
    expect(member.addedBy).toBe('user-1');
  });

  it('rejects create when user is not in participantIds', async () => {
    const model = createModel();
    const service = createService(model);

    await expect(
      service.create('user-1', {
        type: ConversationType.Direct,
        participantIds: ['user-2', 'user-3'],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('findOrCreateDirect returns existing', async () => {
    const model = createModel();
    const service = createService(model);
    const existing = createDoc({
      type: ConversationType.Direct,
      participantIds: ['user-1', 'user-2'],
      participants: [
        { externalUserId: 'user-1', joinedAt: new Date() },
        { externalUserId: 'user-2', joinedAt: new Date() },
      ],
    });

    model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(existing) });

    const result = await service.findOrCreateDirect('user-1', 'user-2');

    expect(result).toMatchObject({ type: ConversationType.Direct });
    expect(model.create).not.toHaveBeenCalled();
  });

  it('findOrCreateDirect updates existing metadata when provided', async () => {
    const model = createModel();
    const service = createService(model);
    const existing = createDoc({
      type: ConversationType.Direct,
      metadata: { theme: 'light' },
      save: jest.fn().mockResolvedValue(undefined),
    });

    model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(existing) });

    const result = await service.findOrCreateDirect('user-1', 'user-2', {
      theme: 'dark',
      pinned: true,
    });

    expect(existing.save).toHaveBeenCalled();
    expect(result).toMatchObject({
      metadata: { theme: 'dark', pinned: true },
    });
  });

  it('blocks addParticipant for direct conversations', async () => {
    const model = createModel();
    const service = createService(model);
    const conversation = createDoc({
      type: ConversationType.Direct,
      participants: [{ externalUserId: 'user-1', joinedAt: new Date() }],
      participantIds: ['user-1', 'user-2'],
    });

    model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(conversation) });

    await expect(
      service.addParticipant('conv-1', 'user-1', { externalUserId: 'user-3' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('enforces admin-only removeParticipant in groups', async () => {
    const model = createModel();
    const service = createService(model);
    const conversation = createDoc({
      type: ConversationType.Group,
      participants: [
        { externalUserId: 'user-1', role: ParticipantRole.Member, joinedAt: new Date() },
        { externalUserId: 'user-2', role: ParticipantRole.Member, joinedAt: new Date() },
      ],
      participantIds: ['user-1', 'user-2'],
    });

    model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(conversation) });

    await expect(service.removeParticipant('conv-1', 'user-1', 'user-2')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('paginates conversations with cursor', async () => {
    const model = createModel();
    const service = createService(model);

    const first = createDoc({ updatedAt: new Date('2025-01-02T00:00:00.000Z') });
    const second = createDoc({ updatedAt: new Date('2025-01-01T00:00:00.000Z') });
    const extra = createDoc({ updatedAt: new Date('2024-12-31T00:00:00.000Z') });

    const queryChain = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([first, second, extra]),
    };

    model.find.mockReturnValue(queryChain);

    const result = await service.findAllForUser('user-1', { limit: 2 } as any);

    expect(result.pagination.hasMore).toBe(true);
    expect(result.pagination.nextCursor).toBeTruthy();
    expect(result.data).toHaveLength(2);
  });

  it('filters conversations by participant ids', async () => {
    const model = createModel();
    const service = createService(model);

    const queryChain = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };

    model.find.mockReturnValue(queryChain);

    await service.findAllForUser('user-1', {
      limit: 10,
      type: ConversationType.Direct,
      with: ['user-2', 'user-3'],
    } as any);

    expect(model.find).toHaveBeenCalledWith(
      expect.objectContaining({
        'participants.externalUserId': 'user-1',
        type: ConversationType.Direct,
        participantIds: { $in: ['user-2', 'user-3'] },
      }),
    );
  });
});

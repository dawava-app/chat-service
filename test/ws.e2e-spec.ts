import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { AppModule } from './../src/app.module';
import { RedisIoAdapter } from './../src/gateway/adapters/redis-io.adapter';
import { REDIS_CLIENT } from './../src/redis/redis.module';

const USER_1 = { externalUserId: 'user-1', displayName: 'User One' };
const USER_2 = { externalUserId: 'user-2', displayName: 'User Two' };

describe('WebSocket gateway (e2e)', () => {
  jest.setTimeout(30000);

  let app: INestApplication;
  let jwtService: JwtService;
  let connection: Connection;
  let redisClient: { quit: () => Promise<void>; on?: (event: string, cb: () => void) => void };
  let wsAdapter: RedisIoAdapter;
  let wsPort = 0;
  const sockets: Socket[] = [];

  const jwtSecret = 'test-secret-should-be-32-characters-long';
  const jwtIssuer = 'master-service';
  const internalSecret = 'internal-secret-should-be-32-characters-long';
  const mongoUri = 'mongodb://localhost:27017/chat-service-test';
  const redisUrl = 'redis://localhost:6379';

  const signToken = (externalUserId: string) =>
    jwtService.sign({ externalUserId }, { issuer: jwtIssuer });

  const authHeader = (externalUserId: string) => ({
    Authorization: `Bearer ${signToken(externalUserId)}`,
  });

  const syncUser = async (user: { externalUserId: string; displayName: string }) =>
    request(app.getHttpServer())
      .post('/api/users/sync')
      .set('x-internal-secret', internalSecret)
      .send(user)
      .expect(201);

  const createConversation = async (userId: string, participantIds: string[]) => {
    const response = await request(app.getHttpServer())
      .post('/api/conversations')
      .set(authHeader(userId))
      .send({
        type: participantIds.length === 2 ? 'direct' : 'group',
        name: participantIds.length > 2 ? 'Team' : undefined,
        participantIds,
      })
      .expect(201);

    return response.body;
  };

  const trackSocket = (socket: Socket) => {
    sockets.push(socket);
    return socket;
  };

  type SocketHandshake = {
    auth?: Record<string, unknown>;
    query?: Record<string, string>;
    extraHeaders?: Record<string, string>;
  };

  const connectSocketWithHandshake = (handshake: SocketHandshake) =>
    new Promise<Socket>((resolve, reject) => {
      const socket = trackSocket(
        io(`http://localhost:${wsPort}`, {
          auth: handshake.auth,
          query: handshake.query,
          transportOptions: handshake.extraHeaders
            ? {
                websocket: {
                  extraHeaders: handshake.extraHeaders,
                },
              }
            : undefined,
          transports: ['websocket'],
          reconnection: false,
        }),
      );

      const timeout = setTimeout(() => {
        socket.disconnect();
        reject(new Error('Timed out waiting for WS connection'));
      }, 5000);

      socket.on('connected', () => {
        clearTimeout(timeout);
        resolve(socket);
      });

      socket.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

  const connectSocket = (token: string) => connectSocketWithHandshake({ auth: { token } });

  const waitForEvent = <T>(socket: Socket, event: string, timeoutMs = 5000) =>
    new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for ${event}`));
      }, timeoutMs);
      socket.once(event, (payload: T) => {
        clearTimeout(timeout);
        resolve(payload);
      });
    });

  const emitWithAck = <T>(socket: Socket, event: string, payload: unknown, timeoutMs = 5000) =>
    new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for ack on ${event}`));
      }, timeoutMs);
      socket.emit(event, payload, (response: T) => {
        clearTimeout(timeout);
        resolve(response);
      });
    });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = mongoUri;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_JWT_SECRET = jwtSecret;
    process.env.AUTH_JWT_ISSUER = jwtIssuer;
    process.env.INTERNAL_API_SECRET = internalSecret;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    wsAdapter = new RedisIoAdapter(app, redisUrl);
    await wsAdapter.connectToRedis();
    app.useWebSocketAdapter(wsAdapter);
    await app.listen(0);

    jwtService = new JwtService({ secret: jwtSecret, signOptions: { issuer: jwtIssuer } });
    connection = app.get<Connection>(getConnectionToken());
    redisClient = app.get(REDIS_CLIENT);
    if (redisClient && 'on' in redisClient) {
      redisClient.on?.('error', () => undefined);
    }

    const address = app.getHttpServer().address();
    if (address && typeof address === 'object') {
      wsPort = address.port;
    }
  });

  beforeEach(async () => {
    if (redisClient && (redisClient as any).flushdb) {
      await (redisClient as any).flushdb();
    }
    await connection.dropDatabase();
    await syncUser(USER_1);
    await syncUser(USER_2);
  });

  afterEach(() => {
    sockets.splice(0).forEach((socket) => {
      socket.removeAllListeners();
      try {
        socket.disconnect();
        (socket as any).close?.();
        (socket as any).io?.engine?.close?.();
      } catch {
        // ignore socket cleanup errors
      }
    });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (wsAdapter) {
      await wsAdapter.close();
    }
    if (redisClient) {
      try {
        await redisClient.quit();
      } catch {
        // ignore redis shutdown errors in tests
      }
      try {
        (redisClient as any).disconnect?.();
      } catch {
        // ignore redis shutdown errors in tests
      }
    }
    await connection.close();
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  it('connects with valid token and rejects invalid token', async () => {
    const socket = await connectSocket(signToken(USER_1.externalUserId));
    expect(socket.connected).toBe(true);
    socket.disconnect();

    const badSocket = trackSocket(
      io(`http://localhost:${wsPort}`, {
        auth: { token: 'bad-token' },
        transports: ['websocket'],
        reconnection: false,
      }),
    );

    const error = await Promise.race([
      waitForEvent<{ code: string }>(badSocket, 'error'),
      waitForEvent<{ code: string }>(badSocket, 'connect_error'),
    ]);

    expect(error.code).toBe('UNAUTHORIZED');
    badSocket.disconnect();
  });

  it('accepts query tokens and authorization headers during handshake', async () => {
    const querySocket = await connectSocketWithHandshake({
      query: { token: signToken(USER_1.externalUserId) },
    });
    expect(querySocket.connected).toBe(true);
    querySocket.disconnect();

    const headerSocket = await connectSocketWithHandshake({
      extraHeaders: { authorization: `Bearer ${signToken(USER_2.externalUserId)}` },
    });
    expect(headerSocket.connected).toBe(true);
    headerSocket.disconnect();
  });

  it('broadcasts message:new on websocket send and REST send', async () => {
    const conversation = await createConversation(USER_1.externalUserId, [
      USER_1.externalUserId,
      USER_2.externalUserId,
    ]);

    const socket1 = await connectSocket(signToken(USER_1.externalUserId));
    const socket2 = await connectSocket(signToken(USER_2.externalUserId));

    const received = waitForEvent<any>(socket2, 'message:new');

    const ack = await emitWithAck<any>(socket1, 'message:send', {
      conversationId: conversation._id,
      content: 'Hi from WS',
    });

    expect(ack.success).toBe(true);
    const message = await received;
    expect(message.content).toBe('Hi from WS');

    const receivedRest = waitForEvent<any>(socket2, 'message:new');

    await request(app.getHttpServer())
      .post(`/api/conversations/${conversation._id}/messages`)
      .set(authHeader(USER_1.externalUserId))
      .send({ content: 'Hi from REST' })
      .expect(201);

    const restMessage = await receivedRest;
    expect(restMessage.content).toBe('Hi from REST');

    socket1.disconnect();
    socket2.disconnect();
  });

  it('syncs missed messages after reconnect', async () => {
    const conversation = await createConversation(USER_1.externalUserId, [
      USER_1.externalUserId,
      USER_2.externalUserId,
    ]);

    const socket = await connectSocket(signToken(USER_1.externalUserId));

    const first = await request(app.getHttpServer())
      .post(`/api/conversations/${conversation._id}/messages`)
      .set(authHeader(USER_1.externalUserId))
      .send({ content: 'First' })
      .expect(201);

    const second = await request(app.getHttpServer())
      .post(`/api/conversations/${conversation._id}/messages`)
      .set(authHeader(USER_1.externalUserId))
      .send({ content: 'Second' })
      .expect(201);

    const sync = await emitWithAck<any>(socket, 'messages:sync', {
      conversationId: conversation._id,
      lastMessageId: first.body._id,
    });

    expect(sync.success).toBe(true);
    expect(sync.messages.some((msg: any) => msg._id === second.body._id)).toBe(true);

    socket.disconnect();
  });

  it('handles room:join and room:leave for participants', async () => {
    const conversation = await createConversation(USER_1.externalUserId, [
      USER_1.externalUserId,
      USER_2.externalUserId,
    ]);

    const socket = await connectSocket(signToken(USER_1.externalUserId));

    const joinAck = await emitWithAck<any>(socket, 'room:join', {
      conversationId: conversation._id,
    });
    expect(joinAck.success).toBe(true);

    const leaveAck = await emitWithAck<any>(socket, 'room:leave', {
      conversationId: conversation._id,
    });
    expect(leaveAck.success).toBe(true);

    socket.disconnect();
  });

  it('broadcasts user:online and user:offline', async () => {
    const conversation = await createConversation(USER_1.externalUserId, [
      USER_1.externalUserId,
      USER_2.externalUserId,
    ]);

    const socket1 = await connectSocket(signToken(USER_1.externalUserId));

    const onlineEvent = waitForEvent<any>(socket1, 'user:online');

    const socket2 = await connectSocket(signToken(USER_2.externalUserId));
    const onlinePayload = await onlineEvent;
    expect(onlinePayload.userId).toBe(USER_2.externalUserId);
    expect(onlinePayload.conversationId).toBe(conversation._id);

    const offlineEvent = waitForEvent<any>(socket1, 'user:offline');

    socket2.disconnect();
    const offlinePayload = await offlineEvent;
    expect(offlinePayload.userId).toBe(USER_2.externalUserId);
    expect(offlinePayload.conversationId).toBe(conversation._id);

    socket1.disconnect();
  });

  it('broadcasts message:updated and message:deleted', async () => {
    const conversation = await createConversation(USER_1.externalUserId, [
      USER_1.externalUserId,
      USER_2.externalUserId,
    ]);

    const socket1 = await connectSocket(signToken(USER_1.externalUserId));
    const socket2 = await connectSocket(signToken(USER_2.externalUserId));

    const sendAck = await emitWithAck<any>(socket1, 'message:send', {
      conversationId: conversation._id,
      content: 'Edit me',
    });

    const messageId = sendAck.message?._id;
    expect(messageId).toBeDefined();

    const updatedEvent = waitForEvent<any>(socket2, 'message:updated');

    await emitWithAck<any>(socket1, 'message:edit', { messageId, content: 'Edited' });

    const updatedPayload = await updatedEvent;
    expect(updatedPayload.messageId).toBe(messageId);
    expect(updatedPayload.content).toBe('Edited');

    const deletedEvent = waitForEvent<any>(socket2, 'message:deleted');

    await emitWithAck<any>(socket1, 'message:delete', { messageId });

    const deletedPayload = await deletedEvent;
    expect(deletedPayload.messageId).toBe(messageId);
    expect(deletedPayload.conversationId).toBe(conversation._id);

    socket1.disconnect();
    socket2.disconnect();
  });

  it('broadcasts reaction:add and reaction:remove', async () => {
    const conversation = await createConversation(USER_1.externalUserId, [
      USER_1.externalUserId,
      USER_2.externalUserId,
    ]);

    const message = await request(app.getHttpServer())
      .post(`/api/conversations/${conversation._id}/messages`)
      .set(authHeader(USER_1.externalUserId))
      .send({ content: 'React here' })
      .expect(201);

    const socket1 = await connectSocket(signToken(USER_1.externalUserId));
    const socket2 = await connectSocket(signToken(USER_2.externalUserId));

    const addedEvent = waitForEvent<any>(socket1, 'reaction:added');

    const addAck = await emitWithAck<any>(socket2, 'reaction:add', {
      messageId: message.body._id,
      emoji: '👍',
    });

    expect(addAck.success).toBe(true);
    const addedPayload = await addedEvent;
    expect(addedPayload.messageId).toBe(message.body._id);
    expect(addedPayload.emoji).toBe('👍');

    const removedEvent = waitForEvent<any>(socket1, 'reaction:removed');

    const removeAck = await emitWithAck<any>(socket2, 'reaction:remove', {
      messageId: message.body._id,
      emoji: '👍',
    });

    expect(removeAck.success).toBe(true);
    const removedPayload = await removedEvent;
    expect(removedPayload.messageId).toBe(message.body._id);
    expect(removedPayload.emoji).toBe('👍');

    socket1.disconnect();
    socket2.disconnect();
  });

  it('broadcasts message:read and conversation:read', async () => {
    const conversation = await createConversation(USER_1.externalUserId, [
      USER_1.externalUserId,
      USER_2.externalUserId,
    ]);

    const message = await request(app.getHttpServer())
      .post(`/api/conversations/${conversation._id}/messages`)
      .set(authHeader(USER_1.externalUserId))
      .send({ content: 'Read me' })
      .expect(201);

    const socket1 = await connectSocket(signToken(USER_1.externalUserId));
    const socket2 = await connectSocket(signToken(USER_2.externalUserId));

    const readEvent = waitForEvent<any>(socket1, 'message:read');
    const readAck = await emitWithAck<any>(socket2, 'message:read', {
      messageId: message.body._id,
    });

    expect(readAck.success).toBe(true);
    const readPayload = await readEvent;
    expect(readPayload.messageId).toBe(message.body._id);
    expect(readPayload.userId).toBe(USER_2.externalUserId);

    const convReadEvent = waitForEvent<any>(socket1, 'conversation:read');
    const convReadAck = await emitWithAck<any>(socket2, 'conversation:read', {
      conversationId: conversation._id,
    });

    expect(convReadAck.success).toBe(true);
    const convReadPayload = await convReadEvent;
    expect(convReadPayload.conversationId).toBe(conversation._id);
    expect(convReadPayload.userId).toBe(USER_2.externalUserId);

    socket1.disconnect();
    socket2.disconnect();
  });

  it('rejects room:join for non-participants', async () => {
    const conversation = await createConversation(USER_1.externalUserId, [
      USER_1.externalUserId,
      USER_2.externalUserId,
    ]);

    const socket = await connectSocket(signToken('user-3'));

    socket.emit('room:join', { conversationId: conversation._id });
    const error = await Promise.race([
      waitForEvent<any>(socket, 'error'),
      waitForEvent<any>(socket, 'exception'),
    ]);

    const errorCode = error?.code ?? error?.error?.code;
    const errorMessage = error?.message ?? error?.error?.message;
    expect(errorCode === 'FORBIDDEN' || /forbidden/i.test(errorMessage ?? '')).toBe(true);
    socket.disconnect();
  });

  it('rejects message:send for non-participants', async () => {
    const conversation = await createConversation(USER_1.externalUserId, [
      USER_1.externalUserId,
      USER_2.externalUserId,
    ]);

    const socket = await connectSocket(signToken('user-3'));

    socket.emit('message:send', { conversationId: conversation._id, content: 'Nope' });
    const error = await Promise.race([
      waitForEvent<any>(socket, 'error'),
      waitForEvent<any>(socket, 'exception'),
    ]);

    const errorCode = error?.code ?? error?.error?.code;
    const errorMessage = error?.message ?? error?.error?.message;
    expect(errorCode === 'FORBIDDEN' || /forbidden/i.test(errorMessage ?? '')).toBe(true);
    socket.disconnect();
  });

  it('messages:sync returns empty when no new messages', async () => {
    const conversation = await createConversation(USER_1.externalUserId, [
      USER_1.externalUserId,
      USER_2.externalUserId,
    ]);

    const socket = await connectSocket(signToken(USER_1.externalUserId));

    const last = await request(app.getHttpServer())
      .post(`/api/conversations/${conversation._id}/messages`)
      .set(authHeader(USER_1.externalUserId))
      .send({ content: 'Only message' })
      .expect(201);

    const sync = await emitWithAck<any>(socket, 'messages:sync', {
      conversationId: conversation._id,
      lastMessageId: last.body._id,
    });

    expect(sync.success).toBe(true);
    expect(sync.messages).toHaveLength(0);

    socket.disconnect();
  });

  it('broadcasts typing and recording indicators', async () => {
    const conversation = await createConversation(USER_1.externalUserId, [
      USER_1.externalUserId,
      USER_2.externalUserId,
    ]);

    const socket1 = await connectSocket(signToken(USER_1.externalUserId));
    const socket2 = await connectSocket(signToken(USER_2.externalUserId));

    const typingStart = waitForEvent<any>(socket1, 'user:typing');
    const typingAck = await emitWithAck<any>(socket2, 'typing:start', {
      conversationId: conversation._id,
    });
    expect(typingAck.success).toBe(true);
    const typingPayload = await typingStart;
    expect(typingPayload.userId).toBe(USER_2.externalUserId);
    expect(typingPayload.isActive).toBe(true);

    const typingStop = waitForEvent<any>(socket1, 'user:typing');
    const stopAck = await emitWithAck<any>(socket2, 'typing:stop', {
      conversationId: conversation._id,
    });
    expect(stopAck.success).toBe(true);
    const stopPayload = await typingStop;
    expect(stopPayload.userId).toBe(USER_2.externalUserId);
    expect(stopPayload.isActive).toBe(false);

    const recordingStart = waitForEvent<any>(socket1, 'user:recording');
    const recAck = await emitWithAck<any>(socket2, 'recording:start', {
      conversationId: conversation._id,
    });
    expect(recAck.success).toBe(true);
    const recPayload = await recordingStart;
    expect(recPayload.userId).toBe(USER_2.externalUserId);
    expect(recPayload.isActive).toBe(true);

    const recordingStop = waitForEvent<any>(socket1, 'user:recording');
    const recStopAck = await emitWithAck<any>(socket2, 'recording:stop', {
      conversationId: conversation._id,
    });
    expect(recStopAck.success).toBe(true);
    const recStopPayload = await recordingStop;
    expect(recStopPayload.userId).toBe(USER_2.externalUserId);
    expect(recStopPayload.isActive).toBe(false);

    socket1.disconnect();
    socket2.disconnect();
  });

  it('does not echo typing indicator back to sender', async () => {
    const conversation = await createConversation(USER_1.externalUserId, [
      USER_1.externalUserId,
      USER_2.externalUserId,
    ]);

    const socket1 = await connectSocket(signToken(USER_1.externalUserId));
    const socket2 = await connectSocket(signToken(USER_2.externalUserId));

    const selfReceived = new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 500);
      socket2.once('user:typing', () => {
        clearTimeout(timeout);
        resolve(true);
      });
    });

    const otherReceived = waitForEvent<any>(socket1, 'user:typing');
    await emitWithAck<any>(socket2, 'typing:start', { conversationId: conversation._id });

    expect(await otherReceived).toBeTruthy();
    expect(await selfReceived).toBe(false);

    socket1.disconnect();
    socket2.disconnect();
  });

  it('acks activity:ping', async () => {
    const socket = await connectSocket(signToken(USER_1.externalUserId));

    const ack = await emitWithAck<any>(socket, 'activity:ping', {});
    expect(ack.success).toBe(true);

    socket.disconnect();
  });
});

# Chat Service Communication Architecture

## Overview

This document describes the hybrid communication model between the Frontend, the Master Service (host application), and the Chat Service.

- WebSocket: Frontend connects directly to Chat Service for real-time events.
- REST API: Frontend calls Master Service, which proxies to Chat Service for CRUD.
- Internal API: Master Service syncs users and performs server-to-server actions.
- Webhooks: Chat Service notifies Master Service of events.

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│    ┌──────────────┐              ┌──────────────┐                  │
│    │              │   WebSocket  │              │                  │
│    │   Frontend   │═════════════▶│ Chat Service │                  │
│    │              │   (direct)   │              │                  │
│    └──────┬───────┘              └──────▲───────┘                  │
│           │                             │                          │
│           │ REST API                    │ Internal API             │
│           │ (all chat operations)       │ (user sync)              │
│           ▼                             │                          │
│    ┌──────────────┐                     │                          │
│    │    Master    │─────────────────────┘                          │
│    │   Service    │                                                │
│    └──────────────┘                                                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Path 1: WebSocket (Frontend → Chat Service)

Purpose: Real-time events with low latency.

Connection example:
```javascript
import { io } from 'socket.io-client';

const socket = io('wss://chat.example.com', {
  auth: { token: 'jwt_token_from_master_service' },
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
});
```

### Client → Server Events

| Event | Payload | Description |
|-------|---------|-------------|
| `message:send` | `{ conversationId, content, attachments?, replyTo? }` | Send a message |
| `message:edit` | `{ messageId, content }` | Edit a message |
| `message:delete` | `{ messageId }` | Delete a message |
| `reaction:add` | `{ messageId, emoji }` | Add reaction |
| `reaction:remove` | `{ messageId, emoji }` | Remove reaction |
| `message:read` | `{ messageId }` | Mark message as read |
| `conversation:read` | `{ conversationId, upToMessageId? }` | Mark conversation as read |
| `typing:start` | `{ conversationId }` | Typing indicator start |
| `typing:stop` | `{ conversationId }` | Typing indicator stop |
| `recording:start` | `{ conversationId }` | Recording indicator start |
| `recording:stop` | `{ conversationId }` | Recording indicator stop |
| `activity:ping` | `{}` | Keep online status |
| `messages:sync` | `{ conversationId, lastMessageId }` | Sync missed messages |
| `room:join` | `{ conversationId }` | Join room manually |
| `room:leave` | `{ conversationId }` | Leave room manually |
| `ping` | `{}` | Health check |

### Server → Client Events

| Event | Payload | Description |
|-------|---------|-------------|
| `connected` | `{ userId, socketId, rooms, timestamp }` | Connection established |
| `error` | `{ code, message, timestamp }` | Error response |
| `message:new` | `{ ...message }` | New message |
| `message:updated` | `{ messageId, content, isEdited, updatedAt }` | Message edited |
| `message:deleted` | `{ messageId, conversationId, deletedAt }` | Message deleted |
| `reaction:added` | `{ messageId, conversationId, emoji, userId, totalCount }` | Reaction added |
| `reaction:removed` | `{ messageId, conversationId, emoji, userId, totalCount }` | Reaction removed |
| `message:read` | `{ messageId, conversationId, userId, readAt }` | Message read |
| `conversation:read` | `{ conversationId, userId, upToMessageId?, count, readAt }` | Conversation read |
| `user:typing` | `{ conversationId, userId, type, isActive, timestamp }` | Typing status |
| `user:recording` | `{ conversationId, userId, type, isActive, timestamp }` | Recording status |
| `user:online` | `{ userId, conversationId?, timestamp }` | User online |
| `user:offline` | `{ userId, conversationId?, lastSeen, timestamp }` | User offline |
| `conversation:new` | `{ ...conversation }` | New conversation |
| `conversation:joined` | `{ ...conversation }` | Added to conversation |
| `conversation:removed` | `{ conversationId }` | Removed from conversation |
| `participant:added` | `{ conversationId, userId, timestamp }` | Participant added |
| `participant:removed` | `{ conversationId, userId, timestamp }` | Participant removed |

---

## Path 2: REST API (Frontend → Master → Chat Service)

Purpose: CRUD operations with business logic enforced by Master Service.

Endpoints (proxied by Master):
- Conversations:
  - `POST /api/conversations`
  - `GET /api/conversations`
  - `GET /api/conversations/:id`
  - `DELETE /api/conversations/:id`
  - `POST /api/conversations/:id/participants`
  - `PATCH /api/conversations/:id/participants/:userId`
  - `DELETE /api/conversations/:id/participants/:userId`
- Messages:
  - `POST /api/conversations/:conversationId/messages`
  - `GET /api/conversations/:conversationId/messages`
  - `GET /api/messages/:id`
  - `PATCH /api/messages/:id`
  - `DELETE /api/messages/:id`
- Reactions:
  - `POST /api/messages/:messageId/reactions`
  - `DELETE /api/messages/:messageId/reactions/:emoji`
  - `GET /api/messages/:messageId/reactions`
- Read receipts:
  - `PUT /api/messages/:messageId/read`
  - `PUT /api/conversations/:conversationId/read`
  - `GET /api/messages/:messageId/read`
  - `GET /api/conversations/:conversationId/unread-count`
- Presence:
  - `GET /api/users/:userId/presence`
  - `GET /api/conversations/:conversationId/presence`
  - `POST /api/presence/batch`

---

## Path 3: Internal API (Master → Chat Service)

Purpose: Server-to-server actions (not exposed to frontend).

Endpoints:
- `POST /api/users/sync`
- `POST /api/users/sync/batch`
- `GET /api/users/:externalUserId`
- `DELETE /api/users/:externalUserId`

Authentication: `X-Internal-Secret` header.

---

## Path 4: Webhooks (Chat Service → Master)

Purpose: Notify Master Service of chat events.

Webhook event types:
- `message.created`, `message.updated`, `message.deleted`
- `conversation.created`, `conversation.deleted`
- `participant.added`, `participant.removed`
- `reaction.added`, `reaction.removed`
- `user.online`, `user.offline`

Headers:
- `X-Webhook-Signature`
- `X-Webhook-Event`
- `X-Webhook-Id`

Payload format:
```json
{
  "id": "evt_abc123",
  "type": "message.created",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "data": { "...": "..." }
}
```

---

## Authentication Summary

- REST and WS use the same JWT validation config shared with Master Service (`AUTH_JWT_SECRET` in symmetric mode, or `AUTH_JWT_JWKS_URL` in asymmetric mode).
- Internal API uses `INTERNAL_API_SECRET`.
- Webhooks are signed with `WEBHOOK_SECRET`.

---

## Network Configuration (Suggested)

- REST API (Chat): internal only, proxied by Master
- WebSocket (Chat): public endpoint
- Master Service: public endpoint

Default ports:
- REST: `PORT` (default 3000)
- WebSocket: `WS_PORT` (default 3001)

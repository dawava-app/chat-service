# WebSocket Guide

Default WebSocket URL (dev): `wss://api.dawava.me/ws`

## Authentication
Provide JWT via:
- `auth.token` (preferred)
- `query.token`
- `Authorization: Bearer <token>` header

WebSocket user id claim resolution order:
1. `externalUserId`
2. `sub`

The resolved value must be a non-empty string.

## Connection Example
```javascript
import { io } from 'socket.io-client';

const VALID_JWT_TOKEN = 'YOUR_ACTUAL_JWT_TOKEN_HERE'; 

const socket = io('wss://api.dawava.me', {
  path: '/ws/socket.io', 
  auth: { 
    token: VALID_JWT_TOKEN 
  },
  transports: ['websocket', 'polling'],
});

socket.on('connected', (payload) => {
  console.log('✅ Successfully connected to server!', payload);
  socket.emit('ping', {});
});

socket.on('error', (payload) => {
  console.error('❌ Server returned an error:', payload);
});

// Standard Socket.IO client-side catch-alls
socket.on('connect_error', (err) => {
  console.error('🚨 Network connection failed:', err.message);
});

socket.on('disconnect', (reason) => {
  console.log('🔌 Disconnected. Reason:', reason);
});
```

## Client → Server Events

| Event | Payload | Response | Description |
|-------|---------|----------|-------------|
| message:send | { conversationId, content, attachments?, replyTo? } | { success, message } | Send message |
| message:edit | { messageId, content } | { success, message } | Edit message |
| message:delete | { messageId } | { success } | Delete message |
| reaction:add | { messageId, emoji } | { success, reactions } | Add reaction |
| reaction:remove | { messageId, emoji } | { success, reactions } | Remove reaction |
| message:read | { messageId } | { success, readAt } | Mark message read |
| conversation:read | { conversationId, upToMessageId? } | { success, count } | Mark conversation read |
| typing:start | { conversationId } | { success } | Start typing |
| typing:stop | { conversationId } | { success } | Stop typing |
| recording:start | { conversationId } | { success } | Start recording |
| recording:stop | { conversationId } | { success } | Stop recording |
| activity:ping | {} | { success } | Keep online |
| messages:sync | { conversationId, lastMessageId } | { success, messages } | Sync missed |
| room:join | { conversationId } | { success, room } | Join room |
| room:leave | { conversationId } | { success } | Leave room |
| ping | {} | { event: 'pong', timestamp } | Health |

## Server → Client Events

| Event | Payload | Description |
|-------|---------|-------------|
| connected | { userId, socketId, rooms, timestamp } | Connected |
| error | { code, message, timestamp } | Error |
| message:new | { ...message } | New message |
| message:updated | { messageId, content, isEdited, updatedAt } | Edited |
| message:deleted | { messageId, conversationId, deletedAt } | Deleted |
| reaction:added | { messageId, conversationId, emoji, userId, totalCount } | Reaction added |
| reaction:removed | { messageId, conversationId, emoji, userId, totalCount } | Reaction removed |
| message:read | { messageId, conversationId, userId, readAt } | Message read |
| conversation:read | { conversationId, userId, upToMessageId?, count, readAt } | Conversation read |
| user:typing | { conversationId, userId, type, isActive, timestamp } | Typing status |
| user:recording | { conversationId, userId, type, isActive, timestamp } | Recording status |
| user:online | { userId, conversationId?, timestamp } | Online |
| user:offline | { userId, conversationId?, lastSeen, timestamp } | Offline |
| conversation:new | { ...conversation } | New conversation |
| conversation:joined | { ...conversation } | Added to conversation |
| conversation:removed | { conversationId } | Removed |
| participant:added | { conversationId, userId, timestamp } | Participant added |
| participant:removed | { conversationId, userId, timestamp } | Participant removed |

## Error Codes
- UNAUTHORIZED
- FORBIDDEN
- NOT_FOUND
- VALIDATION_ERROR
- INTERNAL_ERROR

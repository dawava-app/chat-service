# Chat Service

A pluggable, real-time chat microservice built with NestJS, MongoDB, Redis, and Socket.IO.

## Features
- Direct and group conversations
- Message send/edit/delete with attachments
- Real-time messaging over WebSocket
- Emoji reactions and read receipts
- Typing/recording indicators and presence
- Webhooks for host integration
- Horizontal scaling with Redis adapter

## Quick Start

Prerequisites:
- Node.js 18+
- Docker + Docker Compose

1) Copy environment file:
```
cp .env.example .env
```

2) Start dependencies + service:
```
docker-compose --profile with-db up
```

If you use external MongoDB/Redis, omit the profile and set `MONGODB_URI` and `REDIS_URL`.

3) Verify:
```
curl http://localhost:3000/health
```

## Documentation
- API: `docs/API.md`
- WebSocket: `docs/WEBSOCKET.md`
- Webhooks: `docs/WEBHOOKS.md`
- Configuration: `docs/CONFIGURATION.md`
- Integration Guide: `docs/INTEGRATION.md`
- Architecture: `docs/ARCHITECTURE.md`
- Troubleshooting: `docs/TROUBLESHOOTING.md`
- Communication Model: `docs/communication.md`
- Swagger UI: `/api/docs` (runtime)

## Key Endpoints (REST)
- `POST /api/conversations`
- `GET /api/conversations`
- `GET /api/conversations/:id`
- `POST /api/conversations/:id/participants`
- `POST /api/conversations/:id/messages`
- `GET /api/conversations/:id/messages`
- `PATCH /api/messages/:id`
- `DELETE /api/messages/:id`

## WebSocket
Default WebSocket port: `WS_PORT` (default 3001)

JWT auth can run in symmetric mode with `AUTH_JWT_SECRET` or asymmetric mode with `AUTH_JWT_VALIDATION_MODE=asymmetric` plus `AUTH_JWT_JWKS_URL`.

## What's Next (Future Enhancements)

Potential future phases:

**Phase 9: Search**
- Full-text message search
- Elasticsearch/Typesense integration

**Phase 10: File Handling**
- Direct file uploads
- Image thumbnails
- File preview

**Phase 11: Push Notifications**
- FCM/APNs integration
- Email notifications

**Phase 12: Admin Dashboard**
- Usage analytics
- Moderation tools
- User management

**Phase 13: End-to-End Encryption**
- Client-side encryption
- Key exchange

**Phase 14: Threads**
- Threaded replies
- Thread notifications

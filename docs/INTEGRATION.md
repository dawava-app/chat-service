# Integration Guide

This guide shows how to integrate Chat Service with a host/master service.

## Prerequisites
- Docker + Docker Compose
- JWT auth in the master service
- Network access between services

## Step 1: Deploy Chat Service
Use docker-compose or deploy directly:
```
docker-compose --profile with-db up
```
Verify:
```
curl http://localhost:3000/health
```

If you use external MongoDB/Redis, omit the profile and set `MONGODB_URI` and `REDIS_URL`.

## Step 2: Configure Authentication
- `AUTH_JWT_VALIDATION_MODE=symmetric` uses the shared `AUTH_JWT_SECRET`.
- `AUTH_JWT_VALIDATION_MODE=asymmetric` uses the master service JWKS via `AUTH_JWT_JWKS_URL` or inline `AUTH_JWT_JWKS_JSON`.
- `AUTH_JWT_ISSUER` should match the token issuer.
- `AUTH_JWT_AUDIENCE` should match the token audience when one is issued.
- Set `INTERNAL_API_SECRET` for server-to-server calls.
- Private endpoints require both JWT and service token headers.
- Preferred service token header: `X-Service-Token: <INTERNAL_API_SECRET>`.
- Include `externalUserId` as a non-empty string in JWT payloads (recommended for both REST and WebSocket).
- REST compatibility fallback: if `externalUserId` is missing, REST accepts `sub`, then `id` (must still be a non-empty string).
- WebSocket authentication currently resolves user id from `externalUserId`, then `sub`.

## Step 3: Sync Users
Call internal endpoints from master on user create/update:
```
POST /api/users/sync
X-Internal-Secret: <INTERNAL_API_SECRET>
```

## Step 4: Proxy REST API
Master service should proxy chat routes:
- `/api/conversations/*`
- `/api/messages/*`
- `/api/presence/*`

## Step 5: Connect Frontend
Frontend connects directly to Chat Service WS:
```
ws://chat.example.com
```
Use `auth.token` in the Socket.IO handshake. The gateway also accepts `query.token` and `Authorization: Bearer <token>` for Node clients.

## Step 6: Handle Webhooks
Configure:
- `WEBHOOK_URL`
- `WEBHOOK_SECRET`
- `WEBHOOK_ENABLED=true`

Verify signatures with HMAC-SHA256 of raw body.

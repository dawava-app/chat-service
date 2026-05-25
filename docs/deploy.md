## Deployment Options

### Development Mode

For local development with hot-reload:

```bash
docker compose -f docker-compose.dev.yml up
```

This includes MongoDB and Redis, with source code mounted for live updates.

### Option 1: Self-contained (includes databases)

Best for: production demos, isolated deployments, testing

```bash
docker compose --profile with-db up
```

This starts all three containers: `chat-service`, `chat-mongo`, `chat-redis`

### Option 2: External databases (recommended for production)

Best for: production, using managed databases (MongoDB Atlas, AWS ElastiCache)

1. Set environment variables:

```bash
export MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/chat-service
export REDIS_URL=redis://my-redis.cache.amazonaws.com:6379
export AUTH_JWT_VALIDATION_MODE=symmetric
export AUTH_JWT_SECRET=your-secure-secret-key-at-least-32-characters-long
export AUTH_JWT_ISSUER=master-service

# If you validate asymmetric tokens, set:
# export AUTH_JWT_VALIDATION_MODE=asymmetric
# export AUTH_JWT_JWKS_URL=https://portal-gateway/.well-known/jwks.json
```

2. Run without database profile:

```bash
docker compose up
```

This starts only `chat-service` and connects to your external databases.

### How it works

- MongoDB and Redis have the `profiles: [with-db]` tag
- `depends_on` uses `required: false` so the service starts even if databases aren't running
- Without `--profile with-db`, database containers aren't created
- Environment variables use defaults that point to local containers
- Override any variable to point to external services
- No code changes needed—the app connects to whatever URI you provide

### Building the production image

```bash
docker build -t chat-service:latest .
```

The multi-stage Dockerfile creates an optimized production image with only runtime dependencies.
export default () => ({
  app: {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '3000', 10),
    wsPort: parseInt(process.env.WS_PORT ?? '3001', 10),
  },
  logger: {
    level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  },
  mongodb: {
    uri: process.env.MONGODB_URI,
  },
  redis: {
    url: process.env.REDIS_URL,
  },
  auth: {
    jwtValidationMode: process.env.AUTH_JWT_VALIDATION_MODE ?? 'symmetric',
    jwtSecret: process.env.AUTH_JWT_SECRET,
    jwtIssuer: process.env.AUTH_JWT_ISSUER,
    jwtAudience: process.env.AUTH_JWT_AUDIENCE,
    jwtJwks: process.env.AUTH_JWT_JWKS_JSON
      ? JSON.parse(process.env.AUTH_JWT_JWKS_JSON)
      : undefined,
    jwtJwksUrl: process.env.AUTH_JWT_JWKS_URL,
    jwtJwksCacheTtlMs: parseInt(process.env.AUTH_JWT_JWKS_CACHE_TTL_MS ?? `${5 * 60 * 1000}`, 10),
  },
  internal: {
    apiSecret: process.env.INTERNAL_API_SECRET,
  },
  presence: {
    typingTtl: parseInt(process.env.PRESENCE_TYPING_TTL ?? '5', 10),
    recordingTtl: parseInt(process.env.PRESENCE_RECORDING_TTL ?? '30', 10),
    awayThreshold: parseInt(process.env.PRESENCE_AWAY_THRESHOLD ?? `${5 * 60}`, 10),
    lastSeenTtl: parseInt(process.env.PRESENCE_LAST_SEEN_TTL ?? `${30 * 24 * 60 * 60}`, 10),
    activityCheckInterval: parseInt(process.env.PRESENCE_ACTIVITY_CHECK_INTERVAL ?? '60', 10),
  },
  webhook: {
    enabled: process.env.WEBHOOK_ENABLED === 'true',
    url: process.env.WEBHOOK_URL,
    secret: process.env.WEBHOOK_SECRET,
    events: process.env.WEBHOOK_EVENTS,
    retryAttempts: parseInt(process.env.WEBHOOK_RETRY_ATTEMPTS ?? '3', 10),
    timeoutMs: parseInt(process.env.WEBHOOK_TIMEOUT_MS ?? '5000', 10),
  },
  cors: {
    origins: process.env.ALLOWED_ORIGINS?.split(',').map((origin) => origin.trim()) ?? [],
  },
  fileService: {
    url: process.env.FILE_SERVICE_URL,
    token: process.env.FILE_SERVICE_TOKEN || process.env.INTERNAL_API_SECRET,
  },
});

import * as Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  WS_PORT: Joi.number().port().default(3001),
  LOG_LEVEL: Joi.string().valid('trace', 'debug', 'info', 'warn', 'error', 'fatal').default('info'),
  MONGODB_URI: Joi.string().required(),
  REDIS_URL: Joi.string().uri().required(),
  AUTH_JWT_VALIDATION_MODE: Joi.string().valid('symmetric', 'asymmetric').default('symmetric'),
  AUTH_JWT_SECRET: Joi.string()
    .min(32)
    .when('AUTH_JWT_VALIDATION_MODE', {
      is: 'asymmetric',
      then: Joi.string().min(32).optional(),
      otherwise: Joi.string().min(32).required(),
    }),
  AUTH_JWT_ISSUER: Joi.string().default('master-service'),
  AUTH_JWT_AUDIENCE: Joi.string().optional(),
  AUTH_JWT_JWKS_JSON: Joi.string().optional(),
  AUTH_JWT_JWKS_URL: Joi.string().uri().when('AUTH_JWT_VALIDATION_MODE', {
    is: 'asymmetric',
    then: Joi.string().uri().optional(),
    otherwise: Joi.string().uri().optional(),
  }),
  AUTH_JWT_JWKS_CACHE_TTL_MS: Joi.number()
    .integer()
    .min(1000)
    .default(5 * 60 * 1000),
  INTERNAL_API_SECRET: Joi.string().min(32).required(),
  PRESENCE_TYPING_TTL: Joi.number().integer().min(1).default(5),
  PRESENCE_RECORDING_TTL: Joi.number().integer().min(1).default(30),
  PRESENCE_AWAY_THRESHOLD: Joi.number().integer().min(1).default(300),
  PRESENCE_LAST_SEEN_TTL: Joi.number().integer().min(1).default(2592000),
  PRESENCE_ACTIVITY_CHECK_INTERVAL: Joi.number().integer().min(1).default(60),
  WEBHOOK_URL: Joi.string().uri().optional(),
  WEBHOOK_SECRET: Joi.string().min(32).optional(),
  WEBHOOK_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  WEBHOOK_EVENTS: Joi.string().optional(),
  WEBHOOK_RETRY_ATTEMPTS: Joi.number().integer().min(1).default(3),
  WEBHOOK_TIMEOUT_MS: Joi.number().integer().min(1000).default(5000),
  ALLOWED_ORIGINS: Joi.string().optional(),
});

# Configuration Reference

All configuration is provided via environment variables.

## Application
| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3000 | REST API port |
| WS_PORT | 3001 | WebSocket port |
| NODE_ENV | development | Runtime environment |
| LOG_LEVEL | info | Logger level |

## Database
| Variable | Default | Description |
|----------|---------|-------------|
| MONGODB_URI | - | MongoDB connection string |
| REDIS_URL | - | Redis connection string |

## Authentication
| Variable | Default | Description |
|----------|---------|-------------|
| AUTH_JWT_VALIDATION_MODE | symmetric | JWT validation mode: `symmetric` or `asymmetric` |
| AUTH_JWT_SECRET | - | Shared JWT secret for symmetric validation |
| AUTH_JWT_ISSUER | - | Expected JWT issuer |
| AUTH_JWT_AUDIENCE | - | Expected JWT audience |
| AUTH_JWT_JWKS_JSON | - | Inline JWKS document JSON for asymmetric validation |
| AUTH_JWT_JWKS_URL | - | JWKS endpoint for asymmetric validation |
| AUTH_JWT_JWKS_CACHE_TTL_MS | 300000 | JWKS cache TTL in milliseconds |
| INTERNAL_API_SECRET | - | Secret for internal API |

## Webhooks
| Variable | Default | Description |
|----------|---------|-------------|
| WEBHOOK_ENABLED | false | Enable webhooks |
| WEBHOOK_URL | - | Webhook endpoint |
| WEBHOOK_SECRET | - | HMAC secret |
| WEBHOOK_EVENTS | - | Comma-separated filter |
| WEBHOOK_RETRY_ATTEMPTS | 3 | Max attempts |
| WEBHOOK_TIMEOUT_MS | 5000 | Request timeout |

## CORS
| Variable | Default | Description |
|----------|---------|-------------|
| ALLOWED_ORIGINS | empty | Comma-separated origins |

## Presence
| Variable | Default | Description |
|----------|---------|-------------|
| PRESENCE_TYPING_TTL | 5 | Typing TTL (seconds) |
| PRESENCE_RECORDING_TTL | 30 | Recording TTL (seconds) |
| PRESENCE_AWAY_THRESHOLD | 300 | Away threshold (seconds) |
| PRESENCE_LAST_SEEN_TTL | 2592000 | Last seen TTL (seconds) |
| PRESENCE_ACTIVITY_CHECK_INTERVAL | 60 | Check interval (seconds) |

import { Inject, Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createPublicKey } from 'node:crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module';

export type JwtValidationMode = 'symmetric' | 'asymmetric';

interface DecodedJwt {
  header?: {
    kid?: string;
  };
}

interface JwksDocument {
  keys?: Array<Record<string, unknown>>;
}

interface CachedJwks {
  expiresAt: number;
  keysByKid: Map<string, string>;
}

interface SerializedCachedJwks {
  expiresAt: number;
  keys: Array<[string, string]>;
}

const JWKS_CACHE_KEY = 'auth:jwks-cache';

@Injectable()
export class JwtVerificationService {
  private readonly logger = new Logger(JwtVerificationService.name);
  private cachedJwks?: CachedJwks;
  private cachedJwksPromise?: Promise<CachedJwks>;

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    @Optional()
    @Inject(REDIS_CLIENT)
    private readonly redisClient?: Redis,
  ) {}

  async verifyToken<T extends object>(token: string): Promise<T> {
    const mode = this.getValidationMode();
    this.logger.debug(`Starting token verification in ${mode} mode`);

    try {
      const secretOrKey = await this.resolveVerificationSecret(token);
      const issuer = this.configService.get<string>('auth.jwtIssuer');
      const audience = this.configService.get<string>('auth.jwtAudience');

      const result = await this.jwtService.verifyAsync<T>(token, {
        secret: secretOrKey,
        ...(issuer ? { issuer } : {}),
        ...(audience ? { audience } : {}),
        ...(mode === 'asymmetric' ? { algorithms: ['RS256'] } : {}),
      });

      this.logger.debug('Token verification succeeded');
      return result;
    } catch (error) {
      this.logger.error(`Token verification failed: ${(error as Error).message}`);
      throw new UnauthorizedException('Invalid authentication token');
    }
  }

  async resolveVerificationSecret(token: string): Promise<string> {
    if (this.getValidationMode() === 'symmetric') {
      return this.configService.getOrThrow<string>('auth.jwtSecret');
    }

    const kid = this.extractKeyId(token);
    const jwks = await this.getJwks();
    const publicKey = jwks.keysByKid.get(kid);

    if (!publicKey) {
      this.logger.warn(`Public key not found for kid: ${kid}`);
      throw new UnauthorizedException('Invalid authentication token');
    }

    return publicKey;
  }

  private getValidationMode(): JwtValidationMode {
    return this.configService.get<JwtValidationMode>('auth.jwtValidationMode') ?? 'symmetric';
  }

  private extractKeyId(token: string): string {
    try {
      const decoded = this.jwtService.decode(token, { complete: true }) as DecodedJwt | null;
      const kid = decoded?.header?.kid?.trim();

      if (!kid) {
        this.logger.warn('Token decoding failed or did not contain a valid kid');
        throw new UnauthorizedException('Invalid authentication token');
      }

      return kid;
    } catch (error) {
      this.logger.error(`Failed to decode token structure: ${(error as Error).message}`);
      throw new UnauthorizedException('Invalid authentication token');
    }
  }

  private async getJwks(): Promise<CachedJwks> {
    const cache = this.cachedJwks;
    if (cache && cache.expiresAt > Date.now()) {
      return cache;
    }

    if (cache) {
      this.logger.log('In-memory JWKS cache expired. Refreshing...');
    }

    if (!this.cachedJwksPromise) {
      this.logger.debug('No active JWKS fetch flight. Initiating unique loading promise.');
      this.cachedJwksPromise = this.loadOrFetchJwks().finally(() => {
        this.cachedJwksPromise = undefined;
      });
    } else {
      this.logger.debug('Coalescing JWKS request into active pending promise');
    }

    try {
      const jwks = await this.cachedJwksPromise;
      this.cachedJwks = jwks;
      return jwks;
    } catch (error) {
      this.logger.error(`Failed to retrieve fresh JWKS: ${(error as Error).message}`);
      if (cache) {
        this.logger.warn('Serving stale in-memory JWKS cache as fallback');
        return cache;
      }

      throw error;
    }
  }

  private async loadOrFetchJwks(): Promise<CachedJwks> {
    const staticJwks = this.configService.get<JwksDocument | undefined>('auth.jwtJwks');
    if (staticJwks) {
      this.logger.log('Loading JWKS from static configurations');
      return this.createCachedJwks(staticJwks);
    }

    const cachedJwks = await this.readCachedJwks();
    if (cachedJwks) {
      this.logger.debug('JWKS cache hit via Redis');
      return cachedJwks;
    }

    this.logger.log('JWKS cache miss everywhere. Fetching fresh JWKS remotely...');
    const jwks = await this.fetchJwks();
    await this.writeCachedJwks(jwks);
    return jwks;
  }

  private createCachedJwks(jwks: JwksDocument): CachedJwks {
    const cacheTtlMs = this.configService.get<number>('auth.jwtJwksCacheTtlMs') ?? 5 * 60 * 1000;
    const keysByKid = new Map<string, string>();

    for (const jwk of jwks.keys ?? []) {
      const kid = typeof jwk.kid === 'string' ? jwk.kid.trim() : '';
      if (!kid) {
        this.logger.warn('Encountered an anonymous or empty kid property in JWKS payload');
        continue;
      }

      try {
        const publicKey = createPublicKey({ key: jwk as any, format: 'jwk' })
          .export({ format: 'pem', type: 'spki' })
          .toString();

        keysByKid.set(kid, publicKey);
      } catch (error) {
        this.logger.error(`Crypto error: parsing JWK failed for kid: ${kid}. Error: ${(error as Error).message}`);
        continue;
      }
    }

    if (keysByKid.size === 0) {
      this.logger.error('The parsed JWKS map resulted in zero valid public PEM keys');
      throw new UnauthorizedException('Invalid authentication token');
    }

    return {
      expiresAt: Date.now() + cacheTtlMs,
      keysByKid,
    };
  }

  private async readCachedJwks(): Promise<CachedJwks | undefined> {
    if (!this.redisClient) {
      return undefined;
    }

    try {
      const cachedValue = await this.redisClient.get(JWKS_CACHE_KEY);
      if (!cachedValue) {
        return undefined;
      }

      const parsed = JSON.parse(cachedValue) as SerializedCachedJwks;
      if (!parsed?.expiresAt || !Array.isArray(parsed.keys) || parsed.expiresAt <= Date.now()) {
        this.logger.warn('Redis JWKS entry payload invalid or expired. Purging cache key...');
        await this.redisClient.del(JWKS_CACHE_KEY).catch(() => undefined);
        return undefined;
      }

      const keysByKid = new Map<string, string>(
        parsed.keys.filter(
          (entry): entry is [string, string] =>
            Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string',
        ),
      );

      if (keysByKid.size === 0) {
        return undefined;
      }

      return {
        expiresAt: parsed.expiresAt,
        keysByKid,
      };
    } catch (error) {
      this.logger.error(`Error reading or decoding Redis JWKS cache payload: ${(error as Error).message}`);
      return undefined;
    }
  }

  private async writeCachedJwks(jwks: CachedJwks): Promise<void> {
    if (!this.redisClient) {
      return;
    }

    const ttlMs = jwks.expiresAt - Date.now();
    if (ttlMs <= 0) {
      return;
    }

    const payload: SerializedCachedJwks = {
      expiresAt: jwks.expiresAt,
      keys: Array.from(jwks.keysByKid.entries()),
    };

    try {
      await this.redisClient.set(JWKS_CACHE_KEY, JSON.stringify(payload), 'PX', ttlMs);
      this.logger.debug(`Successfully populated Redis JWKS cache for the next ${ttlMs}ms`);
    } catch (error) {
      this.logger.warn(`Failed to commit JWKS to Redis cache layer optimization: ${(error as Error).message}`);
    }
  }

  private async fetchJwks(): Promise<CachedJwks> {
    const jwksUrl = this.configService.getOrThrow<string>('auth.jwtJwksUrl');
    this.logger.debug(`HTTP GET request dispatched to remote JWKS endpoint: ${jwksUrl}`);
    
    try {
      const response = await fetch(jwksUrl, {
        headers: {
          accept: 'application/json',
        },
      });

      if (!response.ok) {
        this.logger.error(`Remote JWKS HTTP resource responded with status code: ${response.status}`);
        throw new UnauthorizedException('Invalid authentication token');
      }

      const jwks = (await response.json()) as JwksDocument;
      return this.createCachedJwks(jwks);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.error(`Network or fetch pipeline disruption pointing to remote JWKS: ${(error as Error).message}`);
      throw new UnauthorizedException('Invalid authentication token');
    }
  }
}
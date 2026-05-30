import { Inject, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
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
    const secretOrKey = await this.resolveVerificationSecret(token);
    const issuer = this.configService.get<string>('auth.jwtIssuer');
    const audience = this.configService.get<string>('auth.jwtAudience');
    const mode = this.getValidationMode();

    return this.jwtService.verifyAsync<T>(token, {
      secret: secretOrKey,
      ...(issuer ? { issuer } : {}),
      ...(audience ? { audience } : {}),
      ...(mode === 'asymmetric' ? { algorithms: ['RS256'] } : {}),
    });
  }

  async resolveVerificationSecret(token: string): Promise<string> {
    if (this.getValidationMode() === 'symmetric') {
      return this.configService.getOrThrow<string>('auth.jwtSecret');
    }

    const kid = this.extractKeyId(token);
    const jwks = await this.getJwks();
    const publicKey = jwks.keysByKid.get(kid);

    if (!publicKey) {
      throw new UnauthorizedException('Invalid authentication token');
    }

    return publicKey;
  }

  private getValidationMode(): JwtValidationMode {
    return this.configService.get<JwtValidationMode>('auth.jwtValidationMode') ?? 'symmetric';
  }

  private extractKeyId(token: string): string {
    const decoded = this.jwtService.decode(token, { complete: true }) as DecodedJwt | null;
    const kid = decoded?.header?.kid?.trim();

    if (!kid) {
      throw new UnauthorizedException('Invalid authentication token');
    }

    return kid;
  }

  private async getJwks(): Promise<CachedJwks> {
    const cache = this.cachedJwks;
    if (cache && cache.expiresAt > Date.now()) {
      return cache;
    }

    if (!this.cachedJwksPromise) {
      this.cachedJwksPromise = this.loadOrFetchJwks().finally(() => {
        this.cachedJwksPromise = undefined;
      });
    }

    try {
      const jwks = await this.cachedJwksPromise;
      this.cachedJwks = jwks;
      return jwks;
    } catch (error) {
      if (cache) {
        return cache;
      }

      throw error;
    }
  }

  private async loadOrFetchJwks(): Promise<CachedJwks> {
    const staticJwks = this.configService.get<JwksDocument | undefined>('auth.jwtJwks');
    if (staticJwks) {
      return this.createCachedJwks(staticJwks);
    }

    const cachedJwks = await this.readCachedJwks();
    if (cachedJwks) {
      return cachedJwks;
    }

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
        continue;
      }

      try {
        const publicKey = createPublicKey({ key: jwk as any, format: 'jwk' })
          .export({ format: 'pem', type: 'spki' })
          .toString();

        keysByKid.set(kid, publicKey);
      } catch {
        continue;
      }
    }

    if (keysByKid.size === 0) {
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
    } catch {
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
    } catch {
      // Redis is an optimization; continue without failing auth if the cache write fails.
    }
  }

  private async fetchJwks(): Promise<CachedJwks> {
    const jwksUrl = this.configService.getOrThrow<string>('auth.jwtJwksUrl');
    const response = await fetch(jwksUrl, {
      headers: {
        accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new UnauthorizedException('Invalid authentication token');
    }

    const jwks = (await response.json()) as JwksDocument;
    return this.createCachedJwks(jwks);
  }
}

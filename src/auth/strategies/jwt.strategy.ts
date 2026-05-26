import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import {
  AuthenticatedUser,
  JwtPayload,
} from '../../common/interfaces/authenticated-user.interface';
import { JwtVerificationService } from '../services/jwt-verification.service';

export function extractExternalUserId(payload: JwtPayload): string | null {
  const externalUserIdCandidate = payload.externalUserId ?? payload.sub ?? payload.id;

  if (typeof externalUserIdCandidate !== 'string') {
    return null;
  }

  const externalUserId = externalUserIdCandidate.trim();
  return externalUserId.length > 0 ? externalUserId : null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly jwtVerificationService: JwtVerificationService,
  ) {
    const issuer = configService.get<string>('auth.jwtIssuer');

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKeyProvider: (_request, rawJwtToken, done) => {
        void this.jwtVerificationService
          .resolveVerificationSecret(rawJwtToken)
          .then((secret) => done(null, secret))
          .catch((error) => done(error as Error, undefined));
      },
      ...(issuer ? { issuer } : {}),
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    const externalUserId = extractExternalUserId(payload);

    if (!externalUserId) {
      throw new UnauthorizedException('Missing external user id');
    }

    return {
      externalUserId,
      claims: payload,
    };
  }
}

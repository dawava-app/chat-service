import { CanActivate, Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { JwtVerificationService } from '../../auth/services/jwt-verification.service';
import { SocketUserData } from '../interfaces/socket-user-data.interface';

interface JwtPayload {
  externalUserId?: string;
  sub?: string;
}

@Injectable()
export class WsAuthGuard implements CanActivate {
  constructor(private readonly jwtVerificationService: JwtVerificationService) {}

  async canActivate(context: any): Promise<boolean> {
    const client: Socket = context.switchToWs().getClient();
    const token = this.extractToken(client);

    if (!token) {
      throw new WsException({ code: 'UNAUTHORIZED', message: 'Missing authentication token' });
    }

    try {
      const payload = await this.jwtVerificationService.verifyToken<JwtPayload>(token);
      const externalUserId = payload.externalUserId ?? payload.sub;

      if (!externalUserId) {
        throw new WsException({ code: 'UNAUTHORIZED', message: 'Invalid authentication token' });
      }

      const user: SocketUserData = {
        externalUserId,
        conversationIds: [],
        connectedAt: new Date(),
        claims: payload,
      };

      (client as unknown as { user?: SocketUserData }).user = user;
      return true;
    } catch {
      throw new WsException({ code: 'UNAUTHORIZED', message: 'Invalid authentication token' });
    }
  }

  private extractToken(socket: Socket): string | null {
    const authToken = socket.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken) {
      return authToken;
    }

    const queryToken = socket.handshake.query?.token;
    if (typeof queryToken === 'string' && queryToken) {
      return queryToken;
    }

    const authHeader = socket.handshake.headers?.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    return null;
  }
}

import { ExecutionContext } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { JwtVerificationService } from '../../auth/services/jwt-verification.service';
import { WsAuthGuard } from './ws-auth.guard';

describe('WsAuthGuard', () => {
  const makeContext = (handshake: Record<string, any>) => {
    const client = { handshake };

    return {
      switchToWs: () => ({
        getClient: () => client,
      }),
      __client: client,
    } as unknown as ExecutionContext & { __client: { handshake: Record<string, any>; user?: any } };
  };

  const makeJwtVerificationService = () =>
    ({
      verifyToken: jest.fn(),
    }) as unknown as JwtVerificationService;

  it.each([
    ['auth token', { auth: { token: 'token-auth' } }, 'token-auth'],
    ['query token', { query: { token: 'token-query' } }, 'token-query'],
    [
      'authorization header',
      { headers: { authorization: 'Bearer token-header' } },
      'token-header',
    ],
  ])('accepts token from %s', async (_label, handshake, token) => {
    const jwtVerificationService = makeJwtVerificationService();
    (jwtVerificationService.verifyToken as jest.Mock).mockResolvedValue({ sub: 'user-1' });

    const guard = new WsAuthGuard(jwtVerificationService);
    const context = makeContext(handshake as Record<string, any>);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(jwtVerificationService.verifyToken).toHaveBeenCalledWith(token);
    expect(context.__client.user).toEqual(
      expect.objectContaining({
        externalUserId: 'user-1',
      }),
    );
  });

  it('rejects missing token during handshake', async () => {
    const jwtVerificationService = makeJwtVerificationService();
    const guard = new WsAuthGuard(jwtVerificationService);
    const context = makeContext({});

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(WsException);
    expect(jwtVerificationService.verifyToken).not.toHaveBeenCalled();
  });

  it('rejects invalid payloads from token verification', async () => {
    const jwtVerificationService = makeJwtVerificationService();
    (jwtVerificationService.verifyToken as jest.Mock).mockResolvedValue({});

    const guard = new WsAuthGuard(jwtVerificationService);
    const context = makeContext({ auth: { token: 'token-auth' } });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(WsException);
  });
});
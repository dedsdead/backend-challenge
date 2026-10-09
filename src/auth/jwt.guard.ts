import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Global authentication guard (plan T044). Verifies the bearer JWT against the
 * Keycloak realm's JWKS endpoint (issuer + audience + expiry). Fails closed:
 * any verification problem (missing header, bad token, unreachable JWKS)
 * yields 401 UNAUTHORIZED. @Public() routes skip verification entirely.
 */
@Injectable()
export class JwtGuard implements CanActivate {
  private jwks?: { issuer: string; getKey: JWTVerifyGetKey };

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const header: unknown = request.headers?.authorization;
    if (typeof header !== 'string') throw new UnauthorizedException();
    const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
    if (!match) throw new UnauthorizedException();

    const token = match[1]!;
    // Fail fast on obviously malformed JWT (must have 3 base64url segments)
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
      throw new UnauthorizedException();
    }

    const issuer = this.config.getOrThrow<string>('KEYCLOAK_ISSUER');
    const audience = this.config.getOrThrow<string>('KEYCLOAK_AUDIENCE');
    
    // Validate issuer host against expected host if configured (prevents JWKS confusion)
    const expectedIssuerHost = this.config.get<string>('KEYCLOAK_EXPECTED_ISSUER_HOST');
    if (expectedIssuerHost) {
      const issuerUrl = new URL(issuer);
      if (issuerUrl.hostname !== expectedIssuerHost) {
        throw new UnauthorizedException();
      }
    }
    
    try {
      const { payload } = await jwtVerify(match[1]!, this.getKey(issuer), {
        issuer,
        audience,
      });
      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }

  private getKey(issuer: string): JWTVerifyGetKey {
    if (!this.jwks || this.jwks.issuer !== issuer) {
      this.jwks = {
        issuer,
        getKey: createRemoteJWKSet(
          new URL(`${issuer}/protocol/openid-connect/certs`),
        ),
      };
    }
    return this.jwks.getKey;
  }
}

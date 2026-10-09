import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { localIdentity } from './local-auth';
import { normalizeEntraRoles } from '../../../packages/core/src';
export const Roles = (...values: string[]) => SetMetadata('roles', values);
@Injectable()
export class AuthGuard implements CanActivate {
  private jwks = createRemoteJWKSet(
    new URL(
      `https://login.microsoftonline.com/${process.env.ENTRA_TENANT_ID || 'organizations'}/discovery/v2.0/keys`,
    ),
  );
  constructor(@Inject(Reflector) private reflector: Reflector) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const local = (process.env.AUTH_MODE || 'local') === 'local';
    if (local && !['GET', 'HEAD', 'OPTIONS'].includes(req.method || 'GET')) {
      const origin = req.headers.origin;
      if (origin && origin !== (process.env.WEB_ORIGIN || 'http://localhost:3000'))
        throw new ForbiddenException('Origin is not permitted');
    }
    if (this.reflector.get<boolean>('public', ctx.getHandler())) return true;
    if (local) {
      req.user = await localIdentity(req);
      if (!req.user) throw new UnauthorizedException('Please sign in');
    } else if (process.env.AUTH_DEMO === 'true' && process.env.NODE_ENV !== 'production')
      req.user = { id: 'demo-engineer', name: 'Alex Morgan', roles: ['Administrator'] };
    else {
      const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
      if (!token) throw new UnauthorizedException();
      try {
        const { payload } = await jwtVerify(token, this.jwks, {
          issuer: `https://login.microsoftonline.com/${process.env.ENTRA_TENANT_ID}/v2.0`,
          audience: process.env.ENTRA_AUDIENCE,
          algorithms: ['RS256'],
        });
        if (payload.tid !== process.env.ENTRA_TENANT_ID || typeof payload.oid !== 'string')
          throw new Error('Invalid tenant or subject');
        const userRoles = normalizeEntraRoles(payload.roles);
        if (!userRoles.length) throw new Error('No assigned application role');
        req.user = { id: payload.oid, name: payload.name, roles: userRoles };
      } catch {
        throw new UnauthorizedException('Invalid access token or role assignment');
      }
    }
    const required = this.reflector.getAllAndOverride<string[]>('roles', [ctx.getHandler(), ctx.getClass()]);
    if (required && !required.some((r) => req.user.roles.includes(r)))
      throw new ForbiddenException('Role does not permit this operation');
    return true;
  }
}

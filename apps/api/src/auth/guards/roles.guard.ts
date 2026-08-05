/**
 * Narrows a route to specific roles, declared with @Roles().
 *
 * WHY A ROUTE WITH NO @Roles IS OPEN TO EVERY AUTHENTICATED ROLE
 *
 * That looks fail-open and is not. Three separate layers already answered
 * different questions by the time this guard runs: JwtAuthGuard decided whether
 * the caller is authenticated at all, RLS decides which rows exist for them, and
 * ResourceOwnerGuard decides whether a specific addressed row is inside their
 * slice. @Roles is an ADDITIONAL narrowing on top of that, for routes where the
 * role itself is the restriction — "only an Owner may create a Manager".
 *
 * Requiring @Roles on every route would mean annotating /me with all three roles,
 * and every future read route likewise. A list that must name everyone is a list
 * nobody maintains, and the failure mode of an over-broad @Roles that was added
 * only to satisfy a lint rule is worse than its absence — it reads like a
 * considered decision when it was not.
 *
 * The role is never taken from the token. request.user is built by
 * JwtStrategy.validate() from a fresh read of the user row (jwt.strategy.ts), so
 * a forged `role` claim buys nothing here.
 */
import {
  ForbiddenException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { CurrentUser, UserRole } from '../../db/tenant-context';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Handler first, then controller — the same precedence JwtAuthGuard uses, so
    // a @Roles on a handler can narrow a controller-level one.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as CurrentUser | undefined;

    // Belt and braces. JwtAuthGuard runs first and would already have thrown 401
    // on a non-@Public() route, so reaching here with no user means the global
    // guard order regressed. Throw rather than assume, and throw Forbidden
    // rather than let `undefined` fall through the includes() check below.
    if (!user) {
      throw new ForbiddenException();
    }

    if (!required.includes(user.role)) {
      // 403, not 404: the caller is authenticated and the route exists — we are
      // refusing the ACTION, not concealing a resource. Concealment is
      // ResourceOwnerGuard's job, where the row's existence is the secret.
      throw new ForbiddenException();
    }

    return true;
  }
}

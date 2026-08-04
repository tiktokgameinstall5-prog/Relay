import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { CurrentUser as CurrentUserType } from '../../db/tenant-context';

/**
 * Injects the caller attached by JwtStrategy.validate().
 *
 * Only reachable on a guarded route: on a @Public() route there is no user, and
 * the type would lie. Throws rather than returning undefined so that mistake
 * surfaces as an error instead of a silently unscoped query.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserType => {
    const request = ctx.switchToHttp().getRequest<{ user?: CurrentUserType }>();
    if (!request.user) {
      throw new Error(
        'CurrentUser used on a route with no authenticated user. ' +
          'Remove @Public() or stop using this decorator here.',
      );
    }
    return request.user;
  },
);

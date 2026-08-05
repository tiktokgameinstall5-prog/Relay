/**
 * Asserts that a row addressed by a route param is inside the caller's tenant
 * slice, and returns 404 if it is not.
 *
 * This is the application-layer half of what CLAUDE.md §1 asks for ("Enforce via
 * row-level security or middleware" — this project does both). RLS already fails
 * closed on a cross-tenant id guess, but the failure surfaces as whatever each
 * handler happens to do with zero rows, which is inconsistent per route. This
 * makes it one uniform, testable answer.
 *
 * WHAT THIS GUARD ANSWERS, AND WHAT IT DOES NOT
 *
 * It answers "is this row inside your tenant slice" — nothing more. That is the
 * correct contract for READS, and deliberately permits a member to address a
 * teammate: the leaderboard (§4) and the relay chain (§9) both require members to
 * see each other, and test/tenant-guards.e2e-spec.ts pins memberA1 -> memberA2 as
 * 200 so that nobody later reads it as a leak and "fixes" it into a self-only
 * check that breaks both features.
 *
 * It is NOT sufficient to authorize a WRITE. A member's RLS predicate is
 * identical to their manager's, so every teammate passes this check; and guards
 * run in a separate transaction from the handler, so a guard-based check-then-act
 * is racy by construction. Write authorization belongs in the writing statement's
 * WHERE clause. See "Phase 2 write-authorization constraint" in PROGRESS.md — do
 * not rediscover this the hard way in Phase 2.
 *
 * WHY 404 AND NEVER 403
 *
 * A 403 would confirm the row exists in somebody else's tenant, which is exactly
 * the id-guessing disclosure §1 forbids. §11 permits "empty result or 403"; 404
 * is the stricter end of that range and makes a cross-tenant id byte-identical to
 * a nonexistent one. A malformed (non-uuid) param is also 404, checked before the
 * query, so Postgres's invalid-uuid error cannot surface as a 500 that
 * distinguishes "wrong shape" from "not yours".
 *
 * WHY THIS USES withTenant() AND NOT db.tx()
 *
 * Nest runs guards BEFORE interceptors, and that order is not configurable. So
 * TenantContextInterceptor has not run yet and there is no ambient scope —
 * db.tx() would throw. The context is passed explicitly, derived from
 * request.user, which JwtStrategy.validate() built from a fresh read of the user
 * row rather than from token claims.
 */
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { DbService } from '../../db/db.service';
import { tenantContextOf, type CurrentUser } from '../../db/tenant-context';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import {
  OWNED_RESOURCE_KEY,
  OWNED_TABLES,
  type OwnedResourceOptions,
} from '../decorators/owned-resource.decorator';

/** Postgres accepts some looser forms; this is the canonical 8-4-4-4-12 hex. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ResourceOwnerGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(DbService) private readonly db: DbService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const options = this.reflector.getAllAndOverride<OwnedResourceOptions | undefined>(
      OWNED_RESOURCE_KEY,
      [context.getHandler(), context.getClass()],
    );
    // No @OwnedResource means the route addresses no specific row. Nothing to
    // check here; RLS still scopes whatever the handler reads.
    if (!options) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as CurrentUser | undefined;
    // Same reasoning as RolesGuard: unreachable unless the global guard order
    // regressed, so refuse rather than query with no context.
    if (!user) throw new ForbiddenException();

    const id = (request.params as Record<string, string | undefined>)[options.param];

    // Not a uuid — 404, before touching the database, so an invalid cast cannot
    // become a 500 that tells the caller their guess was at least well-formed.
    if (!id || !UUID_RE.test(id)) throw new NotFoundException();

    // Safe interpolation: the value comes from the frozen OWNED_TABLES map and
    // the decorator's `table` is typed to its keys, so this can only ever be one
    // of the literals written in that file. The ID is bound as $1.
    const table = OWNED_TABLES[options.table];

    const found = await this.db.withTenant(tenantContextOf(user), async (c) => {
      const { rowCount } = await c.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id]);
      return (rowCount ?? 0) > 0;
    });

    // Zero rows means either "does not exist" or "not in your slice" — RLS
    // filtered it and the guard cannot tell which. That is the point: the caller
    // cannot tell either.
    if (!found) throw new NotFoundException();

    return true;
  }
}

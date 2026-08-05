/**
 * Trivial routes that exist only to observe the tenant scope.
 *
 * TEST-ONLY. Imported by the e2e spec's TestingModule alongside AppModule, never
 * by AppModule itself, so it cannot ship. If this file ever appears in an import
 * under src/, that is a bug.
 *
 * Real routes are a poor probe: /me proves the scope reaches a service, but it
 * cannot show what the scope *contains*, cannot be made @Public(), and cannot
 * demonstrate that two tx() calls in one request each see the same context.
 */
import { Controller, Get, Inject, Module } from '@nestjs/common';
import { DbService } from '../../src/db/db.service';
import { currentTenantScope } from '../../src/db/tenant-scope';
import { Public } from '../../src/auth/decorators/public.decorator';

@Controller('probe')
export class ProbeController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /** The scope as the handler sees it — the interceptor's actual output. */
  @Get('scope')
  scope() {
    return { scope: currentTenantScope() ?? null };
  }

  /**
   * What the DATABASE sees, which is the claim that matters. A scope object the
   * handler can read proves nothing if the session variables end up unset.
   */
  @Get('db-scope')
  async dbScope() {
    return this.db.tx(async (c) => {
      const { rows } = await c.query<{
        org_id: string | null;
        role: string | null;
        manager_id: string | null;
      }>(
        `SELECT NULLIF(current_setting('app.current_org_id', true), '')     AS org_id,
                NULLIF(current_setting('app.current_role', true), '')       AS role,
                NULLIF(current_setting('app.current_manager_id', true), '') AS manager_id`,
      );
      return rows[0];
    });
  }

  /**
   * Two separate tx() calls in one request. Each takes its own connection from
   * the pool and its own transaction, so this is where a scope that survived
   * only the first await would show up.
   */
  @Get('db-scope-twice')
  async dbScopeTwice() {
    const read = async () =>
      this.db.tx(async (c) => {
        const { rows } = await c.query<{ org_id: string | null }>(
          `SELECT NULLIF(current_setting('app.current_org_id', true), '') AS org_id`,
        );
        return rows[0].org_id;
      });
    return { first: await read(), second: await read() };
  }

  /** How many rows the caller's tenant slice contains — the isolation check. */
  @Get('visible-users')
  async visibleUsers() {
    return this.db.tx(async (c) => {
      const { rows } = await c.query<{ id: string }>('SELECT id FROM "user" ORDER BY id');
      return { ids: rows.map((r) => r.id) };
    });
  }

  /** No scope here. db.tx() must throw rather than query context-free. */
  @Public()
  @Get('public-tx')
  async publicTx() {
    return this.db.tx(async () => ({ reached: true }));
  }

  /** A @Public() route sees no scope at all, rather than a stale one. */
  @Public()
  @Get('public-scope')
  publicScope() {
    return { scope: currentTenantScope() ?? null };
  }
}

@Module({ controllers: [ProbeController] })
export class ProbeModule {}

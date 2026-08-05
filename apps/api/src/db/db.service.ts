/**
 * The single runtime path to Postgres.
 *
 * Everything here exists to make the tenant context impossible to forget. There
 * is no method that hands out a raw connection: to get a client you must go
 * through withTenant (context set) or withoutTenant (explicitly no context, for
 * the two pre-auth definer calls). That is not a convenience API, it is the
 * enforcement point — CLAUDE.md §1 requires server-side scoping on every query,
 * and RLS is the backstop for when a `WHERE` is forgotten, not the first line.
 *
 * Mirrors test/helpers/db.ts, whose shape the 34-test isolation suite already
 * proves. Keeping them identical means the tested path and the shipped path
 * cannot drift.
 */
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { ConfigService } from '@nestjs/config';
import { appEnv } from '../config/configuration';
import type { TenantContext } from './tenant-context';
import { requireTenantScope } from './tenant-scope';

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);
  private readonly pool: Pool;

  constructor(@Inject(ConfigService) config: ConfigService) {
    const env = appEnv(config);
    // DATABASE_URL is the relay_app role. env.validation.ts refuses to boot if
    // it points at relay_migrator, which owns the tables and holds DDL rights.
    this.pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });
  }

  async onModuleInit(): Promise<void> {
    // Fail at startup rather than on the first request. A bad DATABASE_URL is a
    // deployment error, and finding it here means the process never reports
    // healthy while unable to serve.
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query<{ role: string; bypassrls: boolean }>(
        `SELECT current_user AS role,
                (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypassrls`,
      );
      const { role, bypassrls } = rows[0];
      if (bypassrls) {
        // Would silently disable every RLS policy in the database.
        throw new Error(
          `Runtime database role "${role}" has BYPASSRLS. Tenant isolation would be ` +
            `unenforced. Run npm run db:check.`,
        );
      }
      this.logger.log(`Connected as "${role}" (BYPASSRLS: no)`);
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Run `fn` in a transaction with the three RLS session variables set
   * transaction-locally.
   *
   * The `true` third argument to set_config is load-bearing: it scopes each
   * setting to this transaction, so a pooled connection cannot carry one
   * tenant's context into the next request. rls.e2e-spec.ts tests exactly that
   * property — without it, request N+1 on a reused connection would inherit
   * request N's tenant.
   *
   * Commits on success, rolls back on throw.
   */
  async withTenant<T>(ctx: TenantContext, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.current_org_id', $1, true),
                set_config('app.current_role', $2, true),
                set_config('app.current_manager_id', $3, true)`,
        // Empty string, not null: set_config rejects a null value. The policies
        // compare against NULLIF(..., '') so '' and unset behave identically —
        // which is what an owner's absent manager_id must mean.
        [ctx.orgId, ctx.role, ctx.managerId ?? ''],
      );
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * `withTenant`, using the ambient context of the current request.
   *
   * This is what services should call. It exists so a service never has to
   * receive a CurrentUser purely to re-derive scoping — forgetting to thread it
   * is the failure mode, and by Phase 2 that would be every workflow method.
   *
   * Throws if there is no scope, which means a tenant-scoped query was attempted
   * outside an authenticated request: on a @Public() route, in a background job,
   * or before TenantContextInterceptor ran (guards, notably, run first). Those
   * callers must pass a context explicitly via withTenant.
   *
   * Deliberately NOT a request-long transaction. Holding a client for the whole
   * request would pin one of the pool's 10 connections across every non-DB pause
   * in a handler — bcrypt at cost 12 on login, the mailer, S3 multipart upload in
   * Phase 3. Atomicity is per-tx() call, which is the natural unit anyway: the
   * Phase 2 relay forward (complete step N, activate N+1, stamp timestamps, write
   * audit_log) is one tx() call, exactly as signup is one withTenant() call.
   */
  async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    return this.withTenant(requireTenantScope(), fn);
  }

  /**
   * Run `fn` on a connection with NO tenant context.
   *
   * Legitimate callers: the two SECURITY DEFINER lookups in 0002_auth_lookup.sql,
   * which must find a user before a context can exist (the context is derived
   * from the row being looked up). Nothing else belongs here — a tenant-scoped
   * read through this method returns zero rows, by design, because FORCE RLS
   * fails closed.
   *
   * Always rolls back: no caller of this has any business writing.
   */
  async withoutTenant<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      return await fn(client);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }
}

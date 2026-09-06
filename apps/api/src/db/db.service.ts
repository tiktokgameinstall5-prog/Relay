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
    const isCloud =
      env.DATABASE_URL.includes('sslmode=') ||
      env.DATABASE_URL.includes('supabase.co') ||
      env.DATABASE_URL.includes('pooler.supabase.com') ||
      (env.NODE_ENV === 'production' && !env.DATABASE_URL.includes('localhost'));
    let cleanUrl = isCloud ? env.DATABASE_URL.replace(/[?&]sslmode=[^&]+/g, '') : env.DATABASE_URL;
    // Route Supabase pooler to port 6543 (transaction mode pooler) for serverless scalability:
    // Port 5432 is session-mode (capped at 15 connections, throwing EMAXCONNSESSION on Vercel).
    // Port 6543 multiplexes thousands of concurrent serverless queries safely.
    if (cleanUrl.includes('pooler.supabase.com:5432')) {
      cleanUrl = cleanUrl.replace('pooler.supabase.com:5432', 'pooler.supabase.com:6543');
    }
    this.pool = new Pool({
      connectionString: cleanUrl,
      max: process.env.VERCEL ? 2 : 10,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: process.env.VERCEL ? 1000 : 30000,
      ...(isCloud ? { ssl: { rejectUnauthorized: false } } : {}),
    });
  }

  async onModuleInit(): Promise<void> {
    // Fail at startup rather than on the first request. A bad DATABASE_URL is a
    // deployment error, and finding it here means the process never reports
    // healthy while unable to serve.
    let client: PoolClient | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        client = await this.pool.connect();
        break;
      } catch (err) {
        if (attempt === 3) throw err;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    if (!client) return;

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
                set_config('app.current_manager_id', $3, true),
                set_config('app.current_user_id', $4, true)`,
        // Empty string, not null: set_config rejects a null value. The policies
        // compare against NULLIF(..., '') so '' and unset behave identically —
        // which is what an owner's absent manager_id must mean.
        [ctx.orgId, ctx.role, ctx.managerId ?? '', ctx.userId ?? ''],
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

  /**
   * Run `fn` in a COMMITTING transaction with NO tenant context.
   *
   * This is the odd one out, and it exists for exactly one caller: refresh-token
   * rotation. That flow has to write (revoke the presented token, insert its
   * successor) but has no tenant context to write under — a refresh request
   * arrives with an opaque token and nothing else; the user's identity is the
   * RESULT of the lookup, not an input to it, so withTenant() has no ctx to give
   * and tx() would throw. And it must commit, which rules out withoutTenant().
   *
   * Why this is not the isolation hole it looks like: refresh_token is the one
   * table in 0001_rls.sql that deliberately has NO row-level security. It is keyed
   * by an unguessable token hash, not by tenant, so there is nothing for a tenant
   * predicate to check. The safety argument is the FORCE-RLS backstop working in
   * our favour: if a bug ever routed a write to an RLS-protected table (user, team,
   * organization, audit_log) through this method, that write matches no policy and
   * fails closed — zero rows affected or an outright error — rather than silently
   * escaping isolation. So the blast radius of misuse is a broken feature, never a
   * cross-tenant leak.
   *
   * Do not reach for this anywhere else. If a new caller has a tenant, it wants
   * withTenant/tx; if it is a pre-auth read, it wants withoutTenant. The bar for a
   * second caller here is another genuinely tenant-less table, and that should be
   * argued in review, not assumed.
   */
  async unscopedTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
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
}

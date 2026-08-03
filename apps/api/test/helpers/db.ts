/**
 * Test database helpers.
 *
 * Two pools, mirroring the two-role model:
 *   appPool       — relay_app. Subject to RLS. Everything a test asserts about
 *                   isolation must go through this pool, or it proves nothing.
 *   migratorPool  — relay_migrator. Used ONLY to TRUNCATE between tests.
 *
 * Note that the migrator cannot seed directly: FORCE ROW LEVEL SECURITY applies
 * to the table owner too, so an INSERT with no tenant context is rejected. That
 * is the correct behaviour, and it means fixtures are created the same way
 * production creates them — through relay_app with a tenant context set. The
 * seed path and the real path cannot drift apart.
 */
import { Pool, type PoolClient } from 'pg';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. Copy .env.example to apps/api/.env.`);
  return v;
}

export const appPool = new Pool({ connectionString: requireEnv('DATABASE_URL'), max: 4 });
export const migratorPool = new Pool({
  connectionString: requireEnv('MIGRATION_DATABASE_URL'),
  max: 2,
});

export type Role = 'owner' | 'manager' | 'member';

export interface TenantContext {
  orgId: string;
  role: Role;
  /** null for owner, own id for manager, manager's id for member */
  managerId: string | null;
}

/**
 * Run `fn` inside a transaction with the three RLS session variables set
 * transaction-locally, exactly as TenantTransactionInterceptor will at runtime.
 * Commits on success, rolls back on throw.
 */
export async function withTenant<T>(
  ctx: TenantContext,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    // The `true` third argument scopes each setting to this transaction, so a
    // pooled connection cannot leak one tenant's context into the next test.
    await client.query(
      `SELECT set_config('app.current_org_id', $1, true),
              set_config('app.current_role', $2, true),
              set_config('app.current_manager_id', $3, true)`,
      [ctx.orgId, ctx.role, ctx.managerId ?? ''],
    );
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run `fn` on a relay_app connection with NO tenant context — the
 * unauthenticated / misconfigured case. Every tenant-scoped read here must
 * return zero rows. Always rolls back.
 */
export async function withoutTenant<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    return out;
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

/** Wipe all tenant data. Migrator-only: relay_app has no TRUNCATE grant. */
export async function truncateAll(): Promise<void> {
  await migratorPool.query(
    'TRUNCATE organization, "user", team, refresh_token, audit_log CASCADE',
  );
}

export async function closePools(): Promise<void> {
  await Promise.all([appPool.end(), migratorPool.end()]);
}

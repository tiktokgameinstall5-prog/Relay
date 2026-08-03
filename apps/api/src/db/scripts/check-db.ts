/**
 * Preflight check for the local database.
 *
 * Replaces the old db:up / db:down pair: Postgres 17 now runs as a Windows
 * service, so nothing needs starting. What DOES need verifying is the security
 * contract that row-level security depends on, because every one of these
 * conditions can be broken by an innocuous-looking change and none of them
 * announce themselves at runtime -- a broken one just means isolation silently
 * stops working.
 *
 *   1. Both roles can connect.
 *   2. relay_app is not a superuser and does not hold BYPASSRLS.
 *   3. relay_app does not OWN any table (an owner bypasses RLS unless the
 *      table is also FORCEd -- we set FORCE, but not owning is the primary
 *      defence and this catches the day someone runs a migration as the app).
 *
 * Run: npm --workspace apps/api run db:check
 */
import { Client } from 'pg';

const APP_URL = 'DATABASE_URL';
const MIG_URL = 'MIGRATION_DATABASE_URL';

type Check = { ok: boolean; label: string; detail?: string };
const results: Check[] = [];

function record(ok: boolean, label: string, detail?: string) {
  results.push({ ok, label, detail });
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`${name} is not set. Copy .env.example to apps/api/.env.`);
  }
  return v;
}

async function withClient<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function main() {
  const appUrl = requireEnv(APP_URL);
  const migUrl = requireEnv(MIG_URL);

  // --- 1. migrator connects -------------------------------------------------
  const serverVersion = await withClient(migUrl, async (c) => {
    const { rows } = await c.query<{ v: string }>('SELECT version() AS v');
    return rows[0].v;
  });
  record(true, 'relay_migrator connects', serverVersion.split(',')[0]);

  // --- 2. app role connects and is correctly de-privileged ------------------
  await withClient(appUrl, async (c) => {
    const { rows } = await c.query<{
      current_user: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT current_user, r.rolsuper, r.rolbypassrls
         FROM pg_roles r WHERE r.rolname = current_user`,
    );
    const me = rows[0];
    record(true, 'relay_app connects', `as ${me.current_user}`);

    // These two are the load-bearing ones. Either being true means RLS is off
    // for the API no matter what the policies say.
    record(!me.rolsuper, 'relay_app is NOT superuser');
    record(!me.rolbypassrls, 'relay_app does NOT have BYPASSRLS');

    const { rows: owned } = await c.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tableowner = current_user`,
    );
    record(
      owned.length === 0,
      'relay_app owns no tables',
      owned.length ? `owns: ${owned.map((o) => o.tablename).join(', ')}` : undefined,
    );
  });

  // --- report ---------------------------------------------------------------
  for (const r of results) {
    const mark = r.ok ? '  ok  ' : ' FAIL ';
    console.log(`[${mark}] ${r.label}${r.detail ? ` — ${r.detail}` : ''}`);
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(
      `\n${failed.length} check(s) failed. Tenant isolation cannot be trusted ` +
        `until these pass. See apps/api/src/db/scripts/bootstrap.sql.`,
    );
    process.exit(1);
  }
  console.log('\nDatabase ready.');
}

main().catch((err: Error) => {
  console.error(`\nDatabase check failed: ${err.message}`);
  process.exit(1);
});

/**
 * Jest globalSetup — verify the database is present, migrated, and that RLS is
 * actually switched on before a single test runs.
 *
 * This check exists because of a specific failure mode: if RLS were disabled or
 * the migrations hadn't run, the isolation suite's negative cases would still
 * pass at the HTTP layer (guards would reject the requests) while the database
 * layer silently protected nothing. The suite would be green and meaningless.
 * Better to refuse to start than to report a false pass.
 */
import { Client } from 'pg';

const REQUIRED_RLS_TABLES = ['organization', 'user', 'team', 'audit_log'];

export default async function globalSetup(): Promise<void> {
  const rawUrl = process.env.MIGRATION_DATABASE_URL;
  if (!rawUrl) {
    throw new Error(
      'MIGRATION_DATABASE_URL is not set. Tests load apps/api/.env — copy it from .env.example.',
    );
  }

  const url = rawUrl.replace(/\/relay(\?.*)?$/, '/relay_test$1');
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(
      `Cannot reach Postgres: ${(err as Error).message}\n` +
        `Is the PostgreSQL 17 service running? Try: npm run db:check`,
    );
  }

  try {
    const { rows: missing } = await client.query<{ relname: string }>(
      `SELECT t.tbl AS relname
         FROM unnest($1::text[]) AS t(tbl)
         LEFT JOIN pg_class c
           ON c.relname = t.tbl
          AND c.relnamespace = 'public'::regnamespace
        WHERE c.oid IS NULL`,
      [REQUIRED_RLS_TABLES],
    );
    if (missing.length > 0) {
      throw new Error(
        `Missing tables: ${missing.map((m) => m.relname).join(', ')}. ` +
          `Run: npm --workspace apps/api run db:migrate`,
      );
    }

    // Both flags matter. Without FORCE, the table owner bypasses its own
    // policies, and any test that seeds or asserts as the owner proves nothing.
    const { rows: unprotected } = await client.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity
         FROM pg_class
        WHERE relname = ANY($1::text[])
          AND relnamespace = 'public'::regnamespace
          AND (relrowsecurity IS FALSE OR relforcerowsecurity IS FALSE)`,
      [REQUIRED_RLS_TABLES],
    );
    if (unprotected.length > 0) {
      const detail = unprotected
        .map(
          (u) =>
            `${u.relname} (enabled=${u.relrowsecurity}, forced=${u.relforcerowsecurity})`,
        )
        .join(', ');
      throw new Error(
        `Row-level security is not fully enabled on: ${detail}\n` +
          `The isolation suite would report a false pass. Re-run db:migrate.`,
      );
    }

    // Clean slate. Each suite seeds what it needs.
    await client.query(
      'TRUNCATE organization, "user", team, refresh_token, audit_log CASCADE',
    );
  } finally {
    await client.end();
  }
}

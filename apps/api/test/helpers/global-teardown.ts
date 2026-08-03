/**
 * Jest globalTeardown — leave the database empty.
 *
 * Deliberately does NOT drop the schema: the next run reuses it, and dropping
 * would force a migration on every invocation. TRUNCATE needs the migrator role
 * because relay_app has no TRUNCATE grant, by design.
 */
import { Client } from 'pg';

export default async function globalTeardown(): Promise<void> {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) return;

  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    await client.query(
      'TRUNCATE organization, "user", team, refresh_token, audit_log CASCADE',
    );
  } catch {
    // Teardown must never fail a run that already passed. If the database went
    // away, the next globalSetup truncates anyway.
  } finally {
    await client.end().catch(() => undefined);
  }
}

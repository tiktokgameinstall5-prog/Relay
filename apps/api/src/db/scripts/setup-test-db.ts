/**
 * CLI script to create and initialize the dedicated relay_test database.
 *
 * Usage:
 *   npx tsx --env-file-if-exists=.env src/db/scripts/setup-test-db.ts
 */
import { Client } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`${name} is not set. Ensure apps/api/.env is loaded.`);
  }
  return v;
}

async function main() {
  const migUrl = requireEnv('MIGRATION_DATABASE_URL');
  const rootClient = new Client({ connectionString: migUrl });

  await rootClient.connect();

  try {
    const res = await rootClient.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = 'relay_test') as exists`,
    );

    if (!res.rows[0].exists) {
      console.log('Creating database relay_test with owner relay_migrator...');
      await rootClient.query('CREATE DATABASE relay_test OWNER relay_migrator');
      console.log('? Created database relay_test.');
    } else {
      console.log('?? Database relay_test already exists.');
    }

    await rootClient.query('REVOKE ALL ON DATABASE relay_test FROM PUBLIC');
    await rootClient.query('GRANT CONNECT ON DATABASE relay_test TO relay_migrator, relay_app');
    console.log('? Permissions configured on relay_test.');
  } finally {
    await rootClient.end();
  }

  // Now connect to relay_test as relay_migrator and run all migrations
  const testMigUrl = migUrl.replace(/\/relay$/, '/relay_test');
  const testClient = new Client({ connectionString: testMigUrl });

  await testClient.connect();

  try {
    console.log('Running migrations on relay_test...');
    await testClient.query(`
      CREATE TABLE IF NOT EXISTS _relay_migrations (
        id serial PRIMARY KEY,
        name text NOT NULL UNIQUE,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    const migrationsDir = join(__dirname, '../migrations');
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const already = await testClient.query(
        'SELECT 1 FROM _relay_migrations WHERE name = $1',
        [file],
      );
      if (already.rowCount && already.rowCount > 0) {
        console.log(`  = ${file} (already applied)`);
        continue;
      }

      const sql = readFileSync(join(migrationsDir, file), 'utf-8');
      console.log(`  > ${file}`);
      await testClient.query('BEGIN');
      try {
        await testClient.query(sql);
        await testClient.query(
          'INSERT INTO _relay_migrations (name) VALUES ($1)',
          [file],
        );
        await testClient.query('COMMIT');
        console.log(`  + ${file}`);
      } catch (err) {
        await testClient.query('ROLLBACK');
        throw err;
      }
    }

    console.log('?? relay_test database is fully initialized and migrated!');
  } finally {
    await testClient.end();
  }
}

main().catch((err) => {
  console.error('? Failed to set up relay_test database:', err);
  process.exit(1);
});

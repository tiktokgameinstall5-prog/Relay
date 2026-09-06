/**
 * 1-Step Automated Supabase Provisioning & Migration Script for Relay.
 *
 * Takes your raw Supabase connection string, automatically creates the secure
 * runtime role (relay_app) with NOBYPASSRLS, configures schema permissions,
 * applies all 12 migrations, and outputs your ready-to-use Vercel environment variables.
 *
 * Usage:
 *   npx tsx src/db/scripts/setup-supabase.ts "postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres"
 */
import { Client } from 'pg';
import { randomBytes, createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

function getArgConnectionString(): string {
  const url = process.argv[2] || process.env.SUPABASE_DATABASE_URL;
  if (!url) {
    console.error('\n❌ Please provide your Supabase connection string:');
    console.error('Usage: npm run db:setup:supabase "<your-supabase-connection-string>"\n');
    process.exit(1);
  }
  return url.trim();
}

async function main() {
  const adminUrl = getArgConnectionString();
  console.log('\n--- Relay 1-Step Automated Supabase Setup ---');

  const isSsl =
    adminUrl.includes('sslmode=') ||
    adminUrl.includes('supabase.co') ||
    !adminUrl.includes('localhost');

  const adminClient = new Client({
    connectionString: adminUrl,
    ssl: isSsl ? { rejectUnauthorized: false } : undefined,
  });

  try {
    console.log('1. Connecting to Supabase database...');
    await adminClient.connect();
    console.log('   ✅ Connected successfully.');

    // Generate strong random password for relay_app
    const appPassword = randomBytes(24).toString('hex');

    console.log('2. Provisioning Relay runtime role (relay_app with NOBYPASSRLS)...');
    await adminClient.query(`
      DO $$ BEGIN
        CREATE ROLE relay_app WITH LOGIN PASSWORD '${appPassword}' NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
      EXCEPTION WHEN duplicate_object THEN
        ALTER ROLE relay_app WITH PASSWORD '${appPassword}' NOBYPASSRLS;
      END $$;

      GRANT CONNECT ON DATABASE postgres TO relay_app;
      GRANT USAGE, CREATE ON SCHEMA public TO relay_app;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO relay_app;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO relay_app;
      CREATE EXTENSION IF NOT EXISTS citext;
    `);
    console.log('   ✅ Runtime role and permissions configured.');

    console.log('3. Running database migrations...');
    await adminClient.query(`
      CREATE TABLE IF NOT EXISTS _migration (
        filename    text PRIMARY KEY,
        checksum    text NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const { rows: applied } = await adminClient.query<{ filename: string; checksum: string }>(
      'SELECT filename, checksum FROM _migration',
    );
    const appliedByName = new Map(applied.map((r) => [r.filename, r.checksum]));

    for (const filename of files) {
      const sql = await readFile(join(MIGRATIONS_DIR, filename), 'utf8');
      const checksum = createHash('sha256')
        .update(sql.replace(/\r\n/g, '\n'))
        .digest('hex');

      const prior = appliedByName.get(filename);
      if (prior) {
        console.log(`   = ${filename} (already applied)`);
        continue;
      }

      await adminClient.query('BEGIN');
      try {
        await adminClient.query(sql);
        await adminClient.query(
          'INSERT INTO _migration (filename, checksum) VALUES ($1, $2)',
          [filename, checksum],
        );
        await adminClient.query('COMMIT');
        console.log(`   + ${filename}`);
      } catch (err) {
        await adminClient.query('ROLLBACK');
        throw new Error(`${filename} failed: ${(err as Error).message}`);
      }
    }
    console.log('   ✅ All 12 migrations applied successfully.');

    // Build the runtime connection string for relay_app
    const parsed = new URL(adminUrl);
    parsed.username = 'relay_app';
    parsed.password = appPassword;
    if (!parsed.searchParams.has('sslmode')) {
      parsed.searchParams.set('sslmode', 'require');
    }
    const runtimeUrl = parsed.toString();

    console.log('\n🎉 Supabase Database Setup Complete!\n');
    console.log('================================================================');
    console.log('Copy these Environment Variables for Vercel / Production:');
    console.log('================================================================');
    console.log(`DATABASE_URL=${runtimeUrl}`);
    console.log(`MIGRATION_DATABASE_URL=${adminUrl}`);
    console.log('================================================================\n');

    return { runtimeUrl, adminUrl };
  } finally {
    await adminClient.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`\n❌ Setup failed: ${(err as Error).message}`);
    process.exit(1);
  });
}

export { main as setupSupabase };

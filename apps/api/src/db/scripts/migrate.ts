/**
 * Migration runner.
 *
 * Applies src/db/migrations/*.sql in filename order using the MIGRATOR
 * connection (owns the schema, may run DDL). The runtime role never runs this.
 *
 * Not drizzle-kit: our migrations are hand-written because RLS policies, the
 * two-role grant model, circular FKs, and CHECK invariants need precision a
 * generator would overwrite. drizzle-kit stays available for `generate` when
 * diffing schema.ts is useful, but this runner is what actually migrates.
 *
 * Every file must be idempotent — re-running is expected to be a no-op.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Client } from 'pg';

// __dirname (CommonJS) rather than import.meta.url: tsconfig targets
// "module": "commonjs", where import.meta is a compile error.
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `${name} is not set. Copy .env.example to apps/api/.env and fill it in.`,
    );
  }
  return v;
}

async function main() {
  const connStr = requireEnv('MIGRATION_DATABASE_URL');
  const isSsl =
    connStr.includes('sslmode=') ||
    connStr.includes('supabase.co') ||
    (process.env.NODE_ENV === 'production' && !connStr.includes('localhost'));
  const client = new Client({
    connectionString: connStr,
    ...(isSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migration (
        filename    text PRIMARY KEY,
        checksum    text NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    if (files.length === 0) throw new Error(`No .sql files found in ${MIGRATIONS_DIR}`);

    const { rows: applied } = await client.query<{ filename: string; checksum: string }>(
      'SELECT filename, checksum FROM _migration',
    );
    const appliedByName = new Map(applied.map((r) => [r.filename, r.checksum]));

    for (const filename of files) {
      const sql = await readFile(join(MIGRATIONS_DIR, filename), 'utf8');
      // Checksum LF-normalised content, not raw bytes. On Windows with
      // core.autocrlf=true, git rewrites line endings on checkout, so hashing
      // raw bytes makes an untouched file look edited — the guard fires on a
      // fresh clone, or after any operation that re-checks-out files (this
      // happened for real after a rebase). Normalising means the checksum
      // tracks the SQL itself, which is what the guard is actually about.
      const checksum = createHash('sha256')
        .update(sql.replace(/\r\n/g, '\n'))
        .digest('hex');
      const prior = appliedByName.get(filename);

      if (prior && prior !== checksum) {
        // Editing an applied migration means the database and the repo have
        // diverged. Refuse rather than guess which one is right.
        throw new Error(
          `${filename} changed after being applied.\n` +
            `  applied: ${prior.slice(0, 12)}\n  current: ${checksum.slice(0, 12)}\n` +
            `Add a new migration instead of editing this one.`,
        );
      }

      if (prior) {
        console.log(`  = ${filename} (already applied)`);
        continue;
      }

      // Each migration is one transaction: a failure mid-file rolls back
      // rather than leaving the schema half-built.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO _migration (filename, checksum) VALUES ($1, $2)',
          [filename, checksum],
        );
        await client.query('COMMIT');
        console.log(`  + ${filename}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`${filename} failed: ${(err as Error).message}`);
      }
    }

    console.log('Migrations up to date.');
  } finally {
    await client.end();
  }
}

main().catch((err: Error) => {
  console.error(`\nMigration failed: ${err.message}`);
  process.exit(1);
});

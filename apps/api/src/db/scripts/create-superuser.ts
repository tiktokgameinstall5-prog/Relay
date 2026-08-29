/**
 * CLI script to create an Owner / Superuser account for local development or staging.
 *
 * Usage:
 *   npx tsx --env-file-if-exists=.env src/db/scripts/create-superuser.ts [email] [password] [name] [organizationName]
 *
 * Example:
 *   npm --workspace apps/api run db:superuser
 */
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { hash } from 'bcryptjs';

const BCRYPT_COST = 12;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`${name} is not set. Ensure apps/api/.env is loaded.`);
  }
  return v;
}

async function main() {
  const args = process.argv.slice(2);
  const email = (args[0] || 'owner@relay.test').trim().toLowerCase();
  const password = args[1] || 'Password123!';
  const name = args[2] || 'System Owner';
  const orgName = args[3] || 'Relay Global Workspace';

  const migUrl = requireEnv('MIGRATION_DATABASE_URL');
  const client = new Client({ connectionString: migUrl });

  await client.connect();

  try {
    // Check if user already exists
    const existing = await client.query<{ id: string; org_id: string; role: string }>(
      `SELECT id, org_id, role FROM "user" WHERE email = $1`,
      [email],
    );

    if (existing.rows.length > 0) {
      const u = existing.rows[0];
      console.log(`\n⚠️  User with email "${email}" already exists (ID: ${u.id}, Org: ${u.org_id}, Role: ${u.role}).`);
      
      // Update password hash to requested password
      const passwordHash = await hash(password, BCRYPT_COST);
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.current_org_id', $1, true),
                set_config('app.current_role', 'owner', true),
                set_config('app.current_manager_id', '', true)`,
        [u.org_id],
      );
      await client.query(
        `UPDATE "user" SET password_hash = $1, status = 'active', updated_at = now() WHERE id = $2`,
        [passwordHash, u.id],
      );
      await client.query('COMMIT');

      console.log(`✅ Password updated successfully.`);
      console.log(`\n--- Login Credentials ---`);
      console.log(`Email:    ${email}`);
      console.log(`Password: ${password}`);
      console.log(`Role:     ${u.role}`);
      return;
    }

    const orgId = randomUUID();
    const userId = randomUUID();
    const passwordHash = await hash(password, BCRYPT_COST);
    const now = new Date();

    await client.query('BEGIN');

    // Establish owner tenant context for RLS policy satisfaction
    await client.query(
      `SELECT set_config('app.current_org_id', $1, true),
              set_config('app.current_role', 'owner', true),
              set_config('app.current_manager_id', '', true)`,
      [orgId],
    );

    // Create organization
    await client.query(
      `INSERT INTO organization (id, name, created_at, updated_at)
       VALUES ($1, $2, $3, $3)`,
      [orgId, orgName, now],
    );

    // Create owner super-user
    await client.query(
      `INSERT INTO "user" (
         id, org_id, email, name, role, manager_id, team_id, status, password_hash, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, 'owner', NULL, NULL, 'active', $5, $6, $6
       )`,
      [userId, orgId, email, name, passwordHash, now],
    );

    await client.query('COMMIT');

    console.log(`\n🎉 Superuser / Owner account created successfully!`);
    console.log(`-----------------------------------------------`);
    console.log(`Organization: ${orgName} (${orgId})`);
    console.log(`User ID:      ${userId}`);
    console.log(`Name:         ${name}`);
    console.log(`Email:        ${email}`);
    console.log(`Password:     ${password}`);
    console.log(`Role:         owner (Full org visibility & management)`);
    console.log(`-----------------------------------------------`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`\n❌ Failed to create superuser:`, err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();

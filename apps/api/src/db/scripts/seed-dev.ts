/**
 * CLI script to seed a rich, interactive sandbox environment in the dev database.
 *
 * Workspace includes:
 *   - 1 Owner (owner@relay.test)
 *   - 2 Teams ("Design & Media Team", "Core Platform Team")
 *   - 2 Managers (manager.alice@relay.test, manager.bob@relay.test)
 *   - 4 Members (member.carol@relay.test, member.dave@relay.test, member.eve@relay.test, member.frank@relay.test)
 *   - 4 Tasks across video/file/text types with multi-step ordered relays and attachments.
 *
 * All accounts use password: Password123!
 *
 * Usage:
 *   npm --workspace apps/api run db:seed
 */
import { createHash, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { hash } from 'bcryptjs';
import { LocalStorageDriver } from '../../storage/local-storage.driver';

const BCRYPT_COST = 12;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`${name} is not set. Ensure apps/api/.env is loaded.`);
  }
  return v;
}

async function main() {
  const migUrl = requireEnv('MIGRATION_DATABASE_URL');
  const client = new Client({ connectionString: migUrl });
  const storage = new LocalStorageDriver();

  await client.connect();

  try {
    console.log('?? Seeding development database...');

    const orgId = randomUUID();
    const orgName = 'Relay Creative Studio';
    const now = new Date();
    const defaultPasswordHash = await hash('Password123!', BCRYPT_COST);

    await client.query('BEGIN');

    // 1. Establish owner tenant context for initial insertions
    await client.query(
      `SELECT set_config('app.current_org_id', $1, true),
              set_config('app.current_role', 'owner', true),
              set_config('app.current_manager_id', '', true)`,
      [orgId],
    );

    // 2. Create Organization
    await client.query(
      `INSERT INTO organization (id, name, created_at, updated_at)
       VALUES ($1, $2, $3, $3)`,
      [orgId, orgName, now],
    );

    // 3. Create Owner
    const ownerId = randomUUID();
    await client.query(
      `INSERT INTO "user" (
         id, org_id, email, name, role, manager_id, team_id, status, password_hash, created_at, updated_at
       ) VALUES (
         $1, $2, 'owner@relay.test', 'System Owner', 'owner', NULL, NULL, 'active', $3, $4, $4
       )`,
      [ownerId, orgId, defaultPasswordHash, now],
    );

    // 4. Create Manager 1 & Team 1 (Design & Media)
    const mgr1Id = randomUUID();
    await client.query(
      `INSERT INTO "user" (
         id, org_id, email, name, role, manager_id, status, password_hash, created_at, updated_at
       ) VALUES (
         $1, $2, 'manager.alice@relay.test', 'Alice Manager (Design)', 'manager', $1, 'active', $3, $4, $4
       )`,
      [mgr1Id, orgId, defaultPasswordHash, now],
    );

    const team1Id = randomUUID();
    await client.query(
      `INSERT INTO team (id, org_id, manager_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, 'Design & Media Team', $4, $4)`,
      [team1Id, orgId, mgr1Id, now],
    );

    await client.query('UPDATE "user" SET team_id = $1 WHERE id = $2', [team1Id, mgr1Id]);

    // 5. Create Manager 2 & Team 2 (Core Platform)
    const mgr2Id = randomUUID();
    await client.query(
      `INSERT INTO "user" (
         id, org_id, email, name, role, manager_id, status, password_hash, created_at, updated_at
       ) VALUES (
         $1, $2, 'manager.bob@relay.test', 'Bob Manager (Platform)', 'manager', $1, 'active', $3, $4, $4
       )`,
      [mgr2Id, orgId, defaultPasswordHash, now],
    );

    const team2Id = randomUUID();
    await client.query(
      `INSERT INTO team (id, org_id, manager_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, 'Core Platform Team', $4, $4)`,
      [team2Id, orgId, mgr2Id, now],
    );

    await client.query('UPDATE "user" SET team_id = $1 WHERE id = $2', [team2Id, mgr2Id]);

    // 6. Create Members
    const m1Id = randomUUID();
    const m2Id = randomUUID();
    const m3Id = randomUUID();
    const m4Id = randomUUID();

    // Team 1 members
    await client.query(
      `INSERT INTO "user" (id, org_id, email, name, role, manager_id, team_id, status, password_hash, created_at, updated_at)
       VALUES ($1, $2, 'member.carol@relay.test', 'Carol Designer', 'member', $3, $4, 'active', $5, $6, $6),
              ($7, $2, 'member.dave@relay.test', 'Dave Video Editor', 'member', $3, $4, 'active', $5, $6, $6)`,
      [m1Id, orgId, mgr1Id, team1Id, defaultPasswordHash, now, m2Id],
    );

    // Team 2 members
    await client.query(
      `INSERT INTO "user" (id, org_id, email, name, role, manager_id, team_id, status, password_hash, created_at, updated_at)
       VALUES ($1, $2, 'member.eve@relay.test', 'Eve Backend Eng', 'member', $3, $4, 'active', $5, $6, $6),
              ($7, $2, 'member.frank@relay.test', 'Frank DevOps', 'member', $3, $4, 'active', $5, $6, $6)`,
      [m3Id, orgId, mgr2Id, team2Id, defaultPasswordHash, now, m4Id],
    );

    // 7. Create Tasks & Relays
    // Task 1: Video relay in Team 1
    const task1Id = randomUUID();
    await client.query(
      `INSERT INTO task (id, org_id, manager_id, team_id, name, type, description, created_by_user_id, status)
       VALUES ($1, $2, $3, $4, 'Brand Launch 4K Reel', 'video', 'Edit and color-grade the 4K brand launch trailer.', $3, 'in_progress')`,
      [task1Id, orgId, mgr1Id, team1Id],
    );

    await client.query(
      `INSERT INTO task_step (id, org_id, manager_id, task_id, assigned_user_id, step_order, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 0, 'completed', $8, $8),
              ($6, $2, $3, $4, $7, 1, 'active', $8, $8),
              ($9, $2, $3, $4, $3, 2, 'pending', $8, $8)`,
      [randomUUID(), orgId, mgr1Id, task1Id, m1Id, randomUUID(), m2Id, now, randomUUID()],
    );

    // Storage attachment for Task 1
    const videoBuffer = Buffer.from('RIFF....WAVEfmt ....data...sample-raw-video-footage-stream-bytes');
    const videoSha = createHash('sha256').update(videoBuffer).digest('hex');
    const videoStorageKey = `${orgId}/${task1Id}/${randomUUID()}_brand_launch_master.mp4`;
    await storage.put(videoStorageKey, videoBuffer, 'video/mp4');

    await client.query(
      `INSERT INTO task_attachment (
         id, org_id, manager_id, task_id, uploaded_by_user_id, file_name, file_size, mime_type, storage_key, checksum_sha256
       ) VALUES ($1, $2, $3, $4, $5, 'brand_launch_master.mp4', $6, 'video/mp4', $7, $8)`,
      [randomUUID(), orgId, mgr1Id, task1Id, m1Id, videoBuffer.length, videoStorageKey, videoSha],
    );

    // Task 2: File relay in Team 1
    const task2Id = randomUUID();
    await client.query(
      `INSERT INTO task (id, org_id, manager_id, team_id, name, type, description, created_by_user_id, status)
       VALUES ($1, $2, $3, $4, 'Q4 Design Systems Guidelines', 'file', 'Review and finalize design token specifications.', $3, 'in_progress')`,
      [task2Id, orgId, mgr1Id, team1Id],
    );

    await client.query(
      `INSERT INTO task_step (id, org_id, manager_id, task_id, assigned_user_id, step_order, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 0, 'active', $7, $7),
              ($6, $2, $3, $4, $8, 1, 'pending', $7, $7)`,
      [randomUUID(), orgId, mgr1Id, task2Id, m1Id, randomUUID(), now, m2Id],
    );

    const docBuffer = Buffer.from('%PDF-1.4 ... Design system export tokens and spacing guides.');
    const docSha = createHash('sha256').update(docBuffer).digest('hex');
    const docStorageKey = `${orgId}/${task2Id}/${randomUUID()}_design_tokens.pdf`;
    await storage.put(docStorageKey, docBuffer, 'application/pdf');

    await client.query(
      `INSERT INTO task_attachment (
         id, org_id, manager_id, task_id, uploaded_by_user_id, file_name, file_size, mime_type, storage_key, checksum_sha256
       ) VALUES ($1, $2, $3, $4, $5, 'design_tokens.pdf', $6, 'application/pdf', $7, $8)`,
      [randomUUID(), orgId, mgr1Id, task2Id, mgr1Id, docBuffer.length, docStorageKey, docSha],
    );

    // Task 3: Text task in Team 2
    const task3Id = randomUUID();
    await client.query(
      `INSERT INTO task (id, org_id, manager_id, team_id, name, type, description, created_by_user_id, status)
       VALUES ($1, $2, $3, $4, 'Database Sharding & Partitioning RFC', 'text', 'Draft sharding architecture RFC for Postgres 17 clusters.', $3, 'in_progress')`,
      [task3Id, orgId, mgr2Id, team2Id],
    );

    await client.query(
      `INSERT INTO task_step (id, org_id, manager_id, task_id, assigned_user_id, step_order, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 0, 'active', $7, $7),
              ($6, $2, $3, $4, $8, 1, 'pending', $7, $7)`,
      [randomUUID(), orgId, mgr2Id, task3Id, m3Id, randomUUID(), now, m4Id],
    );

    // Task 4: Completed task in Team 2
    const task4Id = randomUUID();
    await client.query(
      `INSERT INTO task (id, org_id, manager_id, team_id, name, type, description, created_by_user_id, status)
       VALUES ($1, $2, $3, $4, 'SOC2 Security Baseline Audit', 'file', 'Automated SAIF and IAM security controls compliance scan.', $3, 'completed')`,
      [task4Id, orgId, mgr2Id, team2Id],
    );

    await client.query(
      `INSERT INTO task_step (id, org_id, manager_id, task_id, assigned_user_id, step_order, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 0, 'completed', $7, $7),
              ($6, $2, $3, $4, $8, 1, 'completed', $7, $7)`,
      [randomUUID(), orgId, mgr2Id, task4Id, m3Id, randomUUID(), now, m4Id],
    );

    await client.query('COMMIT');

    console.log('\n======================================================');
    console.log('?? Development Sandbox Seeded Successfully!');
    console.log('======================================================');
    console.log(`Organization: ${orgName} (${orgId})\n`);
    console.log('--- User Accounts (Password: Password123!) ---');
    console.log('?? Owner:');
    console.log('   - Email: owner@relay.test');
    console.log('?? Design & Media Team:');
    console.log('   - Manager: manager.alice@relay.test');
    console.log('   - Member:  member.carol@relay.test');
    console.log('   - Member:  member.dave@relay.test');
    console.log('?? Core Platform Team:');
    console.log('   - Manager: manager.bob@relay.test');
    console.log('   - Member:  member.eve@relay.test');
    console.log('   - Member:  member.frank@relay.test');
    console.log('\n--- Sample Tasks in Flight ---');
    console.log('1. "Brand Launch 4K Reel" (video) -> Step 2 of 3 (Dave Video Editor holding active step)');
    console.log('2. "Q4 Design Systems Guidelines" (file) -> Step 1 of 2 (Carol Designer holding active step)');
    console.log('3. "Database Sharding & Partitioning RFC" (text) -> Step 1 of 2 (Eve Backend Eng)');
    console.log('4. "SOC2 Security Baseline Audit" (file) -> Completed');
    console.log('======================================================\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('? Failed to seed development database:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();

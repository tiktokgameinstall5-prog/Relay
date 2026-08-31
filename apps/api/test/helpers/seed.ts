/**
 * Isolation test fixture.
 *
 * Shape (two organizations, so cross-ORG isolation is covered as well as
 * cross-MANAGER isolation — an Owner is scoped to their own org too):
 *
 *   Org 1 "Acme"
 *     owner1
 *     managerA — teamA — memberA1, memberA2
 *     managerB — teamB — memberB1, memberB2
 *   Org 2 "Globex"
 *     owner2
 *     managerC — teamC — memberC1
 *
 * managerA and managerB are the primary subjects: same organization, so nothing
 * but the manager_id predicate separates them. If isolation is broken anywhere,
 * A reaching B is where it shows up.
 *
 * Everything is inserted through relay_app with a tenant context set, because
 * FORCE ROW LEVEL SECURITY rejects context-free writes even from the table
 * owner. The upside is that the fixture cannot drift from the production write
 * path — if a policy would block the real code, it blocks the seed too.
 */
import { randomUUID } from 'node:crypto';
import { hash } from 'bcryptjs';
import { withTenant, type TenantContext } from './db';

/** Cost 4, not the production 12: this runs for every fixture row and bcrypt is
 *  deliberately slow. Cost is irrelevant to what these tests assert. */
const TEST_BCRYPT_COST = 4;

export const TEST_PASSWORD = 'CorrectHorse!9';

export interface SeededUser {
  id: string;
  email: string;
  role: 'owner' | 'manager' | 'member';
  orgId: string;
  managerId: string | null;
  teamId: string | null;
}

export interface Fixture {
  org1Id: string;
  org2Id: string;
  owner1: SeededUser;
  owner2: SeededUser;
  managerA: SeededUser;
  managerB: SeededUser;
  managerC: SeededUser;
  teamAId: string;
  teamBId: string;
  teamCId: string;
  memberA1: SeededUser;
  memberA2: SeededUser;
  memberB1: SeededUser;
  memberB2: SeededUser;
  memberC1: SeededUser;
}

/** Tenant context for a seeded user, as the interceptor would build it. */
export function ctxFor(u: SeededUser): TenantContext {
  return { orgId: u.orgId, role: u.role, managerId: u.managerId, userId: u.id };
}

interface OrgSeed {
  orgId: string;
  name: string;
  ownerEmail: string;
}

async function seedOrg(seed: OrgSeed, passwordHash: string) {
  const ownerCtx: TenantContext = { orgId: seed.orgId, role: 'owner', managerId: null };

  return withTenant(ownerCtx, async (c) => {
    await c.query('INSERT INTO organization (id, name) VALUES ($1, $2)', [
      seed.orgId,
      seed.name,
    ]);

    const ownerId = randomUUID();
    await c.query(
      `INSERT INTO "user" (id, org_id, role, name, email, password_hash, manager_id)
       VALUES ($1, $2, 'owner', $3, $4, $5, NULL)`,
      [ownerId, seed.orgId, `Owner ${seed.name}`, seed.ownerEmail, passwordHash],
    );

    const owner: SeededUser = {
      id: ownerId,
      email: seed.ownerEmail,
      role: 'owner',
      orgId: seed.orgId,
      managerId: null,
      teamId: null,
    };
    return { owner, client: c };
  });
}

/**
 * Create a manager, their team, and their members — all inside one owner-scoped
 * transaction, since the Owner is the only role that can create a manager.
 */
async function seedManagerWithTeam(
  orgId: string,
  label: string,
  memberLabels: string[],
  passwordHash: string,
): Promise<{ manager: SeededUser; teamId: string; members: SeededUser[] }> {
  const ownerCtx: TenantContext = { orgId, role: 'owner', managerId: null };

  return withTenant(ownerCtx, async (c) => {
    // The manager's id must be known before insert: manager_id references its
    // own id, and the user_manager_id_invariant CHECK enforces that.
    const managerId = randomUUID();
    const managerEmail = `manager.${label.toLowerCase()}@${orgId.slice(0, 8)}.test`;

    await c.query(
      `INSERT INTO "user" (id, org_id, role, name, email, password_hash, manager_id)
       VALUES ($1, $2, 'manager', $3, $4, $5, $1)`,
      [managerId, orgId, `Manager ${label}`, managerEmail, passwordHash],
    );

    const teamId = randomUUID();
    await c.query(
      'INSERT INTO team (id, org_id, manager_id, name) VALUES ($1, $2, $3, $4)',
      [teamId, orgId, managerId, `Team ${label}`],
    );

    // The manager belongs to their own team.
    await c.query('UPDATE "user" SET team_id = $1 WHERE id = $2', [teamId, managerId]);

    const members: SeededUser[] = [];
    for (const ml of memberLabels) {
      const memberId = randomUUID();
      const email = `member.${ml.toLowerCase()}@${orgId.slice(0, 8)}.test`;
      await c.query(
        `INSERT INTO "user"
           (id, org_id, role, name, email, password_hash, manager_id, team_id, role_title)
         VALUES ($1, $2, 'member', $3, $4, $5, $6, $7, $8)`,
        [memberId, orgId, `Member ${ml}`, email, passwordHash, managerId, teamId, 'Contributor'],
      );
      members.push({
        id: memberId,
        email,
        role: 'member',
        orgId,
        managerId,
        teamId,
      });
    }

    const manager: SeededUser = {
      id: managerId,
      email: managerEmail,
      role: 'manager',
      // A manager's tenant key is their own id. This is the whole design.
      managerId,
      orgId,
      teamId,
    };

    return { manager, teamId, members };
  });
}

export async function seedFixture(): Promise<Fixture> {
  const passwordHash = await hash(TEST_PASSWORD, TEST_BCRYPT_COST);

  const org1Id = randomUUID();
  const org2Id = randomUUID();

  const { owner: owner1 } = await seedOrg(
    { orgId: org1Id, name: 'Acme', ownerEmail: 'owner1@acme.test' },
    passwordHash,
  );
  const { owner: owner2 } = await seedOrg(
    { orgId: org2Id, name: 'Globex', ownerEmail: 'owner2@globex.test' },
    passwordHash,
  );

  const a = await seedManagerWithTeam(org1Id, 'A', ['A1', 'A2'], passwordHash);
  const b = await seedManagerWithTeam(org1Id, 'B', ['B1', 'B2'], passwordHash);
  const c = await seedManagerWithTeam(org2Id, 'C', ['C1'], passwordHash);

  return {
    org1Id,
    org2Id,
    owner1,
    owner2,
    managerA: a.manager,
    managerB: b.manager,
    managerC: c.manager,
    teamAId: a.teamId,
    teamBId: b.teamId,
    teamCId: c.teamId,
    memberA1: a.members[0],
    memberA2: a.members[1],
    memberB1: b.members[0],
    memberB2: b.members[1],
    memberC1: c.members[0],
  };
}

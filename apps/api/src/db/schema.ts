/**
 * Relay database schema (Drizzle).
 *
 * Phase 1 scope: organization, user, team, refresh_token, audit_log.
 *
 * Two notes that matter for every query written against this file:
 *
 * 1. `user.managerId` is a SELF-REFERENCE for managers. Owner = NULL,
 *    Manager = their own id, Member = their manager's id. This makes every
 *    tenant-scoped query and every RLS policy a single uniform predicate
 *    (`manager_id = current_manager_id`) with no CASE on role.
 *
 * 2. `user.email` is declared `text` here but is `citext` in the actual DDL
 *    (see migrations/0000_init.sql), so uniqueness is case-insensitive at the
 *    database level. Drizzle has no citext primitive; text is the correct
 *    TypeScript representation. Migrations are hand-written, not generated,
 *    so this intentional divergence never gets clobbered.
 */
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const userRoleEnum = pgEnum('user_role', ['owner', 'manager', 'member']);
export const userStatusEnum = pgEnum('user_status', ['active', 'inactive']);
export const teamStatusEnum = pgEnum('team_status', ['active', 'deleted']);

// ---------------------------------------------------------------------------
// organization — the top-level tenant
// ---------------------------------------------------------------------------
export const organization = pgTable('organization', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// team — one per manager (enforced by the unique index on manager_id)
// ---------------------------------------------------------------------------
export const team = pgTable(
  'team',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'restrict' }),
    // FK added in SQL rather than here: team.manager_id -> user.id and
    // user.team_id -> team.id are mutually circular, so one side must be
    // deferred to DDL. See migrations/0000_init.sql.
    managerId: uuid('manager_id').notNull(),
    name: text('name').notNull(),
    status: teamStatusEnum('status').notNull().default('active'),
    // Soft delete: 30-day recoverable window (spec §9.2). Purge is a separate
    // explicit action, never a side effect of the first delete.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('team_org_id_idx').on(t.orgId),
    // One team per manager, per spec §1.1.
    uniqueIndex('team_manager_id_key').on(t.managerId),
  ],
);

// ---------------------------------------------------------------------------
// user — single table for all three roles, discriminated by `role`
// ---------------------------------------------------------------------------
export const user = pgTable(
  'user',
  {
    // NOT defaultRandom(): a manager's `managerId` must equal its own `id`, so
    // the service generates the UUID with crypto.randomUUID() before insert.
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'restrict' }),
    role: userRoleEnum('role').notNull(),
    name: text('name').notNull(),
    // citext in DDL — case-insensitive uniqueness. See file header.
    email: text('email').notNull(),

    // Owners sign up with a password. Managers/Members start with a passcode
    // and may set a password on first login, after which passcode_* is cleared.
    passwordHash: text('password_hash'),
    passcodeHash: text('passcode_hash'),
    passcodeExpiresAt: timestamp('passcode_expires_at', { withTimezone: true }),
    // Non-null => consumed. Enforces single-use (spec §3.4).
    passcodeUsedAt: timestamp('passcode_used_at', { withTimezone: true }),

    // The tenant key. NULL for owner, self for manager, manager's id for member.
    managerId: uuid('manager_id').references((): AnyPgColumn => user.id, {
      onDelete: 'restrict',
    }),
    teamId: uuid('team_id').references(() => team.id, { onDelete: 'set null' }),

    roleTitle: text('role_title'),
    workflowStep: integer('workflow_step'),
    ranking: integer('ranking').notNull().default(50),
    isReporter: boolean('is_reporter').notNull().default(false),

    // Soft delete only — never hard-delete a user (spec §9.1).
    status: userStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('user_org_id_idx').on(t.orgId),
    index('user_manager_id_idx').on(t.managerId),
    index('user_team_id_idx').on(t.teamId),
    // Email is unique per organization, not globally: two different orgs may
    // legitimately have the same person, and a global unique would leak the
    // existence of an account in another tenant at signup time.
    uniqueIndex('user_org_id_email_key').on(t.orgId, t.email),
  ],
);

// ---------------------------------------------------------------------------
// refresh_token — 30-day "remember me" sessions with rotation
// ---------------------------------------------------------------------------
export const refreshToken = pgTable(
  'refresh_token',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // SHA-256 of the token. The raw value is returned to the client once and
    // never stored, so a database leak cannot be replayed as a session.
    tokenHash: text('token_hash').notNull(),
    // Rotation lineage: lets us revoke a whole family on replay (theft signal).
    familyId: uuid('family_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('refresh_token_hash_key').on(t.tokenHash),
    index('refresh_token_user_id_idx').on(t.userId),
    index('refresh_token_family_id_idx').on(t.familyId),
  ],
);

// ---------------------------------------------------------------------------
// audit_log — append-only. Cheap to start now, painful to backfill later.
// ---------------------------------------------------------------------------
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').references(() => organization.id, { onDelete: 'restrict' }),
    // Nullable: failed logins have no authenticated actor yet.
    actorUserId: uuid('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: uuid('target_id'),
    // Never put a plaintext passcode or token in here.
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_org_id_idx').on(t.orgId),
    index('audit_log_actor_user_id_idx').on(t.actorUserId),
    index('audit_log_created_at_idx').on(t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type Organization = typeof organization.$inferSelect;
export type NewOrganization = typeof organization.$inferInsert;
export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type Team = typeof team.$inferSelect;
export type NewTeam = typeof team.$inferInsert;
export type RefreshToken = typeof refreshToken.$inferSelect;
export type NewRefreshToken = typeof refreshToken.$inferInsert;
export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;

export type UserRole = (typeof userRoleEnum.enumValues)[number];
export type UserStatus = (typeof userStatusEnum.enumValues)[number];
export type TeamStatus = (typeof teamStatusEnum.enumValues)[number];

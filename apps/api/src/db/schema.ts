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
export const taskTypeEnum = pgEnum('task_type', ['text', 'video', 'file']);
export const taskStatusEnum = pgEnum('task_status', ['scheduled', 'in_progress', 'completed']);
export const taskStepStatusEnum = pgEnum('task_step_status', ['pending', 'active', 'completed']);

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
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
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
// task — the parent workflow unit (Phase 2)
// ---------------------------------------------------------------------------
export const task = pgTable(
  'task',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'restrict' }),
    managerId: uuid('manager_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    teamId: uuid('team_id').references(() => team.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    type: taskTypeEnum('type').notNull(),
    description: text('description'),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    status: taskStatusEnum('status').notNull().default('in_progress'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('task_org_id_idx').on(t.orgId),
    index('task_manager_id_idx').on(t.managerId),
    index('task_team_id_idx').on(t.teamId),
    index('task_status_idx').on(t.status),
    uniqueIndex('task_org_id_id_key').on(t.orgId, t.id),
  ],
);

// ---------------------------------------------------------------------------
// task_step — one step in the ordered relay chain (Phase 2)
// ---------------------------------------------------------------------------
export const taskStep = pgTable(
  'task_step',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'restrict' }),
    managerId: uuid('manager_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => task.id, { onDelete: 'cascade' }),
    assignedUserId: uuid('assigned_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    stepOrder: integer('step_order').notNull(),
    status: taskStepStatusEnum('status').notNull().default('pending'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('task_step_task_id_idx').on(t.taskId),
    index('task_step_assigned_user_id_idx').on(t.assignedUserId),
    index('task_step_manager_id_idx').on(t.managerId),
    uniqueIndex('task_step_task_id_step_order_key').on(t.taskId, t.stepOrder),
    uniqueIndex('task_step_org_id_id_key').on(t.orgId, t.id),
  ],
);

// ---------------------------------------------------------------------------
// task_attachment — file/video attachments on a task (Phase 3)
// ---------------------------------------------------------------------------
export const taskAttachment = pgTable(
  'task_attachment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'restrict' }),
    managerId: uuid('manager_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => task.id, { onDelete: 'cascade' }),
    uploadedByUserId: uuid('uploaded_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    fileName: text('file_name').notNull(),
    fileSize: text('file_size').notNull(), // text/bigint representation
    mimeType: text('mime_type').notNull(),
    storageKey: text('storage_key').notNull(),
    checksumSha256: text('checksum_sha256').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('task_attachment_org_id_idx').on(t.orgId),
    index('task_attachment_manager_id_idx').on(t.managerId),
    index('task_attachment_task_id_idx').on(t.taskId),
    index('task_attachment_uploaded_by_user_id_idx').on(t.uploadedByUserId),
    uniqueIndex('task_attachment_org_id_id_key').on(t.orgId, t.id),
  ],
);

// ---------------------------------------------------------------------------
// notification — in-app notifications (Phase 4)
// ---------------------------------------------------------------------------
export const notificationTypeEnum = pgEnum('notification_type', [
  'task_assigned',
  'step_active',
  'task_completed',
  'scheduled_task_live',
  'ranking_changed',
]);

export const notification = pgTable(
  'notification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    managerId: uuid('manager_id').references(() => user.id, { onDelete: 'restrict' }),
    type: notificationTypeEnum('type').notNull(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    taskId: uuid('task_id').references(() => task.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_notification_user_created').on(t.orgId, t.userId, t.readAt, t.createdAt),
    uniqueIndex('notification_org_id_id_key').on(t.orgId, t.id),
  ],
);

// ---------------------------------------------------------------------------
// ranking_event — append-only ranking audit history (Phase 5)
// ---------------------------------------------------------------------------
export const rankingEvent = pgTable(
  'ranking_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'restrict' }),
    managerId: uuid('manager_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    oldRanking: integer('old_ranking').notNull(),
    newRanking: integer('new_ranking').notNull(),
    changedByUserId: uuid('changed_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_ranking_event_org_id').on(t.orgId),
    index('idx_ranking_event_manager_id').on(t.managerId),
    index('idx_ranking_event_user_id').on(t.userId),
    index('idx_ranking_event_created_at').on(t.createdAt),
    uniqueIndex('ranking_event_org_id_id_key').on(t.orgId, t.id),
  ],
);

// ---------------------------------------------------------------------------
// task_report — completion reports by reporters (Phase 5)
// ---------------------------------------------------------------------------
export const taskReport = pgTable(
  'task_report',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'restrict' }),
    managerId: uuid('manager_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => task.id, { onDelete: 'cascade' }),
    reportedByUserId: uuid('reported_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    summary: text('summary').notNull(),
    highlights: text('highlights'),
    blockers: text('blockers'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_task_report_org_id').on(t.orgId),
    index('idx_task_report_manager_id').on(t.managerId),
    uniqueIndex('idx_task_report_task_id').on(t.taskId),
    uniqueIndex('task_report_org_id_id_key').on(t.orgId, t.id),
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
export type Task = typeof task.$inferSelect;
export type NewTask = typeof task.$inferInsert;
export type TaskStep = typeof taskStep.$inferSelect;
export type NewTaskStep = typeof taskStep.$inferInsert;
export type TaskAttachment = typeof taskAttachment.$inferSelect;
export type NewTaskAttachment = typeof taskAttachment.$inferInsert;
export type Notification = typeof notification.$inferSelect;
export type NewNotification = typeof notification.$inferInsert;
export type RankingEvent = typeof rankingEvent.$inferSelect;
export type NewRankingEvent = typeof rankingEvent.$inferInsert;
export type TaskReport = typeof taskReport.$inferSelect;
export type NewTaskReport = typeof taskReport.$inferInsert;

export type UserRole = (typeof userRoleEnum.enumValues)[number];
export type UserStatus = (typeof userStatusEnum.enumValues)[number];
export type TeamStatus = (typeof teamStatusEnum.enumValues)[number];
export type TaskType = (typeof taskTypeEnum.enumValues)[number];
export type TaskStatus = (typeof taskStatusEnum.enumValues)[number];
export type TaskStepStatus = (typeof taskStepStatusEnum.enumValues)[number];
export type NotificationType = (typeof notificationTypeEnum.enumValues)[number];



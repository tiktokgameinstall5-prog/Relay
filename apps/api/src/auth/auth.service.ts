/**
 * Owner authentication.
 *
 * Two rules govern everything in this file:
 *
 *   1. Every failed login looks identical from outside — same status, same body,
 *      same amount of work. Unknown email, wrong password, and deactivated
 *      account are one indistinguishable response. Anything else is an account
 *      enumeration oracle.
 *   2. Writes go through the normal RLS path with a tenant context set. The only
 *      context-free reads are the two SECURITY DEFINER lookups from
 *      0002_auth_lookup.sql, which exist because login must find a user before a
 *      context can be derived from that very user.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { SignOptions } from 'jsonwebtoken';
import { ConfigService } from '@nestjs/config';
import { compare, hash } from 'bcryptjs';
import type { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import type { CurrentUser, TenantContext, UserRole } from '../db/tenant-context';
import { appEnv } from '../config/configuration';
import type { OwnerSignupDto } from './dto/signup.dto';
import type { LoginDto } from './dto/login.dto';
import type { CreateManagerDto } from './dto/create-manager.dto';
import type { CreateMemberDto } from './dto/create-member.dto';
import type { CreateTeamDto } from './dto/create-team.dto';
import type { FirstLoginDto } from './dto/first-login.dto';
import { MailerService } from '../mail/mailer.service';
import { generatePasscode } from './passcode';
import { renderInviteEmail } from '../mail/templates/invite';

/** Postgres unique-violation. Thrown by the (org_id, email) index. */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Entropy in an opaque refresh token, before base64url encoding. 32 bytes = 256
 * bits — past any brute-force concern. The token is never read by a human, so
 * length is a non-issue.
 */
const REFRESH_TOKEN_BYTES = 32;

/**
 * SHA-256 hex of a string.
 *
 * Refresh tokens are stored ONLY as this digest; the raw token is returned to the
 * client once and then exists nowhere on the server, so a database read cannot
 * recover a usable token. A plain, unsalted digest is the correct tool here,
 * unlike for passwords: the input is 256 bits of uniform randomness, so there is
 * no dictionary to precompute and nothing a bcrypt work factor would buy — and a
 * fast digest keeps the refresh path a single indexed lookup on token_hash.
 */
function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export interface AuthLookupRow {
  id: string;
  org_id: string;
  role: UserRole;
  manager_id: string | null;
  password_hash: string | null;
  status: 'active' | 'inactive';
  passcode_hash: string | null;
  passcode_expires_at: Date | null;
  passcode_used_at: Date | null;
}

export interface AuthResult {
  accessToken: string;
  /**
   * Opaque refresh token (see AuthService rotation). Delivered BOTH in this
   * response body AND — on the browser — as an HttpOnly, Secure, SameSite=Lax
   * cookie the controllers set (auth/cookie.ts). CLAUDE.md §6 mandates one API
   * shared by the web app and the Flutter client: Flutter has no cookie jar and
   * reads the token from this body, while the browser holds the cookie its JS
   * cannot read, so an XSS payload cannot exfiltrate it and an F5 keeps the
   * session. A stolen token still buys only rotation, which reuse-detection then
   * catches.
   */
  refreshToken: string;
  user: {
    id: string;
    orgId: string;
    role: UserRole;
    name: string;
    email: string;
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly bcryptCost: number;
  private readonly accessTtl: string;
  private readonly passcodeTtlHours: number;
  private readonly refreshTtlDays: number;
  private readonly appBaseUrl: string;

  /**
   * A real bcrypt hash of a value nothing can supply, compared against when no
   * user was found. Built once at construction so the cost is paid at startup
   * rather than on the first unknown-email request — which would itself be a
   * (one-shot) timing signal.
   */
  private readonly dummyHashPromise: Promise<string>;

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(JwtService) private readonly jwt: JwtService,
    // Explicit @Inject rather than relying on the emitted type metadata: not
    // every runner emits it (tsx does not), and the failure mode is an
    // undefined dependency at construction rather than anything type-checked.
    @Inject(ConfigService) config: ConfigService,
    @Inject(MailerService) private readonly mailer: MailerService,
  ) {
    const env = appEnv(config);
    this.bcryptCost = env.BCRYPT_COST;
    this.accessTtl = env.JWT_ACCESS_TTL;
    this.passcodeTtlHours = env.PASSCODE_TTL_HOURS;
    this.refreshTtlDays = env.REFRESH_TOKEN_TTL_DAYS;
    this.appBaseUrl = env.APP_BASE_URL;
    this.dummyHashPromise = hash(randomUUID(), this.bcryptCost);
  }

  // --- signup --------------------------------------------------------------

  /**
   * Create an organization and its Owner. This is the only self-service
   * registration in the product: Managers and Members are provisioned by invite
   * (CLAUDE.md §1), so no other role has a route like this.
   */
  async ownerSignup(dto: OwnerSignupDto): Promise<AuthResult> {
    const orgId = randomUUID();
    // The id must exist before the INSERT: user_manager_id_invariant checks
    // manager_id against id in the same row, so the value cannot be
    // database-generated for the manager case. Owners are NULL, but generating
    // it here keeps one pattern across all three roles.
    const userId = randomUUID();
    const passwordHash = await hash(dto.password, this.bcryptCost);

    // The org does not exist yet, so there is no context to inherit — we assert
    // the one this transaction is about to make true. RLS then holds the
    // transaction to it: every statement below must be consistent with this
    // org, and an attempt to write another tenant's row fails rather than
    // silently succeeding.
    const ctx: TenantContext = { orgId, role: 'owner', managerId: null };

    let refreshToken: string;
    try {
      refreshToken = await this.db.withTenant(ctx, async (c) => {
        await c.query('INSERT INTO organization (id, name) VALUES ($1, $2)', [
          orgId,
          dto.organizationName,
        ]);

        await c.query(
          `INSERT INTO "user" (id, org_id, role, name, email, password_hash, manager_id)
           VALUES ($1, $2, 'owner', $3, $4, $5, NULL)`,
          [userId, orgId, dto.name, dto.email, passwordHash],
        );

        await this.writeAudit(c, {
          orgId,
          actorUserId: userId,
          action: 'owner.signup',
          targetType: 'organization',
          targetId: orgId,
        });

        // Issued inside the same transaction as the account it belongs to: a
        // rolled-back signup leaves no orphaned token, and a committed one hands
        // back a usable session atomically. A fresh randomUUID() starts a new
        // rotation family.
        return this.insertRefreshToken(c, userId, randomUUID());
      });
    } catch (err) {
      if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        // Only reachable on (org_id, email), and org_id is a fresh UUID here —
        // so in practice this is unreachable on signup and exists for honesty
        // rather than as a live path. The same address in a *different* org is
        // legitimate and must keep working (asserted in rls.e2e-spec.ts).
        throw new ConflictException('An account with that email already exists.');
      }
      throw err;
    }

    return {
      accessToken: await this.signAccessToken({
        userId,
        orgId,
        role: 'owner',
        managerId: null,
      }),
      refreshToken,
      user: { id: userId, orgId, role: 'owner', name: dto.name, email: dto.email },
    };
  }

  // --- manager provisioning --------------------------------------------------

  /**
   * Create a Manager account and issue a passcode invite.
   *
   * Owner-only: this is how Managers (and, from task #7, Members) enter the org.
   * No self-service sign-up exists for these roles.
   *
   * The passcode never appears in the HTTP response — it goes to the mailer only,
   * in plaintext, and is hashed before touching the database. The response DTO
   * carries the expiry timestamp and a flag for whether the email actually sent,
   * so the Owner knows when to regenerate if delivery failed.
   *
   * Mail is sent AFTER the transaction commits. A slow or failing mailer never
   * holds a DB transaction open (the same reasoning that made ALS carry a context
   * and not a PoolClient), and a mail failure must not roll back provisioning —
   * the account exists and the passcode is regenerable by the issuer (CLAUDE.md §1).
   */
  async createManager(
    actor: CurrentUser,
    dto: CreateManagerDto,
  ): Promise<{
    id: string;
    name: string;
    email: string;
    role: 'manager';
    status: 'active';
    passcodeExpiresAt: Date;
    inviteEmailSent: boolean;
  }> {
    // The id must exist before the INSERT: user_manager_id_invariant checks
    // manager_id against id in the same row, so a DB-generated value would
    // violate the CHECK on insert. Same reasoning as ownerSignup.
    const userId = randomUUID();
    const passcode = generatePasscode();
    const passcodeHash = await hash(passcode, this.bcryptCost);

    const expiresAt = new Date(
      Date.now() + this.passcodeTtlHours * 60 * 60 * 1000,
    );

    // TenantContextInterceptor set the ambient scope from the authenticated
    // Owner — org-wide, so this INSERT lands in the right organization with no
    // explicit context here.
    let organizationName: string;
    try {
      organizationName = await this.db.tx(async (c) => {
        await c.query(
          `INSERT INTO "user"
             (id, org_id, role, name, email, manager_id, passcode_hash, passcode_expires_at)
           VALUES ($1, $2, 'manager', $3, $4, $1, $5, $6)`,
          [userId, actor.orgId, dto.name, dto.email, passcodeHash, expiresAt],
        );

        // Metadata must contain neither the passcode nor its hash. audit_log is
        // readable by every Owner in the org, and the passcode is a credential.
        await this.writeAudit(c, {
          orgId: actor.orgId,
          actorUserId: actor.userId,
          action: 'manager.provisioned',
          targetType: 'user',
          targetId: userId,
        });

        // Read inside the same transaction rather than passing the id to the
        // template — the invite says "you've been added to X" and X must be the
        // org's name. RLS scopes this to the caller's own org.
        const { rows } = await c.query<{ name: string }>(
          'SELECT name FROM organization WHERE id = $1',
          [actor.orgId],
        );
        return rows[0]?.name ?? 'your organization';
      });
    } catch (err) {
      if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        // Genuinely reachable here, unlike on signup: user_org_id_email_key is
        // per-(org_id, email), so the same address in a DIFFERENT org is
        // legitimate and must keep working. Reporting the conflict leaks nothing
        // an Owner cannot already list inside their own org.
        throw new ConflictException(
          'That email already has an account in this organization.',
        );
      }
      throw err;
    }

    // Mail happens after commit so a slow mailer never holds the transaction
    // open, and a mail failure returns 201 with inviteEmailSent: false rather
    // than rolling back a created manager.
    const inviteEmailSent = await this.sendInviteEmail({
      to: dto.email,
      recipientName: dto.name,
      organizationName,
      passcode,
    });

    return {
      id: userId,
      name: dto.name,
      email: dto.email,
      role: 'manager',
      status: 'active',
      passcodeExpiresAt: expiresAt,
      inviteEmailSent,
    };
  }

  // --- team creation & member provisioning ----------------------------------

  /**
   * Resolve which manager a team/member is being created under, from the two
   * legitimate callers (the route is @Roles('owner','manager')).
   *
   * A Manager is pinned to their own team: their tenant key IS their own id, so
   * they may only ever create under it. Passing someone else's id is rejected
   * with a clean 400 here — the RLS WITH CHECK on `user`/`team` would also block
   * the cross-manager INSERT (manager_id must equal app_current_manager_id()),
   * but that surfaces as a 500, and a caller trying to address another manager
   * should get a deliberate refusal, not a database error.
   *
   * An Owner has no team of their own, so there is no sensible default — the
   * target manager must be named explicitly.
   */
  private resolveTargetManagerId(actor: CurrentUser, requested?: string): string {
    if (actor.role === 'manager') {
      if (requested && requested !== actor.userId) {
        throw new BadRequestException(
          'A manager can only create teams and members on their own team.',
        );
      }
      return actor.userId;
    }
    // Owner (RolesGuard has already excluded 'member').
    if (!requested) {
      throw new BadRequestException(
        "managerId is required: specify which manager's team this is for.",
      );
    }
    return requested;
  }

  /**
   * Create a team for a manager (CLAUDE.md §1: a Manager creates their own team;
   * an Owner may create teams and assign a manager).
   *
   * One active team per manager is enforced by the partial unique index
   * team_manager_id_active_key — a second active team raises 23505, mapped to 409.
   * The manager is set as a member of their own team (team_id on their user row),
   * matching the seed fixtures and the dashboards that read team membership.
   */
  async createTeam(
    actor: CurrentUser,
    dto: CreateTeamDto,
  ): Promise<{
    id: string;
    name: string;
    managerId: string;
    status: 'active';
  }> {
    const targetManagerId = this.resolveTargetManagerId(actor, dto.managerId);
    const teamId = randomUUID();

    try {
      await this.db.tx(async (c) => {
        // The target must be a real, active manager in the caller's own slice.
        // RLS scopes this read: an Owner sees every manager in the org, a Manager
        // sees only themselves — so a Manager cannot name another manager and an
        // Owner cannot reach into another organization (the row is invisible, so
        // this 400s rather than leaking that it exists elsewhere).
        const mgr = await c.query(
          `SELECT id FROM "user" WHERE id = $1 AND role = 'manager' AND status = 'active'`,
          [targetManagerId],
        );
        if (mgr.rowCount === 0) {
          throw new BadRequestException('No such manager in your organization.');
        }

        await c.query(
          `INSERT INTO team (id, org_id, manager_id, name) VALUES ($1, $2, $3, $4)`,
          [teamId, actor.orgId, targetManagerId, dto.name],
        );

        // The manager belongs to their own team.
        await c.query(
          `UPDATE "user" SET team_id = $1, updated_at = now() WHERE id = $2`,
          [teamId, targetManagerId],
        );

        await this.writeAudit(c, {
          orgId: actor.orgId,
          actorUserId: actor.userId,
          action: 'team.created',
          targetType: 'team',
          targetId: teamId,
        });
      });
    } catch (err) {
      if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        // team_manager_id_active_key: one active team per manager.
        throw new ConflictException('That manager already has an active team.');
      }
      throw err;
    }

    return { id: teamId, name: dto.name, managerId: targetManagerId, status: 'active' };
  }

  /**
   * Provision a Member and issue a passcode invite (CLAUDE.md §1: added by their
   * Manager, or by the Owner on the manager's behalf, scoped to that manager's
   * team at creation).
   *
   * Mirrors createManager exactly — role hardcoded to 'member', passcode hashed
   * before it touches the database and never returned, mail sent after commit so
   * a slow mailer never holds the transaction and a mail failure does not roll
   * back a created account. The one addition is the team: a member must land on
   * their manager's active team, so provisioning is refused (409) if that manager
   * has no team yet.
   */
  async createMember(
    actor: CurrentUser,
    dto: CreateMemberDto,
  ): Promise<{
    id: string;
    name: string;
    email: string;
    role: 'member';
    status: 'active';
    teamId: string;
    passcodeExpiresAt: Date;
    inviteEmailSent: boolean;
  }> {
    const targetManagerId = this.resolveTargetManagerId(actor, dto.managerId);

    const userId = randomUUID();
    const passcode = generatePasscode();
    const passcodeHash = await hash(passcode, this.bcryptCost);
    const expiresAt = new Date(Date.now() + this.passcodeTtlHours * 60 * 60 * 1000);

    let organizationName: string;
    let teamId: string;
    try {
      ({ organizationName, teamId } = await this.db.tx(async (c) => {
        // Same RLS-scoped guard as createTeam: the manager must be real, active,
        // and inside the caller's slice. This is the check that keeps an Owner
        // from attaching a member to a manager in another organization — without
        // it, the member's org_id (the Owner's) and manager_id (a foreign
        // manager) would both satisfy the FK and the owner RLS branch, creating a
        // cross-org member.
        const mgr = await c.query(
          `SELECT id FROM "user" WHERE id = $1 AND role = 'manager' AND status = 'active'`,
          [targetManagerId],
        );
        if (mgr.rowCount === 0) {
          throw new BadRequestException('No such manager in your organization.');
        }

        // A member must join their manager's active team. §1 scopes a member "to
        // that manager's team at creation", so there must be one.
        const team = await c.query<{ id: string }>(
          `SELECT id FROM team WHERE manager_id = $1 AND status = 'active'`,
          [targetManagerId],
        );
        if (team.rowCount === 0) {
          throw new ConflictException(
            'That manager has no active team yet — create a team first.',
          );
        }
        const resolvedTeamId = team.rows[0].id;

        await c.query(
          `INSERT INTO "user"
             (id, org_id, role, name, email, manager_id, team_id, role_title, workflow_step, passcode_hash, passcode_expires_at)
           VALUES ($1, $2, 'member', $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            userId,
            actor.orgId,
            dto.name,
            dto.email,
            targetManagerId,
            resolvedTeamId,
            dto.roleTitle ?? null,
            dto.workflowStep ?? null,
            passcodeHash,
            expiresAt,
          ],
        );

        // As in createManager: neither the passcode nor its hash may enter the
        // metadata — audit_log is readable by every Owner in the org.
        await this.writeAudit(c, {
          orgId: actor.orgId,
          actorUserId: actor.userId,
          action: 'member.provisioned',
          targetType: 'user',
          targetId: userId,
        });

        const { rows } = await c.query<{ name: string }>(
          'SELECT name FROM organization WHERE id = $1',
          [actor.orgId],
        );
        return {
          organizationName: rows[0]?.name ?? 'your organization',
          teamId: resolvedTeamId,
        };
      }));
    } catch (err) {
      if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        // user_org_id_email_key — the same address in a different org is legal.
        throw new ConflictException(
          'That email already has an account in this organization.',
        );
      }
      throw err;
    }

    const inviteEmailSent = await this.sendInviteEmail({
      to: dto.email,
      recipientName: dto.name,
      organizationName,
      passcode,
    });

    return {
      id: userId,
      name: dto.name,
      email: dto.email,
      role: 'member',
      status: 'active',
      teamId,
      passcodeExpiresAt: expiresAt,
      inviteEmailSent,
    };
  }

  // --- passcode regeneration -------------------------------------------------

  /**
   * Re-issue the invite passcode for a not-yet-activated account and re-send the
   * email (CLAUDE.md §1: passcodes are "regenerable by the issuer").
   *
   * Owner or Manager. Isolation is enforced in two layers, both server-side:
   * @OwnedResource on the route 404s a target outside the caller's tenant slice
   * before this runs, and the UPDATE below is RLS-scoped so a Manager can only
   * ever touch their own members (a Manager's slice is themselves + their team),
   * never another manager or another team's member.
   *
   * The WHERE predicates — not the guard — are what confine this to a live
   * invite:
   *   password_hash IS NULL    — the account has not been activated
   *   passcode_used_at IS NULL — the invite was never consumed
   *   role IN (manager,member) — owners have no passcode flow
   * Without them this would be an account-takeover primitive: regenerating a
   * passcode for an ACTIVE user, then running firstLogin, would reset their
   * password. A target that is active, an owner, inactive, or nonexistent all
   * collapse to the same 404 as "not in your tenant", so the caller cannot probe
   * another account's activation state.
   */
  async regeneratePasscode(
    actor: CurrentUser,
    targetUserId: string,
  ): Promise<{
    id: string;
    name: string;
    email: string;
    role: 'manager' | 'member';
    passcodeExpiresAt: Date;
    inviteEmailSent: boolean;
  }> {
    const passcode = generatePasscode();
    const passcodeHash = await hash(passcode, this.bcryptCost);
    const expiresAt = new Date(Date.now() + this.passcodeTtlHours * 60 * 60 * 1000);

    const updated = await this.db.tx(async (c) => {
      const res = await c.query<{
        name: string;
        email: string;
        role: 'manager' | 'member';
      }>(
        `UPDATE "user"
            SET passcode_hash = $2,
                passcode_expires_at = $3,
                updated_at = now()
          WHERE id = $1
            AND role IN ('manager', 'member')
            AND status = 'active'
            AND password_hash IS NULL
            AND passcode_used_at IS NULL
          RETURNING name, email, role`,
        [targetUserId, passcodeHash, expiresAt],
      );
      if (res.rowCount === 0) return null;

      const org = await c.query<{ name: string }>(
        'SELECT name FROM organization WHERE id = $1',
        [actor.orgId],
      );

      await this.writeAudit(c, {
        orgId: actor.orgId,
        actorUserId: actor.userId,
        action: 'passcode.regenerated',
        targetType: 'user',
        targetId: targetUserId,
      });

      return {
        name: res.rows[0].name,
        email: res.rows[0].email,
        role: res.rows[0].role,
        organizationName: org.rows[0]?.name ?? 'your organization',
      };
    });

    if (!updated) throw new NotFoundException();

    // After commit, same as provisioning: a slow or failing mailer never holds
    // the transaction, and a delivery failure returns 200 with
    // inviteEmailSent: false rather than undoing a regeneration the issuer asked
    // for. The old passcode is already overwritten either way.
    const inviteEmailSent = await this.sendInviteEmail({
      to: updated.email,
      recipientName: updated.name,
      organizationName: updated.organizationName,
      passcode,
    });

    return {
      id: targetUserId,
      name: updated.name,
      email: updated.email,
      role: updated.role,
      passcodeExpiresAt: expiresAt,
      inviteEmailSent,
    };
  }

  // --- login ---------------------------------------------------------------

  /**
   * Authenticate anyone who holds a password.
   *
   * Owners get one at signup; Managers (and, from task #7, Members) get one by
   * setting it during first login, which is the moment their passcode is
   * consumed. So the rule this enforces is not "which role are you" but "have
   * you completed provisioning" — a provisioned-but-not-activated account has
   * `password_hash IS NULL` and is rejected below, with no separate case needed
   * per role.
   *
   * Every rejection below throws the *same* exception object shape via
   * invalidCredentials(). Read the branches as one outcome with several causes,
   * because that is what the caller must be able to observe.
   */
  async passwordLogin(dto: LoginDto): Promise<AuthResult> {
    const row = await this.lookupByEmail(dto.email);

    // Always run bcrypt, including when no user was found. Returning early here
    // would make "unknown email" measurably faster than "wrong password" —
    // that timing difference alone is enough to enumerate accounts, and it is
    // the whole reason 0002_auth_lookup.sql returns password_hash instead of
    // doing the comparison in SQL.
    const hashToCompare = row?.password_hash ?? (await this.dummyHashPromise);
    const passwordMatches = await compare(dto.password, hashToCompare);

    if (!row) throw this.invalidCredentials();

    // Soft-deleted users keep all their history (CLAUDE.md §5) but must not be
    // able to sign in. Deliberately not a distinct message.
    if (row.status !== 'active') throw this.invalidCredentials();

    // A row with no password_hash — a provisioned account that has not yet
    // consumed its passcode. This is what keeps the passcode flow from being
    // bypassable: an invited Manager cannot skip first-login by guessing a
    // password, because there is nothing here to match against. The compare
    // above already ran against the dummy hash, so this costs the same as any
    // other failure.
    if (!row.password_hash) throw this.invalidCredentials();

    if (!passwordMatches) throw this.invalidCredentials();

    const session = await this.db.withTenant(
      { orgId: row.org_id, role: row.role, managerId: row.manager_id },
      async (c) => {
        const { rows } = await c.query<{ name: string; email: string }>(
          'SELECT name, email FROM "user" WHERE id = $1',
          [row.id],
        );
        if (!rows[0]) return null;
        // A fresh login starts a new session lineage, unrelated to any refresh
        // chain the same user may already hold on another device.
        const refreshToken = await this.insertRefreshToken(c, row.id, randomUUID());
        return { ...rows[0], refreshToken };
      },
    );

    // Should be unreachable: the definer lookup just found this row. If it
    // happens, the tenant context built from that row does not select it back —
    // an isolation bug, not a credentials problem. Fail closed and make noise.
    if (!session) {
      this.logger.error(
        `User ${row.id} found by definer lookup but not visible under its own tenant context.`,
      );
      throw this.invalidCredentials();
    }

    return {
      accessToken: await this.signAccessToken({
        userId: row.id,
        orgId: row.org_id,
        role: row.role,
        managerId: row.manager_id,
      }),
      refreshToken: session.refreshToken,
      user: {
        id: row.id,
        orgId: row.org_id,
        role: row.role,
        name: session.name,
        email: session.email,
      },
    };
  }

  /**
   * First login for an invited account: consume the passcode, set the permanent
   * password, and return a token — one request, one transaction.
   *
   * Role-neutral by design. A Manager and a Member activate through this same
   * method; the role is read from the row the lookup returns, never from the
   * request, and only 'manager' and 'member' are accepted (fail-closed
   * allow-list). The invite email and its `/invite?email=...` link carry no
   * role, so the activation path cannot depend on one — see FirstLoginDto.
   *
   * Atomic rather than two steps because CLAUDE.md §1 makes passcodes single-use.
   * If setting a password were a separate optional call, consuming the passcode
   * would leave the account with no usable credential at all — permanently
   * locked out.
   *
   * Mirrors passwordLogin's discipline exactly: bcrypt always runs, and every
   * rejection — unknown email, wrong passcode, expired, already used, wrong
   * role, inactive, already has a password — throws one identical 401.
   */
  async firstLogin(dto: FirstLoginDto): Promise<AuthResult> {
    const row = await this.lookupByEmail(dto.email);

    // Same reasoning as passwordLogin: never return before bcrypt has run, or
    // "no such account" becomes measurably faster than "wrong passcode".
    const hashToCompare = row?.passcode_hash ?? (await this.dummyHashPromise);
    const passcodeMatches = await compare(dto.passcode, hashToCompare);

    if (!row) throw this.invalidCredentials();

    // Owners have no passcode flow — they sign up with a password directly.
    // Only invited roles activate here. This is a fail-closed allow-list, not a
    // blocklist: any future role is rejected until deliberately added, so a new
    // role can never fall through into an activation path by default.
    if (row.role !== 'manager' && row.role !== 'member') {
      throw this.invalidCredentials();
    }
    if (row.status !== 'active') throw this.invalidCredentials();
    if (!row.passcode_hash) throw this.invalidCredentials();
    if (row.passcode_used_at !== null) throw this.invalidCredentials();
    if (!row.passcode_expires_at || row.passcode_expires_at.getTime() <= Date.now()) {
      throw this.invalidCredentials();
    }
    // An account that already has a password has completed provisioning; it
    // logs in through passwordLogin. Allowing a passcode to reset it would turn
    // a stale invite email into an account takeover.
    if (row.password_hash) throw this.invalidCredentials();
    if (!passcodeMatches) throw this.invalidCredentials();

    const newPasswordHash = await hash(dto.newPassword, this.bcryptCost);

    // @Public() route, so there is no ambient scope and db.tx() would throw.
    // The context is asserted from the row the definer lookup just returned —
    // the same explicit pattern passwordLogin uses. role comes from the row, so
    // a member activates under a member context and a manager under a manager one.
    const session = await this.db.withTenant(
      { orgId: row.org_id, role: row.role, managerId: row.manager_id },
      async (c) => {
        // THE GUARD CONDITIONS ARE REPEATED IN THE WHERE CLAUSE ON PURPOSE.
        //
        // The JS checks above exist to produce a timing-equalised response. This
        // WHERE clause is what actually makes the passcode single-use: two
        // concurrent requests carrying the same valid passcode both pass the JS
        // checks, but only one of them updates a row. The other sees rowCount 0
        // and gets the same 401 as any other failure.
        //
        // passcode_hash is deliberately NOT nulled. user_passcode_coherent is
        // `passcode_used_at IS NULL OR passcode_hash IS NOT NULL`, so clearing
        // the hash while stamping used_at would violate the CHECK. used_at is
        // the single-use gate; what remains is a bcrypt digest of a now-
        // worthless one-time string.
        const res = await c.query<{ name: string; email: string }>(
          `UPDATE "user"
              SET password_hash = $2,
                  passcode_used_at = now(),
                  passcode_expires_at = NULL,
                  updated_at = now()
            WHERE id = $1
              AND passcode_used_at IS NULL
              AND passcode_hash IS NOT NULL
              AND passcode_expires_at > now()
              AND password_hash IS NULL
              AND status = 'active'
              AND role IN ('manager', 'member')
            RETURNING name, email`,
          [row.id, newPasswordHash],
        );

        if (res.rowCount === 0) return null;

        await this.writeAudit(c, {
          orgId: row.org_id,
          actorUserId: row.id,
          action: `${row.role}.first_login`,
          targetType: 'user',
          targetId: row.id,
        });

        // Same transaction as the activation: the account cannot end up
        // activated-but-sessionless, nor with a token that a rolled-back
        // activation never earned. New family — this is a fresh session.
        const refreshToken = await this.insertRefreshToken(c, row.id, randomUUID());
        return { ...res.rows[0], refreshToken };
      },
    );

    // Lost the race, or the row moved under us between lookup and update.
    // Indistinguishable from every other failure, by design.
    if (!session) throw this.invalidCredentials();

    return {
      accessToken: await this.signAccessToken({
        userId: row.id,
        orgId: row.org_id,
        role: row.role,
        managerId: row.manager_id,
      }),
      refreshToken: session.refreshToken,
      user: {
        id: row.id,
        orgId: row.org_id,
        role: row.role,
        name: session.name,
        email: session.email,
      },
    };
  }

  // --- refresh & logout -----------------------------------------------------

  /**
   * Rotate a refresh token: revoke the presented one and mint its successor in
   * the same family, returning a fresh access token alongside.
   *
   * Rotation-on-use with family-wide revocation on reuse is what makes an opaque
   * bearer token safe to hand out for 30 days. Each token is single-use; the
   * moment one is presented it is revoked and replaced. So a token seen twice is
   * an anomaly with only two explanations — the legitimate client retried, or a
   * stolen copy is being used in parallel — and since neither the server nor the
   * user can tell which, the safe response to both is to burn the whole family
   * and force a fresh login. A thief who races ahead of the victim thus locks
   * *themselves* out on the victim's next refresh, and vice versa.
   *
   * Every failure — unknown token, already-revoked (reuse), expired, or a
   * since-deactivated user — returns one identical 401 via invalidRefreshToken(),
   * the same anti-oracle discipline as passwordLogin.
   */
  async refresh(presentedToken: string): Promise<AuthResult> {
    const tokenHash = sha256Hex(presentedToken);

    // The write half runs context-free and committing (unscopedTx): a refresh
    // request carries only the opaque token, so there is no tenant to scope by,
    // and refresh_token deliberately has no RLS (see DbService.unscopedTx). The
    // user's identity is the RESULT of this lookup, not an input to it.
    const rotated = await this.db.unscopedTx(async (c) => {
      // FOR UPDATE serialises two concurrent refreshes of the same token: the
      // second blocks until the first commits, then reads revoked_at set and
      // takes the reuse path. Without the lock both could rotate.
      const { rows } = await c.query<{
        id: string;
        user_id: string;
        family_id: string;
        expires_at: Date;
        revoked_at: Date | null;
      }>(
        `SELECT id, user_id, family_id, expires_at, revoked_at
           FROM refresh_token
          WHERE token_hash = $1
          FOR UPDATE`,
        [tokenHash],
      );
      const token = rows[0];

      // Unknown token — nothing to rotate, nothing to revoke.
      if (!token) return null;

      // Reuse of an already-revoked token. Treat as compromise: revoke every
      // still-live token in the family so both the thief and the legitimate
      // client are forced back through login.
      if (token.revoked_at !== null) {
        await c.query(
          `UPDATE refresh_token SET revoked_at = now()
            WHERE family_id = $1 AND revoked_at IS NULL`,
          [token.family_id],
        );
        return null;
      }

      // Expired. Left in place (not revoked) — it is already useless, and a
      // sweep can reap expired rows later without racing this path.
      if (token.expires_at.getTime() <= Date.now()) return null;

      // The normal path: revoke this token, mint its successor in the same
      // family. Both writes commit together, so a token is never left revoked
      // with no successor, nor a successor minted without revoking its parent.
      await c.query(`UPDATE refresh_token SET revoked_at = now() WHERE id = $1`, [
        token.id,
      ]);
      const refreshToken = await this.insertRefreshToken(
        c,
        token.user_id,
        token.family_id,
      );
      return { userId: token.user_id, refreshToken };
    });

    if (!rotated) throw this.invalidRefreshToken();

    // Re-derive the session from the user row, exactly as JwtStrategy does on
    // every request: role/orgId/managerId come from the row, never from the
    // token, and a since-deactivated user is refused here too. The successor
    // token committed above is then inert for them — acceptable, since they can
    // mint no access token, and their next attempt with the now-revoked parent
    // trips reuse-detection and reaps the family.
    const row = await this.lookupById(rotated.userId);
    if (!row || row.status !== 'active') throw this.invalidRefreshToken();

    // auth_lookup_by_id deliberately does not return name/email (0002), so read
    // them under the row's own tenant context — the same second read passwordLogin
    // makes.
    const user = await this.db.withTenant(
      { orgId: row.org_id, role: row.role, managerId: row.manager_id },
      async (c) => {
        const { rows } = await c.query<{ name: string; email: string }>(
          'SELECT name, email FROM "user" WHERE id = $1',
          [rotated.userId],
        );
        return rows[0] ?? null;
      },
    );
    if (!user) throw this.invalidRefreshToken();

    return {
      accessToken: await this.signAccessToken({
        userId: row.id,
        orgId: row.org_id,
        role: row.role,
        managerId: row.manager_id,
      }),
      refreshToken: rotated.refreshToken,
      user: {
        id: row.id,
        orgId: row.org_id,
        role: row.role,
        name: user.name,
        email: user.email,
      },
    };
  }

  /**
   * End a session. CLAUDE.md §1/§5: logout only ends the session — no data is
   * touched, and re-entry is the ordinary login flow.
   *
   * Revokes the whole family of the presented token, not just the token itself,
   * so "log me out" kills the session lineage rather than one link that a
   * previous rotation may already have replaced. Idempotent and silent: an
   * unknown, already-revoked, or malformed token is a no-op returning success,
   * because a logged-out client discarding a token it can no longer use is not an
   * error and there is nothing to report to it.
   *
   * Possession of the token authorises its revocation — no access token is
   * required. That is deliberate: an access token may have already expired when
   * the user clicks "sign out", and revoking a session is strictly less harmful
   * than the rotation that same token could otherwise perform.
   */
  async logout(presentedToken: string): Promise<void> {
    const tokenHash = sha256Hex(presentedToken);
    await this.db.unscopedTx(async (c) => {
      await c.query(
        `UPDATE refresh_token SET revoked_at = now()
          WHERE family_id = (SELECT family_id FROM refresh_token WHERE token_hash = $1)
            AND revoked_at IS NULL`,
        [tokenHash],
      );
    });
  }

  // --- lookups (the only context-free reads in the codebase) ----------------

  /** @see src/db/migrations/0002_auth_lookup.sql */
  async lookupByEmail(email: string): Promise<AuthLookupRow | null> {
    const rows = await this.db.withoutTenant(async (c) => {
      const res = await c.query<AuthLookupRow>(
        'SELECT * FROM auth_lookup_by_email($1)',
        [email],
      );
      return res.rows;
    });
    return rows[0] ?? null;
  }

  /**
   * Used by JwtStrategy on every authenticated request, so that deactivating a
   * user takes effect immediately rather than whenever their token expires.
   */
  async lookupById(userId: string): Promise<Omit<AuthLookupRow, 'password_hash'> | null> {
    const rows = await this.db.withoutTenant(async (c) => {
      const res = await c.query<Omit<AuthLookupRow, 'password_hash'>>(
        'SELECT * FROM auth_lookup_by_id($1)',
        [userId],
      );
      return res.rows;
    });
    return rows[0] ?? null;
  }

  // --- helpers -------------------------------------------------------------

  private signAccessToken(user: CurrentUser): Promise<string> {
    // Exactly the claims the RLS policies consume, and nothing else. A token is
    // readable by whoever holds it, so anything not needed for scoping is
    // needless disclosure.
    return this.jwt.signAsync(
      {
        sub: user.userId,
        role: user.role,
        orgId: user.orgId,
        managerId: user.managerId,
      },
      // Cast for the same reason as in auth.module.ts: jsonwebtoken types
      // expiresIn as a template-literal union that an env-sourced string cannot
      // satisfy statically. The format is validated in env.validation.ts.
      { expiresIn: this.accessTtl as SignOptions['expiresIn'] },
    );
  }

  /**
   * Insert one opaque refresh token and return its RAW value — the only moment
   * that value exists un-hashed on the server. Runs on whatever transaction the
   * caller supplies (the login/signup/first-login write, or the rotation inside
   * unscopedTx), so issuance is always atomic with the state change that earns it.
   *
   * `familyId` ties the token to a rotation lineage: a fresh randomUUID() at
   * login/signup/first-login begins a new family; rotation passes the presented
   * token's family so the whole chain can be revoked together on reuse.
   */
  private async insertRefreshToken(
    c: PoolClient,
    userId: string,
    familyId: string,
  ): Promise<string> {
    const raw = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(
      Date.now() + this.refreshTtlDays * 24 * 60 * 60 * 1000,
    );
    await c.query(
      `INSERT INTO refresh_token (user_id, token_hash, family_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [userId, sha256Hex(raw), familyId, expiresAt],
    );
    return raw;
  }

  /**
   * One object for every failure. Constructed fresh each time so the message
   * cannot be mutated by a caller, but always identical in content.
   */
  private invalidCredentials(): UnauthorizedException {
    return new UnauthorizedException('Invalid email or password.');
  }

  /**
   * The refresh-path analogue of invalidCredentials(): one identical 401 for
   * every reason a refresh can fail — unknown token, reuse of a revoked one,
   * expiry, or a since-deactivated user. Distinguishing them would tell a holder
   * of a random or stale token something about it; they learn only "sign in
   * again".
   */
  private invalidRefreshToken(): UnauthorizedException {
    return new UnauthorizedException('Session expired. Please sign in again.');
  }

  /**
   * Send an invite email and report whether it went out. Shared by createManager
   * and createMember — the invite is identical for both roles (the template and
   * the role-less `/invite?email=...` link are shared on purpose).
   *
   * The passcode is passed in plaintext because the email IS the only place it
   * exists in plaintext; it is never logged here, never returned, and the link
   * deliberately does not carry it (renderInviteEmail explains why). A failure is
   * non-fatal to the caller: the account already exists and the passcode is
   * regenerable by the issuer (CLAUDE.md §1), so this returns false rather than
   * throwing and rolling back a created account.
   */
  private async sendInviteEmail(params: {
    to: string;
    recipientName: string;
    organizationName: string;
    passcode: string;
  }): Promise<boolean> {
    try {
      const inviteLink = `${this.appBaseUrl}/invite?email=${encodeURIComponent(params.to)}`;
      const { subject, text } = renderInviteEmail({
        recipientName: params.recipientName,
        organizationName: params.organizationName,
        passcode: params.passcode,
        inviteLink,
        ttlHours: this.passcodeTtlHours,
      });
      await this.mailer.send({ to: params.to, subject, text });
      return true;
    } catch (err) {
      this.logger.error(
        `Invite email to ${params.to} failed: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Audit writes are fire-and-forget by necessity, not by choice: the audit_log
   * SELECT policy is owner-only, and `RETURNING` performs an implicit SELECT, so
   * `INSERT ... RETURNING` fails RLS for every other role (documented in
   * 0001_rls.sql). No RETURNING here, and a failure is logged rather than
   * allowed to roll back the operation being audited.
   *
   * The SAVEPOINT is not optional. A failed statement aborts the whole Postgres
   * transaction, and catching the error in JavaScript does not un-abort it: the
   * following COMMIT would silently become a ROLLBACK, discarding the signup
   * while still returning 201 to the caller. Rolling back to the savepoint
   * confines the damage to the audit row.
   */
  private async writeAudit(
    c: PoolClient,
    entry: {
      orgId: string;
      actorUserId: string;
      action: string;
      targetType: string;
      targetId: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    await c.query('SAVEPOINT audit_write');
    try {
      await c.query(
        `INSERT INTO audit_log (org_id, actor_user_id, action, target_type, target_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          entry.orgId,
          entry.actorUserId,
          entry.action,
          entry.targetType,
          entry.targetId,
          entry.metadata ? JSON.stringify(entry.metadata) : null,
        ],
      );
      await c.query('RELEASE SAVEPOINT audit_write');
    } catch (err) {
      await c.query('ROLLBACK TO SAVEPOINT audit_write');
      this.logger.error(`Audit write failed for ${entry.action}: ${(err as Error).message}`);
    }
  }
}

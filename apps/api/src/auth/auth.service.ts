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
import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
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
import type { ManagerFirstLoginDto } from './dto/manager-first-login.dto';
import { MailerService } from '../mail/mailer.service';
import { generatePasscode } from './passcode';
import { renderInviteEmail } from '../mail/templates/invite';

/** Postgres unique-violation. Thrown by the (org_id, email) index. */
const PG_UNIQUE_VIOLATION = '23505';

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

    try {
      await this.db.withTenant(ctx, async (c) => {
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
    let inviteEmailSent = true;
    try {
      const inviteLink = `${this.appBaseUrl}/invite?email=${encodeURIComponent(dto.email)}`;
      const { subject, text } = renderInviteEmail({
        recipientName: dto.name,
        organizationName,
        passcode,
        inviteLink,
        ttlHours: this.passcodeTtlHours,
      });
      await this.mailer.send({ to: dto.email, subject, text });
    } catch (err) {
      this.logger.error(
        `Invite email to ${dto.email} failed: ${(err as Error).message}`,
      );
      inviteEmailSent = false;
    }

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

    const user = await this.db.withTenant(
      { orgId: row.org_id, role: row.role, managerId: row.manager_id },
      async (c) => {
        const { rows } = await c.query<{ name: string; email: string }>(
          'SELECT name, email FROM "user" WHERE id = $1',
          [row.id],
        );
        return rows[0];
      },
    );

    // Should be unreachable: the definer lookup just found this row. If it
    // happens, the tenant context built from that row does not select it back —
    // an isolation bug, not a credentials problem. Fail closed and make noise.
    if (!user) {
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
   * Manager first login: consume the passcode, set the permanent password, and
   * return a token — one request, one transaction.
   *
   * Atomic rather than two steps because CLAUDE.md §1 makes passcodes single-use.
   * If setting a password were a separate optional call, consuming the passcode
   * would leave the account with no usable credential at all — permanently
   * locked out. See ManagerFirstLoginDto for the full reading of "may set a
   * permanent password".
   *
   * Mirrors passwordLogin's discipline exactly: bcrypt always runs, and every
   * rejection — unknown email, wrong passcode, expired, already used, wrong
   * role, inactive, already has a password — throws one identical 401.
   */
  async managerFirstLogin(dto: ManagerFirstLoginDto): Promise<AuthResult> {
    const row = await this.lookupByEmail(dto.email);

    // Same reasoning as passwordLogin: never return before bcrypt has run, or
    // "no such account" becomes measurably faster than "wrong passcode".
    const hashToCompare = row?.passcode_hash ?? (await this.dummyHashPromise);
    const passcodeMatches = await compare(dto.passcode, hashToCompare);

    if (!row) throw this.invalidCredentials();

    // Owners have no passcode flow, and Members are task #7. Accepting either
    // here would be a way into an account through the wrong door.
    if (row.role !== 'manager') throw this.invalidCredentials();
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
    // the same explicit pattern passwordLogin uses.
    const user = await this.db.withTenant(
      { orgId: row.org_id, role: 'manager', managerId: row.manager_id },
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
              AND role = 'manager'
            RETURNING name, email`,
          [row.id, newPasswordHash],
        );

        if (res.rowCount === 0) return null;

        await this.writeAudit(c, {
          orgId: row.org_id,
          actorUserId: row.id,
          action: 'manager.first_login',
          targetType: 'user',
          targetId: row.id,
        });

        return res.rows[0];
      },
    );

    // Lost the race, or the row moved under us between lookup and update.
    // Indistinguishable from every other failure, by design.
    if (!user) throw this.invalidCredentials();

    return {
      accessToken: await this.signAccessToken({
        userId: row.id,
        orgId: row.org_id,
        role: 'manager',
        managerId: row.manager_id,
      }),
      user: {
        id: row.id,
        orgId: row.org_id,
        role: 'manager',
        name: user.name,
        email: user.email,
      },
    };
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
   * One object for every failure. Constructed fresh each time so the message
   * cannot be mutated by a caller, but always identical in content.
   */
  private invalidCredentials(): UnauthorizedException {
    return new UnauthorizedException('Invalid email or password.');
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

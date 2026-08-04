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
import type { OwnerLoginDto } from './dto/login.dto';

/** Postgres unique-violation. Thrown by the (org_id, email) index. */
const PG_UNIQUE_VIOLATION = '23505';

export interface AuthLookupRow {
  id: string;
  org_id: string;
  role: UserRole;
  manager_id: string | null;
  password_hash: string | null;
  status: 'active' | 'inactive';
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
  ) {
    const env = appEnv(config);
    this.bcryptCost = env.BCRYPT_COST;
    this.accessTtl = env.JWT_ACCESS_TTL;
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

  // --- login ---------------------------------------------------------------

  /**
   * Authenticate an Owner.
   *
   * Every rejection below throws the *same* exception object shape via
   * invalidCredentials(). Read the branches as one outcome with several causes,
   * because that is what the caller must be able to observe.
   */
  async ownerLogin(dto: OwnerLoginDto): Promise<AuthResult> {
    const row = await this.lookupByEmail(dto.email);

    // Always run bcrypt, including when no user was found. Returning early here
    // would make "unknown email" measurably faster than "wrong password" —
    // that timing difference alone is enough to enumerate accounts, and it is
    // the whole reason 0002_auth_lookup.sql returns password_hash instead of
    // doing the comparison in SQL.
    const hashToCompare = row?.password_hash ?? (await this.dummyHashPromise);
    const passwordMatches = await compare(dto.password, hashToCompare);

    if (!row) throw this.invalidCredentials();

    // A Manager or Member reaching this route means either a misdirected client
    // or someone probing for a way around the passcode flow. Their login is a
    // separate route with a different credential model (task #6); accepting a
    // password here would quietly bypass it.
    if (row.role !== 'owner') throw this.invalidCredentials();

    // Soft-deleted users keep all their history (CLAUDE.md §5) but must not be
    // able to sign in. Deliberately not a distinct message.
    if (row.status !== 'active') throw this.invalidCredentials();

    // A row with no password_hash — a provisioned account that has not set one.
    // The compare above already ran against the dummy hash, so this costs the
    // same as any other failure.
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

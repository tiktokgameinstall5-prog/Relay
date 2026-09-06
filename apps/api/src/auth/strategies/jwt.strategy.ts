/**
 * Access-token validation.
 *
 * validate() is not a formality. Passport has already verified the signature and
 * expiry by the time it runs, but a signed token only proves the claims were
 * true when issued. Re-reading the user on every request is what makes
 * deactivation take effect immediately instead of up to JWT_ACCESS_TTL later.
 */
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { appEnv } from '../../config/configuration';
import { AuthService } from '../auth.service';
import type { CurrentUser, UserRole } from '../../db/tenant-context';

interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  orgId: string;
  managerId: string | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @Inject(ConfigService) config: ConfigService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        ExtractJwt.fromUrlQueryParameter('token'),
      ]),
      // Never true. An expired token must stop working; letting the app decide
      // would mean re-implementing expiry checking by hand.
      ignoreExpiration: false,
      secretOrKey: appEnv(config).JWT_ACCESS_SECRET,
    });
  }

  async validate(payload: AccessTokenPayload): Promise<CurrentUser> {
    if (!payload?.sub) throw new UnauthorizedException();

    const row = await this.auth.lookupById(payload.sub);
    if (!row) throw new UnauthorizedException();

    // Soft-deleted (CLAUDE.md §5): the row still exists and keeps its history,
    // but it must not authenticate.
    if (row.status !== 'active') throw new UnauthorizedException();

    // The tenant context comes from the DATABASE ROW, never from the token.
    // A token is client-held data; if role/orgId/managerId were taken from the
    // payload, forging a manager_id would be worth attempting. Taking them from
    // the row means the token's only real claim is "which user am I", and
    // everything that governs scoping is re-derived server-side.
    return {
      userId: row.id,
      orgId: row.org_id,
      role: row.role,
      managerId: row.manager_id,
    };
  }
}

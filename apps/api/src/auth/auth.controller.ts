import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService, type AuthResult } from './auth.service';
import { OwnerSignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh.dto';
import { AuthResultDto } from './dto/api-response.dto';
import { Public } from './decorators/public.decorator';
import { LoginThrottlerGuard } from './guards/login-throttler.guard';
import { SignupThrottlerGuard } from './guards/signup-throttler.guard';
import { appEnv } from '../config/configuration';
import {
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
} from './cookie';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  /**
   * Cookie lifetime, in seconds, tracking the refresh token's own TTL so the
   * browser's cookie and the server-side row expire together.
   */
  private readonly refreshCookieMaxAgeSeconds: number;

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    // Explicit @Inject rather than trusting emitted metadata — see AuthService's
    // constructor for why (not every runner emits it).
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.refreshCookieMaxAgeSeconds = appEnv(config).REFRESH_TOKEN_TTL_DAYS * 86_400;
  }

  /**
   * The only self-service registration in the product. Managers and Members are
   * provisioned by invite (CLAUDE.md §1) and deliberately have no route like
   * this — which is why this one keeps the `owner/` segment while login does not.
   *
   * Throttled via SignupThrottlerGuard, keyed on IP: signup is unauthenticated
   * and creates a new org, so there is no account to key on and the email names
   * an org that does not exist yet (see the guard for why IP is the right key).
   * The named 'signup' throttler's limit/ttl come from validated env in
   * AppModule, so the e2e suite can lift the limit (test/helpers/test-env.ts)
   * without a real production limit having to be unrealistically high.
   *
   * @SkipThrottle of the other two named throttlers is load-bearing, not
   * tidiness: a ThrottlerGuard evaluates EVERY registered throttler, so without
   * these signup would also be measured against the login and provisioning
   * buckets.
   */
  @ApiOperation({
    summary: 'Create an organization and its Owner',
    description:
      'The only self-service registration in the product. Managers and Members ' +
      'are provisioned by invite and have no equivalent route. Returns an access ' +
      'token and a refresh token.',
  })
  @ApiCreatedResponse({ type: AuthResultDto })
  @ApiConflictResponse({ description: 'That email already has an account in this organization.' })
  @ApiTooManyRequestsResponse({ description: '10 signups per hour per IP.' })
  @Public()
  @SkipThrottle({ login: true, provisioning: true })
  @UseGuards(SignupThrottlerGuard)
  @Post('owner/signup')
  async signup(
    @Body() dto: OwnerSignupDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResult> {
    const result = await this.auth.ownerSignup(dto);
    setRefreshCookie(res, result.refreshToken, this.refreshCookieMaxAgeSeconds);
    return result;
  }

  /**
   * 200, not 201: login creates no resource. The default for POST in Nest is
   * 201, which would be wrong here.
   *
   * Not Owner-specific despite living on this controller: Managers and Members
   * use this same route once first-login has set their password. The role is
   * never in the request — it is read from the user row server-side.
   *
   * The named throttler config lives in AppModule so the limit is set from
   * validated env rather than hardcoded at the decorator.
   */
  @ApiOperation({
    summary: 'Authenticate with email and password',
    description:
      'For any role that has a password: Owners from signup, Managers and ' +
      'Members once first-login has set one. Unknown email, wrong password, a ' +
      'deactivated account, and an invited-but-not-yet-activated account all ' +
      'return an identical 401 — the difference is not observable, by design.',
  })
  @ApiOkResponse({ type: AuthResultDto })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials.' })
  @ApiTooManyRequestsResponse({
    description: '5 attempts per 15 minutes, keyed on email + IP.',
  })
  @Public()
  @SkipThrottle({ signup: true, provisioning: true })
  @UseGuards(LoginThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResult> {
    const result = await this.auth.passwordLogin(dto);
    setRefreshCookie(res, result.refreshToken, this.refreshCookieMaxAgeSeconds);
    return result;
  }

  /**
   * Exchange a refresh token for a new access token (and a new refresh token).
   *
   * The token arrives in the body (mobile) or the HttpOnly relay_rt cookie
   * (browser); either way the rotated successor is set back as the cookie AND
   * returned in the body, so both clients stay served (auth/cookie.ts).
   *
   * @Public() because the refresh token IS the credential — the access token it
   * replaces may already have expired, which is the whole reason to refresh. Each
   * call rotates: the presented token is revoked and a successor minted, and a
   * token seen twice trips reuse-detection and burns the family. 200, not 201:
   * no resource is created.
   *
   * Not throttled by a named throttler: the token is 256 bits of randomness, so
   * there is nothing to brute-force, and reuse-detection already punishes replay.
   */
  @ApiOperation({
    summary: 'Rotate a refresh token for a fresh session',
    description:
      'Exchange a valid refresh token for a new access token and a new refresh ' +
      'token. The presented token is single-use; replaying an already-rotated ' +
      'token revokes the entire token family. Unknown, expired, reused, and ' +
      'deactivated-user tokens all return an identical 401.',
  })
  @ApiOkResponse({ type: AuthResultDto })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired refresh token.' })
  @Public()
  @SkipThrottle({ login: true, signup: true, provisioning: true })
  @HttpCode(HttpStatus.OK)
  @Post('session/refresh')
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResult> {
    // Body first (mobile), then the HttpOnly cookie (browser). An absent token
    // falls through as '' and takes the ordinary uniform-401 path in the service
    // — never a 500 (sha256('') simply matches no row).
    const token = dto.refreshToken ?? readRefreshCookie(req) ?? '';
    const result = await this.auth.refresh(token);
    setRefreshCookie(res, result.refreshToken, this.refreshCookieMaxAgeSeconds);
    return result;
  }

  /**
   * End a session. CLAUDE.md §1/§5: logout only ends the session — no data is
   * affected, and re-entry is the ordinary login flow.
   *
   * Reads the token from the body (mobile) or the relay_rt cookie (browser), and
   * ALWAYS clears the cookie — a browser cannot read its own HttpOnly cookie to
   * send in the body, so the server-side read is the only way its "sign out"
   * revokes anything.
   *
   * @Public() and keyed on the token, not an access token: possession of the
   * refresh token authorises revoking it, and a user should be able to sign out
   * even after their access token has expired. Idempotent — an unknown, absent,
   * or already-revoked token returns 204 all the same. 204 No Content: there is
   * nothing to return to a client that just discarded its session.
   */
  @ApiOperation({
    summary: 'Revoke a session (and its whole token family)',
    description:
      'Revokes the refresh token and every other token in its rotation family. ' +
      'Idempotent: an unknown or already-revoked token still returns 204. Only ' +
      'the session ends — no data is affected.',
  })
  @ApiNoContentResponse({ description: 'Session revoked (or already gone).' })
  @Public()
  @SkipThrottle({ login: true, signup: true, provisioning: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('session/logout')
  async logout(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    // Revoke whatever token was presented — body (mobile) or cookie (browser).
    // ALWAYS clear the browser's cookie regardless, so "sign out" empties the
    // store even if no token reached the server (nothing to revoke, but the
    // cookie must still go). No token at all is a silent no-op, as before.
    const token = dto.refreshToken ?? readRefreshCookie(req);
    if (token) await this.auth.logout(token);
    clearRefreshCookie(res);
  }
}

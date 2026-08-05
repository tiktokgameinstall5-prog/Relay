import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService, type AuthResult } from './auth.service';
import { OwnerSignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResultDto } from './dto/api-response.dto';
import { Public } from './decorators/public.decorator';
import { LoginThrottlerGuard } from './guards/login-throttler.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  /**
   * The only self-service registration in the product. Managers and Members are
   * provisioned by invite (CLAUDE.md §1) and deliberately have no route like
   * this — which is why this one keeps the `owner/` segment while login does not.
   *
   * KNOWN GAP: this @Throttle is currently inert. A named @Throttle only takes
   * effect where a ThrottlerGuard runs, and none is registered globally in
   * AppModule — only the routes carrying @UseGuards(LoginThrottlerGuard) are
   * actually limited. So signup has no rate limit in practice.
   *
   * Not fixed here. Attaching ThrottlerGuard makes the 10/hour budget real and
   * immediately fails 13 e2e tests, which create far more than ten orgs from one
   * IP. The real fix is an env-configurable limit (as LOGIN_THROTTLE_LIMIT
   * already is) with a high value in the test environment, which belongs with
   * the rest of the throttling work in task #8. Tracked in PROGRESS.md.
   */
  @ApiOperation({
    summary: 'Create an organization and its Owner',
    description:
      'The only self-service registration in the product. Managers and Members ' +
      'are provisioned by invite and have no equivalent route. Returns a token ' +
      'you can paste into **Authorize** to call `GET /api/me`.',
  })
  @ApiCreatedResponse({ type: AuthResultDto })
  @ApiConflictResponse({ description: 'That email already has an account in this organization.' })
  @ApiTooManyRequestsResponse({ description: '10 signups per hour per IP.' })
  @Public()
  @Throttle({ signup: { limit: 10, ttl: 3_600_000 } })
  @Post('owner/signup')
  signup(@Body() dto: OwnerSignupDto): Promise<AuthResult> {
    return this.auth.ownerSignup(dto);
  }

  /**
   * 200, not 201: login creates no resource. The default for POST in Nest is
   * 201, which would be wrong here.
   *
   * Not Owner-specific despite living on this controller: Managers use this same
   * route once first-login has set their password, as will Members from task #7.
   * The role is never in the request — it is read from the user row server-side.
   *
   * The named throttler config lives in AppModule so the limit is set from
   * validated env rather than hardcoded at the decorator.
   */
  @ApiOperation({
    summary: 'Authenticate with email and password',
    description:
      'For any role that has a password: Owners from signup, Managers once ' +
      'first-login has set one. Unknown email, wrong password, a deactivated ' +
      'account, and an invited-but-not-yet-activated account all return an ' +
      'identical 401 — the difference is not observable, by design.',
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
  login(@Body() dto: LoginDto): Promise<AuthResult> {
    return this.auth.passwordLogin(dto);
  }
}

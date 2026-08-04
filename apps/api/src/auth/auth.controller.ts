import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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
import { OwnerLoginDto } from './dto/login.dto';
import { AuthResultDto } from './dto/api-response.dto';
import { Public } from './decorators/public.decorator';
import { LoginThrottlerGuard } from './guards/login-throttler.guard';

@ApiTags('auth')
@Controller('auth/owner')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  /**
   * The only self-service registration in the product. Managers and Members are
   * provisioned by invite (CLAUDE.md §1) and deliberately have no route like
   * this.
   *
   * Throttled on IP alone — there is no account to key on before one exists —
   * with a looser budget than login, since a legitimate user signs up once.
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
  @Post('signup')
  signup(@Body() dto: OwnerSignupDto): Promise<AuthResult> {
    return this.auth.ownerSignup(dto);
  }

  /**
   * 200, not 201: login creates no resource. The default for POST in Nest is
   * 201, which would be wrong here.
   *
   * The named throttler config lives in AppModule so the limit is set from
   * validated env rather than hardcoded at the decorator.
   */
  @ApiOperation({
    summary: 'Authenticate an Owner',
    description:
      'Unknown email, wrong password, and a deactivated account all return an ' +
      'identical 401 — the difference is not observable, by design. Only Owners ' +
      'log in here; Managers and Members use the passcode flow.',
  })
  @ApiOkResponse({ type: AuthResultDto })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials.' })
  @ApiTooManyRequestsResponse({
    description: '5 attempts per 15 minutes, keyed on email + IP.',
  })
  @Public()
  @UseGuards(LoginThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: OwnerLoginDto): Promise<AuthResult> {
    return this.auth.ownerLogin(dto);
  }
}

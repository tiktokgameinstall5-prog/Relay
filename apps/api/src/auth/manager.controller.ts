/**
 * Manager provisioning and first login.
 *
 * A sibling controller rather than routes on AuthController, which is prefixed
 * `auth/owner` — these are not Owner-scoped URLs. The two routes here sit at
 * opposite ends of the authentication spectrum and are decorated accordingly:
 * provisioning is Owner-only and authenticated, first-login is @Public() because
 * the caller has no token yet, by definition.
 */
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService, type AuthResult } from './auth.service';
import { CreateManagerDto } from './dto/create-manager.dto';
import { ManagerFirstLoginDto } from './dto/manager-first-login.dto';
import { AuthResultDto, ManagerProvisionedDto } from './dto/api-response.dto';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { CurrentUser as CurrentUserType } from '../db/tenant-context';
import { LoginThrottlerGuard } from './guards/login-throttler.guard';
import { OwnerThrottlerGuard } from './guards/owner-throttler.guard';

@ApiTags('auth')
@Controller('auth')
export class ManagerController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  /**
   * Owner-only. CLAUDE.md §1: a Manager never self-signs up.
   *
   * Throttled at 20/hour keyed on the authenticated Owner — see
   * OwnerThrottlerGuard for why the account, not the IP, is the right bucket.
   *
   * The explicit skip of the other two named throttlers is load-bearing rather
   * than tidiness: a ThrottlerGuard evaluates EVERY throttler registered in
   * AppModule, so without these this route would also be subject to the login
   * limit of 5 per 15 minutes — silently capping provisioning at a quarter of
   * the documented budget.
   */
  @ApiOperation({
    summary: 'Provision a Manager and email them an invite passcode',
    description:
      'Owner only. Creates the Manager account with no password and a ' +
      'single-use passcode, then emails the invite. The passcode is **never** ' +
      'returned in this response — in development the console mail driver ' +
      'prints it to the API log. If `inviteEmailSent` is false the account was ' +
      'still created and the passcode can be regenerated.',
  })
  @ApiBearerAuth()
  @ApiCreatedResponse({ type: ManagerProvisionedDto })
  @ApiForbiddenResponse({ description: 'Caller is not an Owner.' })
  @ApiConflictResponse({
    description: 'That email already has an account in this organization.',
  })
  @ApiTooManyRequestsResponse({ description: '20 per hour per Owner.' })
  @Roles('owner')
  @SkipThrottle({ login: true, signup: true })
  @UseGuards(OwnerThrottlerGuard)
  @Post('managers')
  createManager(
    @CurrentUser() actor: CurrentUserType,
    @Body() dto: CreateManagerDto,
  ) {
    return this.auth.createManager(actor, dto);
  }

  /**
   * 200, not 201: this creates no resource, it activates an existing one.
   *
   * @Public() because the caller has no token yet — that is the entire point of
   * the passcode. LoginThrottlerGuard keys on email + IP and reads req.body.email,
   * which this route carries, so it needs no change to cover this path.
   *
   * Skips the other named throttlers for the same reason as above.
   */
  @ApiOperation({
    summary: 'Consume an invite passcode and set a permanent password',
    description:
      'One atomic step: the passcode is consumed and the password set in a ' +
      'single transaction, so an account can never be left with the passcode ' +
      'spent and no password. The passcode is single-use — replaying it ' +
      'returns the same 401 as a wrong one. After this, sign in at ' +
      '`POST /api/auth/login`.',
  })
  @ApiOkResponse({ type: AuthResultDto })
  @ApiUnauthorizedResponse({
    description:
      'Unknown email, wrong passcode, expired passcode, an already-used ' +
      'passcode, and a non-Manager account are one identical response.',
  })
  @ApiTooManyRequestsResponse({
    description: '5 attempts per 15 minutes, keyed on email + IP.',
  })
  @Public()
  @SkipThrottle({ signup: true, provisioning: true })
  @UseGuards(LoginThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  @Post('manager/first-login')
  managerFirstLogin(@Body() dto: ManagerFirstLoginDto): Promise<AuthResult> {
    return this.auth.managerFirstLogin(dto);
  }
}

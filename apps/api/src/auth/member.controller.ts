/**
 * Member provisioning and role-neutral first login.
 *
 * Member provisioning mirrors ManagerController.createManager: Owner or Manager
 * creates the account with no password and a single-use passcode, and the invite
 * is emailed. The difference is the team — a member lands on their manager's
 * active team (CLAUDE.md §1).
 *
 * `first-login` is the canonical activation endpoint for BOTH managers and
 * members. It lives here rather than on ManagerController because member
 * activation is why the service path was generalised, and it is @Public() and
 * role-neutral: the caller has no token yet, and the invite link carries no
 * role. ManagerController still exposes `manager/first-login` as a delegating
 * alias for the existing web client; both call AuthService.firstLogin.
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
  ApiBadRequestResponse,
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
import { CreateMemberDto } from './dto/create-member.dto';
import { FirstLoginDto } from './dto/first-login.dto';
import { AuthResultDto, MemberProvisionedDto } from './dto/api-response.dto';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { CurrentUser as CurrentUserType } from '../db/tenant-context';
import { LoginThrottlerGuard } from './guards/login-throttler.guard';
import { OwnerThrottlerGuard } from './guards/owner-throttler.guard';

@ApiTags('auth')
@Controller('auth')
export class MemberController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  /**
   * Owner or Manager. A Manager adds members to their own team (managerId is
   * ignored); an Owner names the managerId whose team the member joins. Refused
   * with 409 if that manager has no active team yet — a member cannot exist
   * unteamed.
   *
   * Same throttling story as team creation and manager provisioning: keyed on
   * the user via OwnerThrottlerGuard, with the other named throttlers skipped so
   * the login/signup limits do not silently cap provisioning.
   */
  @ApiOperation({
    summary: 'Provision a Member and email them an invite passcode',
    description:
      'Owner or Manager. Creates the Member account with no password and a ' +
      'single-use passcode on the target manager\'s active team, then emails ' +
      'the invite. The passcode is **never** returned — in development the ' +
      'console mail driver prints it to the API log. If `inviteEmailSent` is ' +
      'false the account was still created and the passcode can be regenerated.',
  })
  @ApiBearerAuth()
  @ApiCreatedResponse({ type: MemberProvisionedDto })
  @ApiBadRequestResponse({
    description:
      'A Manager named another manager, an Owner omitted managerId, or the ' +
      'managerId does not name an active manager in this organization.',
  })
  @ApiForbiddenResponse({ description: 'Caller is neither an Owner nor a Manager.' })
  @ApiConflictResponse({
    description:
      'That email already has an account in this organization, or the target ' +
      'manager has no active team yet.',
  })
  @ApiTooManyRequestsResponse({ description: '20 per hour per user.' })
  @Roles('owner', 'manager')
  @SkipThrottle({ login: true, signup: true })
  @UseGuards(OwnerThrottlerGuard)
  @Post('members')
  createMember(@CurrentUser() actor: CurrentUserType, @Body() dto: CreateMemberDto) {
    return this.auth.createMember(actor, dto);
  }

  /**
   * 200, not 201: this activates an existing account, it creates nothing.
   *
   * @Public() because the caller has no token yet — that is the whole point of
   * the passcode. Role-neutral: a manager or a member activates through the same
   * route. LoginThrottlerGuard keys on email + IP from req.body.email, which this
   * route carries. Skips the other named throttlers for the same reason as the
   * provisioning routes.
   */
  @ApiOperation({
    summary: 'Consume an invite passcode and set a permanent password',
    description:
      'For managers and members alike. One atomic step: the passcode is ' +
      'consumed and the password set in a single transaction, so an account can ' +
      'never be left with the passcode spent and no password. The passcode is ' +
      'single-use — replaying it returns the same 401 as a wrong one. After ' +
      'this, sign in at `POST /api/auth/login`.',
  })
  @ApiOkResponse({ type: AuthResultDto })
  @ApiUnauthorizedResponse({
    description:
      'Unknown email, wrong passcode, expired passcode, an already-used ' +
      'passcode, and a non-invited account are one identical response.',
  })
  @ApiTooManyRequestsResponse({
    description: '5 attempts per 15 minutes, keyed on email + IP.',
  })
  @Public()
  @SkipThrottle({ signup: true, provisioning: true })
  @UseGuards(LoginThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  @Post('first-login')
  firstLogin(@Body() dto: FirstLoginDto): Promise<AuthResult> {
    return this.auth.firstLogin(dto);
  }
}

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
  Get,
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
import { DirectoryService, type ManagerListRow } from './directory.service';
import { CreateManagerDto } from './dto/create-manager.dto';
import { FirstLoginDto } from './dto/first-login.dto';
import { AuthResultDto, ManagerListRowDto, ManagerProvisionedDto } from './dto/api-response.dto';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { CurrentUser as CurrentUserType } from '../db/tenant-context';
import { LoginThrottlerGuard } from './guards/login-throttler.guard';
import { OwnerThrottlerGuard } from './guards/owner-throttler.guard';

@ApiTags('auth')
@Controller('auth')
export class ManagerController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(DirectoryService) private readonly directory: DirectoryService,
  ) {}

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
   * List every manager in the organization. Owner-only: a Manager's own RLS
   * slice would reduce this to just themselves — a misleading one-row list they
   * already hold from /api/me — so @Roles('owner') refuses them a clean 403
   * rather than returning that. A READ block (me.controller 25-37): no throttler
   * guard, no @SkipThrottle. The passcode is never in the response — only the
   * `pendingInvite` boolean, which is why the service selects no hash column.
   */
  @ApiOperation({
    summary: 'List all managers in the organization (Owner only)',
    description:
      'Owner only. Every manager in the org, each with their active team (or ' +
      'null) and a pendingInvite flag for accounts not yet activated. A Manager ' +
      'or Member is refused — this is an org-wide view no non-owner may hold.',
  })
  @ApiBearerAuth()
  @ApiOkResponse({ type: ManagerListRowDto, isArray: true })
  @ApiForbiddenResponse({ description: 'Caller is not an Owner.' })
  @ApiUnauthorizedResponse({ description: 'Missing, expired, or invalid token.' })
  @Roles('owner')
  @Get('managers')
  listManagers(): Promise<ManagerListRow[]> {
    return this.directory.listManagers();
  }

  /**
   * 200, not 201: this creates no resource, it activates an existing one.
   *
   * DEPRECATED ALIAS. The canonical activation route is the role-neutral
   * `POST /api/auth/first-login` on MemberController — managers and members
   * activate identically. This path is kept so the existing web client keeps
   * working; it delegates to the exact same service method. Prefer the canonical
   * route for new callers.
   *
   * @Public() because the caller has no token yet — that is the entire point of
   * the passcode. LoginThrottlerGuard keys on email + IP and reads req.body.email,
   * which this route carries, so it needs no change to cover this path.
   *
   * Skips the other named throttlers for the same reason as above.
   */
  @ApiOperation({
    summary: 'Consume an invite passcode and set a permanent password (alias)',
    description:
      'Deprecated alias of `POST /api/auth/first-login`, kept for the existing ' +
      'web client. One atomic step: the passcode is consumed and the password ' +
      'set in a single transaction, so an account can never be left with the ' +
      'passcode spent and no password. The passcode is single-use — replaying ' +
      'it returns the same 401 as a wrong one. After this, sign in at ' +
      '`POST /api/auth/login`.',
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
  @Post('manager/first-login')
  managerFirstLogin(@Body() dto: FirstLoginDto): Promise<AuthResult> {
    return this.auth.firstLogin(dto);
  }
}

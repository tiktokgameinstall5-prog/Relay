/**
 * Team creation.
 *
 * A sibling of ManagerController rather than routes on AuthController (which is
 * prefixed `auth/owner`): a team is not an Owner-scoped URL. CLAUDE.md §1 — a
 * Manager creates their own team, and an Owner may create teams and assign a
 * manager — so this is @Roles('owner','manager'), and the service decides which
 * manager the team belongs to from the caller.
 */
import { Body, Controller, Get, Inject, Post, UseGuards } from '@nestjs/common';
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
import { AuthService } from './auth.service';
import { DirectoryService, type TeamListRow } from './directory.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { TeamCreatedDto, TeamListRowDto } from './dto/api-response.dto';
import { Roles } from './decorators/roles.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { CurrentUser as CurrentUserType } from '../db/tenant-context';
import { OwnerThrottlerGuard } from './guards/owner-throttler.guard';

@ApiTags('auth')
@Controller('auth')
export class TeamController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(DirectoryService) private readonly directory: DirectoryService,
  ) {}

  /**
   * Owner or Manager. A Manager's team is always their own — they may omit
   * managerId and may not name another manager's id. An Owner must name the
   * managerId, since an Owner has no team of their own.
   *
   * Throttled through OwnerThrottlerGuard, which keys on the authenticated
   * user's id (not the IP) and counts against the shared `provisioning` bucket.
   * The @SkipThrottle of the other two named throttlers is load-bearing, not
   * tidiness: a ThrottlerGuard evaluates EVERY registered throttler, so without
   * these this route would also be capped at the login limit.
   */
  @ApiOperation({
    summary: 'Create a team for a manager',
    description:
      'Owner or Manager. A Manager creates their own team (managerId is ' +
      'ignored). An Owner must pass the managerId of the manager who will own ' +
      'it. One active team per manager — a second returns 409.',
  })
  @ApiBearerAuth()
  @ApiCreatedResponse({ type: TeamCreatedDto })
  @ApiBadRequestResponse({
    description:
      'A Manager named another manager, an Owner omitted managerId, or the ' +
      'managerId does not name an active manager in this organization.',
  })
  @ApiForbiddenResponse({ description: 'Caller is neither an Owner nor a Manager.' })
  @ApiConflictResponse({ description: 'That manager already has an active team.' })
  @ApiTooManyRequestsResponse({ description: '20 per hour per user.' })
  @Roles('owner', 'manager')
  @SkipThrottle({ login: true, signup: true })
  @UseGuards(OwnerThrottlerGuard)
  @Post('teams')
  createTeam(@CurrentUser() actor: CurrentUserType, @Body() dto: CreateTeamDto) {
    return this.auth.createTeam(actor, dto);
  }

  /**
   * List teams the caller may see. Owner → every active team in the org;
   * Manager → their own team only. There is no role branch: RLS narrows the
   * single query, exactly as GET /api/me relies on the ambient context.
   *
   * This is a READ, so it copies me.controller.ts (25-37), NOT the POST above:
   * no OwnerThrottlerGuard and no @SkipThrottle. Those cap the write route at
   * 20/hour per user; wearing them here would ration dashboard refreshes to the
   * provisioning budget. No @CurrentUser either — the tenant context is ambient
   * and drives the scoping; the handler needs no id of its own.
   */
  @ApiOperation({
    summary: "List teams in the caller's tenant slice",
    description:
      'Owner sees every active team in the organization; a Manager sees only ' +
      'their own. Each row carries the owning manager and the active-member ' +
      'count (the manager is not counted as a member). RLS scopes the result, so ' +
      'the query is identical for both roles.',
  })
  @ApiBearerAuth()
  @ApiOkResponse({ type: TeamListRowDto, isArray: true })
  @ApiForbiddenResponse({ description: 'Caller is neither an Owner nor a Manager.' })
  @ApiUnauthorizedResponse({ description: 'Missing, expired, or invalid token.' })
  @Roles('owner', 'manager')
  @Get('teams')
  listTeams(): Promise<TeamListRow[]> {
    return this.directory.listTeams();
  }
}

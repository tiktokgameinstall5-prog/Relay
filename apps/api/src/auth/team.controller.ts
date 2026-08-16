/**
 * Team creation.
 *
 * A sibling of ManagerController rather than routes on AuthController (which is
 * prefixed `auth/owner`): a team is not an Owner-scoped URL. CLAUDE.md §1 — a
 * Manager creates their own team, and an Owner may create teams and assign a
 * manager — so this is @Roles('owner','manager'), and the service decides which
 * manager the team belongs to from the caller.
 */
import { Body, Controller, Inject, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { TeamCreatedDto } from './dto/api-response.dto';
import { Roles } from './decorators/roles.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { CurrentUser as CurrentUserType } from '../db/tenant-context';
import { OwnerThrottlerGuard } from './guards/owner-throttler.guard';

@ApiTags('auth')
@Controller('auth')
export class TeamController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

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
}

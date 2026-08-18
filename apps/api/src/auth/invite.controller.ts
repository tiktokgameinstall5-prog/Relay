/**
 * Invite re-issue.
 *
 * A sibling of ManagerController / MemberController rather than a route on either,
 * because it belongs to neither role: the same route regenerates the passcode for
 * a pending Manager OR a pending Member (CLAUDE.md §1 — passcodes are "regenerable
 * by the issuer"). Hosting it on ManagerController or MemberController would
 * misname a role-neutral action; TeamController set the precedent that a small,
 * single-purpose controller is preferable to overloading a role-named one.
 *
 * ISOLATION IS TWO SERVER-SIDE LAYERS, NEITHER OF WHICH IS THE UI
 *
 *   1. @OwnedResource({ table: 'user', param: 'id' }) makes ResourceOwnerGuard
 *      404 a target outside the caller's tenant slice before the handler runs —
 *      an Owner's slice is the whole org, a Manager's is themselves + their team.
 *      A cross-tenant id is byte-identical to a nonexistent one.
 *   2. The guard is a READ contract and explicitly NOT sufficient to authorize a
 *      write (see resource-owner.guard.ts). The real authorization is the UPDATE's
 *      WHERE clause in AuthService.regeneratePasscode, which also confines this to
 *      a live, unactivated invite (password_hash IS NULL, passcode_used_at IS NULL)
 *      so it can never reset an already-activated account's credential.
 *
 * @Roles('owner','manager') keeps Members out before the guard runs at all — which
 * matters here, because the guard deliberately lets a Member address a teammate
 * (for the leaderboard/relay chain), so role-gating, not the guard, is what stops
 * a Member from re-issuing anyone's invite.
 */
import {
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { PasscodeRegeneratedDto } from './dto/api-response.dto';
import { Roles } from './decorators/roles.decorator';
import { OwnedResource } from './decorators/owned-resource.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { CurrentUser as CurrentUserType } from '../db/tenant-context';
import { OwnerThrottlerGuard } from './guards/owner-throttler.guard';

@ApiTags('auth')
@Controller('auth')
export class InviteController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  /**
   * 200, not 201: this re-issues the passcode on an existing account, creating no
   * new resource. Like the provisioning routes, the fresh passcode is emailed and
   * **never** returned — the response carries only the new expiry and whether the
   * mail went out.
   *
   * Throttled through OwnerThrottlerGuard against the shared `provisioning` bucket:
   * this sends an email, so it is abuse-sensitive, and keying on the authenticated
   * issuer caps one account's re-issues without letting them exhaust anyone else's.
   * The @SkipThrottle of the other two named throttlers is load-bearing, not
   * tidiness — a ThrottlerGuard evaluates EVERY registered throttler, so without
   * the skips this route would also be capped at the login limit of 5/15min.
   *
   * A target that is not a pending invite — active-with-password, an Owner,
   * inactive, nonexistent, or in another tenant — all collapse to the same 404, so
   * the caller cannot probe another account's activation state.
   */
  @ApiOperation({
    summary: "Regenerate a pending invite's passcode and re-send the email",
    description:
      'Owner or Manager. Re-issues the single-use passcode for an account that ' +
      'has been provisioned but not yet activated (a Manager or a Member), and ' +
      're-sends the invite email. The passcode is **never** returned — in ' +
      'development the console mail driver prints it to the API log. Any target ' +
      'that is not a live, unactivated invite in the caller\'s tenant returns an ' +
      'identical 404.',
  })
  @ApiBearerAuth()
  @ApiParam({ name: 'id', format: 'uuid', description: 'The invited user to re-issue.' })
  @ApiOkResponse({ type: PasscodeRegeneratedDto })
  @ApiForbiddenResponse({ description: 'Caller is neither an Owner nor a Manager.' })
  @ApiNotFoundResponse({
    description:
      'No live, unactivated invite with that id in the caller\'s tenant. Also ' +
      'returned for an already-activated account, an Owner, an inactive user, a ' +
      'cross-tenant id, and a malformed id — deliberately indistinguishable.',
  })
  @ApiTooManyRequestsResponse({ description: '20 per hour per user.' })
  @Roles('owner', 'manager')
  @OwnedResource({ table: 'user', param: 'id' })
  @SkipThrottle({ login: true, signup: true })
  @UseGuards(OwnerThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  @Post('users/:id/passcode')
  regeneratePasscode(
    @CurrentUser() actor: CurrentUserType,
    @Param('id') id: string,
  ) {
    return this.auth.regeneratePasscode(actor, id);
  }
}

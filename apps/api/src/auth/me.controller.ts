import { Controller, Get, Inject } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from './decorators/current-user.decorator';
import type { CurrentUser as CurrentUserType } from '../db/tenant-context';
import { MeService, type MeResponse } from './me.service';
import { MeResponseDto } from './dto/api-response.dto';

@ApiTags('me')
@ApiBearerAuth('bearer')
@Controller('me')
export class MeController {
  constructor(@Inject(MeService) private readonly me: MeService) {}

  /**
   * The current user's own profile. No @Public() — the global JwtAuthGuard
   * protects it, which is also what makes this the natural smoke test for the
   * whole auth chain: token → strategy → row re-read → tenant-scoped query.
   */
  @ApiOperation({
    summary: "The authenticated caller's own profile",
    description:
      'Read through the tenant context, so it exercises the full chain: token → ' +
      'strategy → row re-read → RLS-scoped query. Never returns password or ' +
      'passcode hashes — the response is a whitelist, not a redaction.',
  })
  @ApiOkResponse({ type: MeResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing, expired, or invalid token.' })
  @Get()
  get(@CurrentUser() user: CurrentUserType): Promise<MeResponse> {
    return this.me.getProfile(user);
  }
}

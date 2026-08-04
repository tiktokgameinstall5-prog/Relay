import { Controller, Get, Inject } from '@nestjs/common';
import { CurrentUser } from './decorators/current-user.decorator';
import type { CurrentUser as CurrentUserType } from '../db/tenant-context';
import { MeService, type MeResponse } from './me.service';

@Controller('me')
export class MeController {
  constructor(@Inject(MeService) private readonly me: MeService) {}

  /**
   * The current user's own profile. No @Public() — the global JwtAuthGuard
   * protects it, which is also what makes this the natural smoke test for the
   * whole auth chain: token → strategy → row re-read → tenant-scoped query.
   */
  @Get()
  get(@CurrentUser() user: CurrentUserType): Promise<MeResponse> {
    return this.me.getProfile(user);
  }
}

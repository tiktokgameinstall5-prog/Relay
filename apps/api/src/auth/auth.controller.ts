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
import { AuthService, type AuthResult } from './auth.service';
import { OwnerSignupDto } from './dto/signup.dto';
import { OwnerLoginDto } from './dto/login.dto';
import { Public } from './decorators/public.decorator';
import { LoginThrottlerGuard } from './guards/login-throttler.guard';

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
  @Public()
  @UseGuards(LoginThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: OwnerLoginDto): Promise<AuthResult> {
    return this.auth.ownerLogin(dto);
  }
}

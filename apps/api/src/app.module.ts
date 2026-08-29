import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { appConfig, appEnv } from './config/configuration';
import { DbModule } from './db/db.module';
import { AuthModule } from './auth/auth.module';
import { WorkflowModule } from './workflow/workflow.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { ResourceOwnerGuard } from './auth/guards/resource-owner.guard';
import { TenantContextInterceptor } from './auth/interceptors/tenant-context.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      // apps/api/.env. Loaded by tsx/node --env-file in scripts too; harmless
      // either way, and needed when the app is started by nest directly.
      envFilePath: '.env',
      // Our own validateEnv() runs inside appConfig and throws on anything
      // missing, so there is no need to also let ConfigModule cache-miss to
      // process.env silently.
      cache: true,
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const env = appEnv(config);
        return {
          throttlers: [
            // The named 'login' throttler used by LoginThrottlerGuard:
            // LOGIN_THROTTLE_LIMIT attempts per LOGIN_THROTTLE_TTL_SECONDS,
            // 5 / 15 min by default.
            {
              name: 'login',
              limit: env.LOGIN_THROTTLE_LIMIT,
              ttl: env.LOGIN_THROTTLE_TTL_SECONDS * 1000,
            },
            // The named 'signup' throttler used by SignupThrottlerGuard:
            // SIGNUP_THROTTLE_LIMIT signups per SIGNUP_THROTTLE_TTL_SECONDS per
            // IP, 10 / hour by default. Env-driven so the e2e suite can lift it
            // (test/helpers/test-env.ts) without a real production limit having
            // to be unrealistically high.
            {
              name: 'signup',
              limit: env.SIGNUP_THROTTLE_LIMIT,
              ttl: env.SIGNUP_THROTTLE_TTL_SECONDS * 1000,
            },
            // Manager provisioning: 20/hour keyed on the authenticated Owner
            // rather than IP. Provisioning is a deliberate human act; 20/hour
            // is far above real use and well below what makes a compromised
            // Owner token useful for mass account creation.
            { name: 'provisioning', limit: 20, ttl: 3_600_000 },
          ],
        };
      },
    }),
    DbModule,
    AuthModule,
    WorkflowModule,
  ],
  providers: [
    // Global guards run in registration order, so this sequence is load-bearing:
    // authenticate, then narrow by role, then check the specific addressed row.
    // Reordering would let an unauthenticated caller reach a DB query in
    // ResourceOwnerGuard, or turn a 401 into a 403.
    //
    // Global, so routes are authenticated by default and must opt out with
    // @Public(). Fail-closed, matching the RLS posture: a route added without
    // any auth decision is protected, not exposed.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ResourceOwnerGuard },
    // Runs after every guard — Nest's order is guards, then interceptors, and
    // that is not configurable. So the scope this establishes is available to
    // handlers and services but NOT to guards; ResourceOwnerGuard therefore
    // calls withTenant() with an explicit context rather than db.tx().
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule {}

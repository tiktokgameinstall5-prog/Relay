import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { appConfig, appEnv } from './config/configuration';
import { DbModule } from './db/db.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
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
            // Named config for the signup route's @Throttle({ signup: ... }).
            { name: 'signup', limit: 10, ttl: 3_600_000 },
          ],
        };
      },
    }),
    DbModule,
    AuthModule,
  ],
  providers: [
    // Global, so routes are authenticated by default and must opt out with
    // @Public(). Fail-closed, matching the RLS posture: a route added without
    // any auth decision is protected, not exposed.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Runs after every guard — Nest's order is guards, then interceptors, and
    // that is not configurable. So the scope this establishes is available to
    // handlers and services but NOT to guards; a guard needing a tenant-scoped
    // query must call withTenant() with an explicit context.
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule {}

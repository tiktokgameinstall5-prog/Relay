import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import type { SignOptions } from 'jsonwebtoken';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { appEnv } from '../config/configuration';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      // Async so the secret comes from validated config rather than a bare
      // process.env read at import time, which would run before validation.
      useFactory: (config: ConfigService) => {
        const env = appEnv(config);
        return {
          secret: env.JWT_ACCESS_SECRET,
          // Cast: jsonwebtoken types expiresIn as a `StringValue` template
          // literal union ("15m" | "7d" | …), which a value read from the
          // environment cannot satisfy statically. env.validation.ts is where
          // the format is actually checked.
          signOptions: { expiresIn: env.JWT_ACCESS_TTL as SignOptions['expiresIn'] },
        };
      },
    }),
  ],
  controllers: [AuthController, MeController],
  providers: [AuthService, MeService, JwtStrategy],
  // AuthService is exported because JwtStrategy needs lookupById, and later
  // modules (manager/member provisioning, task #6-7) will need the same lookups.
  exports: [AuthService],
})
export class AuthModule {}

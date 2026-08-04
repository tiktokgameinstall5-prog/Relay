import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { appEnv } from './config/configuration';

async function bootstrap() {
  // Typed as the Express application so `set('trust proxy', …)` below is
  // available — it is an Express method, not part of INestApplication.
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      // Strip properties with no decorator on the DTO. Without this, a client
      // can post extra fields — `role: "owner"`, `ranking: 100` — and any
      // handler that later spreads the body would persist them.
      whitelist: true,
      // And reject rather than silently strip, so a client sending an
      // unexpected field learns about it instead of assuming it took effect.
      forbidNonWhitelisted: true,
      // Runs the @Transform hooks (email normalisation) and gives handlers real
      // DTO instances rather than plain objects.
      transform: true,
    }),
  );

  // Needed for the throttler's per-IP keying to see the client address rather
  // than the proxy's, once this runs behind one. Express only honours
  // X-Forwarded-For when explicitly trusted.
  app.set('trust proxy', 1);

  const env = appEnv(app.get(ConfigService));
  await app.listen(env.PORT);
  new Logger('Bootstrap').log(`API listening on http://localhost:${env.PORT}/api`);
}

bootstrap();

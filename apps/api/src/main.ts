import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { appEnv } from './config/configuration';
import { API_DOCS_PATH, setupSwagger } from './docs/swagger';

export async function createNestApp(expressInstance?: express.Express): Promise<NestExpressApplication> {
  const app = expressInstance
    ? await NestFactory.create<NestExpressApplication>(AppModule, new ExpressAdapter(expressInstance))
    : await NestFactory.create<NestExpressApplication>(AppModule);

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.set('trust proxy', 1);

  const env = appEnv(app.get(ConfigService));
  const logger = new Logger('Bootstrap');

  if (env.API_DOCS_ENABLED) {
    setupSwagger(app);
    if (env.NODE_ENV === 'production') {
      logger.warn(
        `API_DOCS_ENABLED is true in production: /api/${API_DOCS_PATH} is publicly ` +
          `readable and enumerates every endpoint. Unset it unless this is deliberate.`,
      );
    }
  }

  return app;
}

let cachedServer: any = null;

export async function getVercelHandler(): Promise<any> {
  if (!cachedServer) {
    const app = await createNestApp();
    await app.init();
    cachedServer = app.getHttpAdapter().getInstance();
  }
  return cachedServer;
}

export default async function handler(req: any, res: any) {
  const server = await getVercelHandler();
  if (res.writableEnded) return;
  return new Promise<void>((resolve, reject) => {
    res.on('finish', resolve);
    res.on('close', resolve);
    server(req, res, (err: any) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// Standalone execution when started via node / tsx (not in serverless environment)
if (!process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  async function bootstrap() {
    const app = await createNestApp();
    const env = appEnv(app.get(ConfigService));
    const logger = new Logger('Bootstrap');
    await app.listen(env.PORT, '0.0.0.0');
    logger.log(`API listening on http://127.0.0.1:${env.PORT}/api`);
    if (env.API_DOCS_ENABLED) {
      logger.log(`API docs at http://localhost:${env.PORT}/api/${API_DOCS_PATH}`);
    }
  }

  bootstrap();
}


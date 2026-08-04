/**
 * Interactive API documentation at /api/docs.
 *
 * A stand-in for the real UI until Phase 2 builds it: it lets the Owner signup /
 * login / me chain be exercised from a browser without curl or a REST client.
 *
 * TWO THINGS WORTH KNOWING BEFORE THIS GOES ANYWHERE NEAR PRODUCTION
 *
 *   1. The page is UNAUTHENTICATED. SwaggerModule mounts Express middleware
 *      directly on the HTTP adapter, so the globally-registered JwtAuthGuard
 *      never runs for it — @Public() is not involved and cannot be. Anyone who
 *      can reach the port can read it.
 *   2. It enumerates every route, every DTO field, and every validation rule.
 *      That is the point in development and it is reconnaissance in production.
 *
 * Hence the API_DOCS_ENABLED gate, which defaults to off when NODE_ENV is
 * production. This function is simply not called when the flag is false, so the
 * route does not exist rather than existing and refusing.
 *
 * The "Authorize" button stores a bearer token in browser memory only — it is
 * not persisted, so a shared machine does not leak a session through this page.
 */
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Mounted under the global 'api' prefix, so the browser path is /api/docs. */
export const API_DOCS_PATH = 'docs';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Relay API')
    .setDescription(
      [
        'Team workspace and task-relay platform.',
        '',
        '**How to use this page**',
        '',
        '1. `POST /api/auth/owner/signup` — creates an organization and its Owner,',
        '   and returns an `accessToken`. This is the only self-service signup in',
        '   the product; Managers and Members are provisioned by invite (§1).',
        '2. Copy the `accessToken` from the response.',
        '3. Click **Authorize** (top right), paste the token, and confirm.',
        '4. `GET /api/me` now works — it returns the caller\'s own row, read',
        '   through the tenant context that every RLS policy checks.',
        '',
        '`POST /api/auth/owner/login` is rate-limited to 5 attempts per 15 minutes,',
        'keyed on email + IP. Repeated failed attempts here will return 429.',
      ].join('\n'),
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'The accessToken returned by signup or login.',
      },
      // Name referenced by @ApiBearerAuth() on protected controllers.
      'bearer',
    )
    .addTag('auth', 'Owner signup and login')
    .addTag('me', 'The authenticated caller')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup(API_DOCS_PATH, app, document, {
    // Without this the page mounts at /docs, outside the global 'api' prefix —
    // Swagger does not inherit it by default. Requires setGlobalPrefix() to have
    // already run, which it has: main.ts calls it before setupSwagger().
    useGlobalPrefix: true,
    customSiteTitle: 'Relay API — docs',
    swaggerOptions: {
      // Keep the token for the page session only. persistAuthorization: true
      // would write it to localStorage, where it outlives the tab and survives
      // for anyone next at the machine.
      persistAuthorization: false,
      displayRequestDuration: true,
      docExpansion: 'list',
    },
  });
}

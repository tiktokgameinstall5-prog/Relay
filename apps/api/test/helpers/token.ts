/**
 * Mint an access token for a seeded fixture user.
 *
 * Needed because managers and members have no login route until task #6, and
 * /auth/owner/login rejects them by design. This is NOT a shortcut around auth:
 * JwtStrategy.validate() re-reads the row and derives role/orgId/managerId from
 * it (jwt.strategy.ts:49-59), so the only claim that actually matters here is
 * `sub`. The rest are included solely to match the shape auth.service.ts signs.
 *
 * Test-only. Nothing under src/ imports this.
 */
import { sign } from 'jsonwebtoken';
import type { SeededUser } from './seed';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. Copy .env.example to apps/api/.env.`);
  return v;
}

export function accessTokenFor(user: SeededUser): string {
  return sign(
    {
      sub: user.id,
      role: user.role,
      orgId: user.orgId,
      managerId: user.managerId,
    },
    requireEnv('JWT_ACCESS_SECRET'),
    { expiresIn: '15m' },
  );
}

/** `Authorization` header value, for supertest's .set(). */
export function bearer(user: SeededUser): string {
  return `Bearer ${accessTokenFor(user)}`;
}

/**
 * Rate limiting for Owner-initiated provisioning, keyed on the Owner's user id.
 *
 * WHY NOT IP, AND WHY NOT EMAIL+IP
 *
 * LoginThrottlerGuard keys on email + IP because login is unauthenticated — there
 * is no account yet, only a claim about one. Provisioning is different: the
 * caller is already authenticated, so the budget can belong to the *account*
 * taking the action. That is strictly better here:
 *
 *   * One Owner cannot exhaust another Owner's budget, however they are NATed.
 *   * Rotating source IPs does not multiply a single Owner's budget, which is
 *     exactly the evasion an IP-only key invites.
 *   * A compromised Owner token is capped at 20 accounts/hour regardless of how
 *     the attacker distributes the requests.
 *
 * The id comes from request.user, which JwtStrategy.validate() builds from a
 * fresh read of the user row — not from token claims — so it cannot be forged
 * into someone else's bucket.
 */
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import type { CurrentUser } from '../../db/tenant-context';

@Injectable()
export class OwnerThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Request): Promise<string> {
    const user = req.user as CurrentUser | undefined;

    // Unreachable on a guarded route: JwtAuthGuard runs first and would have
    // thrown 401. Falling back to IP rather than a shared constant key means
    // that if the guard order ever regresses, the failure mode is a per-IP
    // limit — not one global bucket every caller can exhaust for everyone.
    if (!user?.userId) {
      return `provisioning:ip:${req.ip ?? 'unknown-ip'}`;
    }

    return `provisioning:user:${user.userId}`;
  }
}

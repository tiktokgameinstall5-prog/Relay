/**
 * Signup rate limiting, keyed on source IP.
 *
 * WHY IP, AND WHY NOT EMAIL+IP LIKE LOGIN
 *
 * Signup is unauthenticated and creates a brand-new organization + Owner, so the
 * two keys the other guards use are both unavailable or wrong here:
 *
 *   * There is no account yet to attribute a budget to, the way
 *     OwnerThrottlerGuard keys provisioning on the authenticated Owner.
 *   * The email in the body names an org that does not exist yet, so combining it
 *     with the IP the way LoginThrottlerGuard does buys nothing — worse, it would
 *     let one source rotate through fresh emails for an effectively unlimited
 *     budget. Keying on IP alone is what actually caps "one source spraying org
 *     creations", which is the abuse this bounds.
 *
 * IP-only carries the usual NAT weakness (users behind one address share a
 * budget), but signup is a rare per-user event, so a generous hourly limit
 * absorbs it — and the failure mode is a shared cap, never a bypass.
 *
 * WHY A DEDICATED GUARD RATHER THAN A GLOBAL ThrottlerGuard + @Throttle
 *
 * @Throttle metadata only takes effect where a ThrottlerGuard actually runs, and
 * none is registered globally (that would rate-limit every route, including the
 * authenticated ones that carry their own keyed guards). Attaching this guard to
 * exactly the signup route is what turns the named 'signup' throttler — whose
 * limit/ttl come from validated env in AppModule — into a real limit. The route
 * pairs it with @SkipThrottle({ login: true, provisioning: true }) because a
 * ThrottlerGuard evaluates EVERY registered throttler, and without the skips
 * signup would also be measured against those unrelated buckets.
 */
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

@Injectable()
export class SignupThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Request): Promise<string> {
    return `signup:ip:${req.ip ?? 'unknown-ip'}`;
  }
}

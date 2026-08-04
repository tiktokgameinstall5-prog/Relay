/**
 * Login rate limiting, keyed on email + IP.
 *
 * Why not the default IP-only tracker: it fails in both directions. One attacker
 * rotating source addresses gets an unlimited budget against a single account,
 * while many legitimate users behind one NAT or corporate proxy share a budget
 * and lock each other out. Combining both means an attacker must hold the same
 * IP to burn one account's budget, and unrelated users on a shared address do
 * not collide.
 *
 * The email is normalised before hashing so that varying the casing cannot
 * multiply the budget, and only the hash is stored — the throttler's store would
 * otherwise accumulate plaintext addresses of everyone who ever tried to log in.
 */
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Request): Promise<string> {
    const ip = req.ip ?? 'unknown-ip';
    const rawEmail = (req.body as { email?: unknown } | undefined)?.email;

    // No email in the body (malformed request): fall back to IP-only rather
    // than lumping every such request under one shared key, which would let one
    // bad client exhaust the budget for everyone.
    if (typeof rawEmail !== 'string' || rawEmail.length === 0) {
      return `login:ip:${ip}`;
    }

    const emailKey = createHash('sha256')
      .update(rawEmail.trim().toLowerCase())
      .digest('hex')
      .slice(0, 32);

    return `login:${ip}:${emailKey}`;
  }
}

/**
 * Ambient tenant scope for the current request.
 *
 * TenantContextInterceptor puts the caller's context here at the start of every
 * authenticated request; DbService.tx() reads it back. The point is that a
 * service can get a tenant-scoped connection without being handed a CurrentUser,
 * so scoping stops being something each new method has to remember to thread
 * through — CLAUDE.md §1 requires server-side scoping on every query, and the
 * cheapest way to guarantee that is to make the unscoped path unavailable.
 *
 * Deliberately a module-level singleton rather than a Nest provider. An
 * AsyncLocalStorage only works if writer and reader share one instance, and a
 * provider could be instantiated per-module if the graph ever changed. This is
 * one of the few places where module state is the correct answer.
 *
 * Note this carries the CONTEXT, not a database connection. Holding a PoolClient
 * for the life of a request would pin one of the pool's ten connections across
 * every non-DB pause in a handler — bcrypt on login, the mailer, S3 uploads in
 * Phase 3. Transactions stay as short as the queries they contain.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { TenantContext } from './tenant-context';

const storage = new AsyncLocalStorage<TenantContext>();

/**
 * Run `fn` with `ctx` as the ambient tenant scope.
 *
 * Callers must ensure any async work they care about is *started* inside `fn`.
 * AsyncLocalStorage propagates into async continuations created within the
 * callback, not into ones created before it — which is exactly the trap
 * TenantContextInterceptor documents around Observable subscription.
 */
export function runInTenantScope<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** The ambient context, or undefined outside a request (or on a @Public route). */
export function currentTenantScope(): TenantContext | undefined {
  return storage.getStore();
}

/**
 * The ambient context, or throw.
 *
 * A plain Error, not an HttpException, and that is intentional: reaching this
 * means code attempted a tenant-scoped query with no request scope, which is a
 * programming error. It should surface as a 500 with a stack trace rather than
 * as a 403 that someone reads as an ordinary permission denial and stops
 * investigating.
 */
export function requireTenantScope(): TenantContext {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error(
      'No tenant scope. DbService.tx() was called outside an authenticated ' +
        'request — on a @Public() route, in a background job, or before the ' +
        'interceptor ran. Use withTenant(ctx, ...) with an explicit context there.',
    );
  }
  return ctx;
}

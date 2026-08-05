/**
 * Establishes the tenant context for every authenticated request.
 *
 * Reads request.user (attached by JwtStrategy.validate()) and establishes an
 * AsyncLocalStorage scope carrying the three values every RLS policy reads.
 * Services can then call db.tx() without threading a CurrentUser through every
 * method — the context is ambient for the request.
 *
 * On a @Public() route there is no request.user, so no scope is established —
 * a handler calling db.tx() there throws rather than querying with no context.
 * That matches the fail-closed posture of CurrentUser (current-user.decorator.ts),
 * and it is what test/tenant-context.e2e-spec.ts verifies.
 *
 * THE SUBSCRIPTION QUESTION
 *
 * next.handle() returns an Observable whose handler body runs on *subscription*,
 * not when handle() is called, so the naive form looks like it should lose the
 * scope before the handler runs:
 *
 *   return runInTenantScope(ctx, () => next.handle());
 *
 * On Nest 11 it does not. InterceptorsConsumer wraps each step in
 * defer(AsyncResource.bind(...)) and calls the terminal handler eagerly inside
 * that bound scope — with an in-source comment saying it is done specifically so
 * "the async context (e.g. AsyncLocalStorage) is correctly inherited"
 * (@nestjs/core/interceptors/interceptors-consumer.js). Calling handle() inside
 * the scope is what captures it, and the naive form does call it there. This was
 * verified by sabotage: swapping in the naive form left all tests green, and
 * removing the scope entirely failed 10 of 14 — so the suite does bite, it just
 * does not distinguish these two forms.
 *
 * The explicit form below is kept anyway, because it is correct without relying
 * on that binding. It is an internal detail of the framework, not part of the
 * NestInterceptor contract, and nothing in our test suite would tell us if it
 * changed.
 *
 * NOTE ON NAMING
 *
 * 0001_rls.sql:9 names this "TenantTransactionInterceptor" and says "set
 * transaction-locally by TenantTransactionInterceptor on each authenticated
 * request". That migration is already applied and must not be edited (migrate.ts
 * throws when an applied migration's checksum changes). The name is now stale:
 * this interceptor no longer opens a request-long transaction, it only sets up
 * AsyncLocalStorage so db.tx() can grab a connection when needed. The rename is
 * recorded in PROGRESS.md rather than the migration.
 */
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { Request } from 'express';
import { runInTenantScope } from '../../db/tenant-scope';
import { type CurrentUser, tenantContextOf } from '../../db/tenant-context';

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as CurrentUser | undefined;

    // @Public() routes have no user. No scope is established, so a handler
    // calling db.tx() there throws rather than querying with no context. Fail
    // closed, exactly as CurrentUser (current-user.decorator.ts:14-19) does.
    if (!user) {
      return next.handle();
    }

    // Subscribe inside the scope. See "the subscription question" in the header:
    // calling next.handle() inside the scope is what actually captures it today,
    // but this form does not depend on that.
    return new Observable((subscriber) =>
      runInTenantScope(tenantContextOf(user), () => next.handle().subscribe(subscriber)),
    );
  }
}

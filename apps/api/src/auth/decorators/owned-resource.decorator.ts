import { SetMetadata } from '@nestjs/common';

/**
 * The ONLY table names ResourceOwnerGuard will ever query, mapped to a
 * pre-quoted identifier.
 *
 * This exists because the guard interpolates a table name into SQL — the single
 * place in this codebase that interpolates a SQL identifier rather than binding
 * a $n parameter, because Postgres has no parameter form for an identifier. The
 * allow-list is what makes that safe: values here are literals written by a
 * developer, never anything derived from a request.
 *
 * `as const` plus the `OwnedTable` type below means @OwnedResource({ table: … })
 * rejects an arbitrary string at COMPILE time. Adding a table is a deliberate
 * edit to this object, which is greppable and reviewable; it is not something a
 * route author can do by passing a different string.
 *
 * "user" needs the double quotes — it is a reserved word in Postgres. The quotes
 * live in the value rather than being added by the guard, so what gets
 * interpolated is exactly what is written here.
 */
export const OWNED_TABLES = {
  team: 'team',
  user: '"user"',
  task: 'task',
  task_step: 'task_step',
} as const;

export type OwnedTable = keyof typeof OWNED_TABLES;

export const OWNED_RESOURCE_KEY = 'ownedResource';

export interface OwnedResourceOptions {
  /** Which table to probe. Compile-checked against OWNED_TABLES. */
  table: OwnedTable;
  /** Route param holding the row id, e.g. 'id' for @Get('teams/:id'). */
  param: string;
}

/**
 * Assert that the row addressed by a route param is inside the caller's tenant
 * slice, before the handler runs.
 *
 *   @Get('teams/:id')
 *   @Roles('owner', 'manager')
 *   @OwnedResource({ table: 'team', param: 'id' })
 *
 * Read the guard's header for what "inside your slice" does and does not mean —
 * in particular that it is a READ contract and is not sufficient to authorize a
 * write.
 */
export const OwnedResource = (options: OwnedResourceOptions) =>
  SetMetadata(OWNED_RESOURCE_KEY, options);

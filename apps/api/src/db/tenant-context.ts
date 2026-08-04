/**
 * The tenant context — the three values every RLS policy reads.
 *
 * This is the single source of truth for "who is asking", and it is deliberately
 * the same shape the isolation tests already use (test/helpers/db.ts:31-36). The
 * tests and the runtime therefore set identical session variables; if a policy
 * would block real code, it blocks the test fixture too.
 */

export type UserRole = 'owner' | 'manager' | 'member';

export interface TenantContext {
  orgId: string;
  role: UserRole;
  /**
   * The manager_id self-reference invariant (CLAUDE.md §1, CHECK
   * user_manager_id_invariant): null for an owner, their own id for a manager,
   * their manager's id for a member. One uniform RLS predicate, no CASE on role.
   */
  managerId: string | null;
}

/**
 * The authenticated caller, as attached to the request by JwtStrategy.validate().
 * A superset of TenantContext — it also carries the user's own id, which the
 * tenant predicate does not need but `/me` and audit writes do.
 */
export interface CurrentUser extends TenantContext {
  userId: string;
}

export function tenantContextOf(user: CurrentUser): TenantContext {
  return { orgId: user.orgId, role: user.role, managerId: user.managerId };
}

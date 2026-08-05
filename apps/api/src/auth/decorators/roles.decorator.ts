import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../../db/tenant-context';

export const ROLES_KEY = 'roles';

/**
 * Restrict a route to the listed roles. Read by RolesGuard.
 *
 *   @Roles('owner')             // Owner only — e.g. manager provisioning (#6)
 *   @Roles('owner', 'manager')  // both, e.g. team creation (#7)
 *
 * A route with no @Roles is reachable by ANY authenticated role. See the guard's
 * header for why that is a deliberate default rather than fail-open.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

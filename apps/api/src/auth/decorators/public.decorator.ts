import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Opt a route out of the globally-registered JwtAuthGuard.
 *
 * The default is authenticated — a new controller added without any thought
 * about auth is protected, not exposed. Making a route public therefore has to
 * be a deliberate, greppable act. Same fail-closed posture as the RLS layer.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

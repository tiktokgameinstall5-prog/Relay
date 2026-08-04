/**
 * Response shapes, for documentation only.
 *
 * These classes exist because Swagger builds its schemas from runtime metadata,
 * and a TypeScript `interface` leaves none — AuthResult and MeResponse would
 * both document as an empty object.
 *
 * Each one `implements` the interface the handler actually returns. That is the
 * whole point: it costs nothing at runtime (no handler constructs these) but it
 * makes the compiler reject documentation that has drifted from the real
 * response. Add a field to MeResponse without adding it here and the build
 * fails, which is the opposite of how API docs usually rot.
 */
import { ApiProperty } from '@nestjs/swagger';
import type { AuthResult } from '../auth.service';
import type { MeResponse } from '../me.service';
import type { UserRole } from '../../db/tenant-context';

const UUID_EXAMPLE = '3f1c8a4e-9b2d-4c7a-8e15-2d6b0f9a1c33';

// `implements` needs a name, not an indexed access — AuthResult['user'] there is
// a TS2500. The alias is only to give that shape one.
type AuthResultUser = AuthResult['user'];

class AuthUserDto implements AuthResultUser {
  @ApiProperty({ format: 'uuid', example: UUID_EXAMPLE })
  id!: string;

  @ApiProperty({ format: 'uuid', example: UUID_EXAMPLE })
  orgId!: string;

  @ApiProperty({ enum: ['owner', 'manager', 'member'], example: 'owner' })
  role!: UserRole;

  @ApiProperty({ example: 'Ada Owner' })
  name!: string;

  @ApiProperty({ format: 'email', example: 'ada@acme.test' })
  email!: string;
}

export class AuthResultDto implements AuthResult {
  @ApiProperty({
    description:
      'Bearer token for the Authorization header. Paste it into "Authorize" ' +
      'at the top of this page to call the protected endpoints.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken!: string;

  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;
}

export class MeResponseDto implements MeResponse {
  @ApiProperty({ format: 'uuid', example: UUID_EXAMPLE })
  id!: string;

  @ApiProperty({ format: 'uuid', example: UUID_EXAMPLE })
  orgId!: string;

  @ApiProperty({ example: 'Acme Industries' })
  organizationName!: string;

  @ApiProperty({ enum: ['owner', 'manager', 'member'], example: 'owner' })
  role!: UserRole;

  @ApiProperty({ example: 'Ada Owner' })
  name!: string;

  @ApiProperty({ format: 'email', example: 'ada@acme.test' })
  email!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'The tenant key. NULL for an Owner, their own id for a Manager, their ' +
      "Manager's id for a Member (CLAUDE.md §1).",
    example: null,
  })
  managerId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, example: null })
  teamId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  roleTitle!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: null })
  workflowStep!: number | null;

  @ApiProperty({ minimum: 0, maximum: 100, example: 50 })
  ranking!: number;

  @ApiProperty({ example: false })
  isReporter!: boolean;
}

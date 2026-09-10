import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const normaliseEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * What the caller supplies to add a Member to a team (CLAUDE.md §1: "Member ...
 * Added by their Manager (or by the Owner on the manager's behalf) — same
 * passcode/invite mechanism, scoped to that manager's team at creation").
 *
 * Like CreateManagerDto: name + email, no password and no `role` — the role is
 * hardcoded to 'member' in the service, so this DTO cannot mint a manager or an
 * owner. `managerId` follows the same fork as CreateTeamDto (Manager omits it,
 * Owner supplies it). `roleTitle` and `workflowStep` are the optional per-member
 * fields §1 mentions ("Manager assigns each member a role/title and, optionally,
 * a workflow step number").
 */
export class CreateMemberDto {
  @ApiProperty({ minLength: 2, maxLength: 120, example: 'Sam Member' })
  @IsString()
  @Transform(trim)
  @Length(2, 120)
  name!: string;

  @ApiProperty({
    format: 'email',
    maxLength: 254,
    example: 'sam@acme.test',
    description:
      'Where the invite is sent. Unique per organization, not globally — the ' +
      'same address may hold an account in a different org.',
  })
  @IsEmail()
  @Transform(normaliseEmail)
  @MaxLength(254) // RFC 5321 maximum
  email!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      "The manager whose team this member joins. An Owner may provide managerId or teamId; " +
      'ignored for a Manager caller (their own id is always used, and passing ' +
      "another manager's id is rejected).",
  })
  @IsOptional()
  @IsUUID()
  managerId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      "The specific team this member joins. An Owner may provide teamId as an alternative to managerId.",
  })
  @IsOptional()
  @IsUUID()
  teamId?: string;

  @ApiPropertyOptional({
    maxLength: 120,
    example: 'Editor',
    description: "The member's role/title on the team (CLAUDE.md §1).",
  })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(1, 120)
  roleTitle?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 9999,
    example: 2,
    description:
      "The member's optional workflow step number, shown on their own " +
      'dashboard (CLAUDE.md §1). This is a per-member label, not the relay ' +
      "chain's step order — that is assigned per task in Phase 2.",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9999)
  workflowStep?: number;
}

import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * What the caller supplies to create a team (CLAUDE.md §1: "Manager creates
 * their own team ... Owner can also create teams and assign a manager to them").
 *
 * `managerId` is the fork between the two callers, and the service — not this
 * DTO — resolves it:
 *   - A Manager may omit it (their own id is used) and may not pass anyone
 *     else's; the RLS WITH CHECK would block a cross-manager insert anyway, but
 *     the service rejects it with a clean 400 before the query runs.
 *   - An Owner MUST pass it — an Owner has no team of their own, so there is no
 *     sensible default, and guessing one would be a footgun.
 * Validated as a UUID here only for shape; whether it names a real manager in
 * the caller's own organization is checked inside the transaction, RLS-scoped.
 */
export class CreateTeamDto {
  @ApiProperty({ minLength: 2, maxLength: 120, example: 'Delivery Squad' })
  @IsString()
  @Transform(trim)
  @Length(2, 120)
  name!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      "The manager who will own this team. Required for an Owner caller; " +
      'ignored for a Manager caller (their own id is always used, and passing ' +
      "another manager's id is rejected).",
  })
  @IsOptional()
  @IsUUID()
  managerId?: string;
}

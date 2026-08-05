import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/** Same helpers as signup.dto.ts — trim, and lowercase the email. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const normaliseEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * What an Owner supplies to provision a Manager. Name and email only — CLAUDE.md
 * §1: "Owner enters name+email, system generates a one-time passcode".
 *
 * Notably absent: any password field, and any `role` field. The role is
 * hardcoded to 'manager' in the service, so this DTO cannot be used to mint an
 * Owner by passing role='owner'.
 */
export class CreateManagerDto {
  @ApiProperty({ minLength: 2, maxLength: 120, example: 'Morgan Manager' })
  @IsString()
  @Transform(trim)
  @Length(2, 120)
  name!: string;

  @ApiProperty({
    format: 'email',
    maxLength: 254,
    example: 'morgan@acme.test',
    description:
      'Where the invite is sent. Unique per organization, not globally — the ' +
      'same address may hold an account in a different org.',
  })
  @IsEmail()
  @Transform(normaliseEmail)
  @MaxLength(254) // RFC 5321 maximum
  email!: string;
}

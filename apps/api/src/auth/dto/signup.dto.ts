import { IsEmail, IsString, Length, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/** Trim, and lowercase where the value is case-insensitive downstream. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const normaliseEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class OwnerSignupDto {
  @ApiProperty({
    minLength: 2,
    maxLength: 120,
    example: 'Acme Industries',
    description: 'The organization this Owner is creating. Created in the same transaction.',
  })
  @IsString()
  @Transform(trim)
  @Length(2, 120)
  organizationName!: string;

  @ApiProperty({ minLength: 2, maxLength: 120, example: 'Ada Owner' })
  @IsString()
  @Transform(trim)
  @Length(2, 120)
  name!: string;

  // The column is citext, so casing never affects uniqueness at the DB level.
  // Normalising here keeps the stored value predictable and means the throttler
  // key for a login attempt cannot be multiplied by varying the casing.
  @ApiProperty({
    format: 'email',
    maxLength: 254,
    example: 'ada@acme.test',
    description:
      'Lowercased and trimmed before storage. Unique per organization, not ' +
      'globally — the same address may own an account in a different org.',
  })
  @IsEmail()
  @Transform(normaliseEmail)
  @MaxLength(254) // RFC 5321 maximum
  email!: string;

  // 12 chars minimum: this is an Owner account with full org visibility, and
  // bcrypt silently truncates input beyond 72 bytes, hence the upper bound.
  @ApiProperty({
    minLength: 12,
    maxLength: 72,
    example: 'CorrectHorse!9xy',
    description:
      'At least 12 characters — this account has full org visibility. Capped at ' +
      '72 bytes because bcrypt silently truncates beyond that.',
  })
  @IsString()
  @MinLength(12)
  @MaxLength(72)
  password!: string;
}

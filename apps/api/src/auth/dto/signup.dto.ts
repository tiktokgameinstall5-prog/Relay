import { IsEmail, IsString, Length, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/** Trim, and lowercase where the value is case-insensitive downstream. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const normaliseEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class OwnerSignupDto {
  @IsString()
  @Transform(trim)
  @Length(2, 120)
  organizationName!: string;

  @IsString()
  @Transform(trim)
  @Length(2, 120)
  name!: string;

  // The column is citext, so casing never affects uniqueness at the DB level.
  // Normalising here keeps the stored value predictable and means the throttler
  // key for a login attempt cannot be multiplied by varying the casing.
  @IsEmail()
  @Transform(normaliseEmail)
  @MaxLength(254) // RFC 5321 maximum
  email!: string;

  // 12 chars minimum: this is an Owner account with full org visibility, and
  // bcrypt silently truncates input beyond 72 bytes, hence the upper bound.
  @IsString()
  @MinLength(12)
  @MaxLength(72)
  password!: string;
}

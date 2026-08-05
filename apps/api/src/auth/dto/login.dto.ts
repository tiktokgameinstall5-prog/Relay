import { IsEmail, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

const normaliseEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * Credentials for POST /api/auth/login.
 *
 * Not Owner-specific: Managers set a password during first login and use this
 * same route afterwards, as will Members from task #7. The role is never part of
 * the request — it is read from the user row server-side.
 */
export class LoginDto {
  @ApiProperty({ format: 'email', maxLength: 254, example: 'ada@acme.test' })
  @IsEmail()
  @Transform(normaliseEmail)
  @MaxLength(254)
  email!: string;

  /**
   * No @MinLength here, deliberately. A length rule on login would reject a
   * short password with a 400 while a wrong-but-long one gets a 401 — telling an
   * attacker something about the policy, and splitting the response space that
   * the login handler works to keep uniform. Length is a signup concern.
   */
  @ApiProperty({ maxLength: 72, example: 'CorrectHorse!9xy' })
  @IsString()
  @MaxLength(72)
  password!: string;
}

import { IsEmail, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

const normaliseEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class OwnerLoginDto {
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
  @IsString()
  @MaxLength(72)
  password!: string;
}

import { IsEmail, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { PASSCODE_ALPHABET } from '../passcode';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const normaliseEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** Built from the generator's alphabet so the two cannot drift apart. */
const PASSCODE_PATTERN = new RegExp(`^[${PASSCODE_ALPHABET}]+$`);

/**
 * Manager first login: consume the passcode and set a permanent password, in
 * one request.
 *
 * WHY THE PASSWORD IS REQUIRED HERE RATHER THAN OPTIONAL
 *
 * CLAUDE.md §1 says passcodes are single-use AND that a Manager "may set a
 * permanent password on first login". If setting one were optional, consuming
 * the passcode would leave the account with no usable credential at all —
 * permanently locked out. Reading "may" as "may choose the password" rather
 * than "may skip it" resolves that, and avoids inventing a second token type
 * that every guard would then have to refuse everywhere else.
 */
export class ManagerFirstLoginDto {
  @ApiProperty({ format: 'email', maxLength: 254, example: 'morgan@acme.test' })
  @IsEmail()
  @Transform(normaliseEmail)
  @MaxLength(254)
  email!: string;

  /**
   * WHY VALIDATING THIS LENGTH IS NOT THE MISTAKE login.dto.ts AVOIDS
   *
   * login.dto.ts deliberately omits @MinLength on `password`: a user-chosen
   * secret's length is itself unknown to an attacker, so answering 400 for a
   * short one and 401 for a wrong one would split the response space and leak
   * whether a guess was even the right shape.
   *
   * A passcode is different. Its length and alphabet are a fixed, public,
   * system-generated format — documented right here in the API docs. Validating
   * the shape reveals nothing an attacker does not already know; it only
   * separates "malformed" from "wrong", which is the same trade already made
   * for malformed UUIDs in ResourceOwnerGuard.
   *
   * 8–10 rather than exactly 10: CLAUDE.md §1 specifies "8–10 char", and
   * accepting the whole range means shortening PASSCODE_LENGTH later does not
   * silently invalidate every passcode already sitting in an inbox.
   */
  @ApiProperty({
    minLength: 8,
    maxLength: 10,
    example: 'K7M2XQ9P4B',
    description:
      'The single-use passcode from the invite email. 8–10 alphanumeric ' +
      'characters, excluding visually ambiguous ones (0/O/o/1/l/I).',
  })
  @IsString()
  @Transform(trim)
  @Length(8, 10)
  @Matches(PASSCODE_PATTERN, {
    message: 'passcode contains characters that are not in the passcode alphabet',
  })
  passcode!: string;

  @ApiProperty({
    minLength: 12,
    maxLength: 72,
    example: 'CorrectHorse!9xy',
    description:
      'The permanent password for this account. At least 12 characters; ' +
      'capped at 72 bytes because bcrypt silently truncates beyond that.',
  })
  @IsString()
  @MinLength(12)
  @MaxLength(72)
  newPassword!: string;
}

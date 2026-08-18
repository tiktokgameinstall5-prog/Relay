import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Body for POST /api/auth/refresh and POST /api/auth/logout.
 *
 * The refresh token travels in the body, not a cookie, because CLAUDE.md §6
 * requires one API shared by the web app and the Flutter client — a Set-Cookie
 * only serves the browser. See AuthResult.refreshToken for the trade this makes.
 *
 * Unlike login.dto.ts's password field, validating this shape leaks nothing: a
 * refresh token is 256 bits of server-generated randomness, not a user secret an
 * attacker is guessing, so there is no response-space oracle to protect. A
 * missing or over-long value is a malformed request and gets a 400; a
 * well-formed but wrong token reaches the handler and gets the uniform 401.
 * MaxLength caps it well above the ~43-char base64url tokens we mint so a garbage
 * megabyte body is rejected before hashing.
 */
export class RefreshTokenDto {
  @ApiProperty({
    maxLength: 512,
    description: 'The opaque refresh token returned by login, signup, or a prior refresh.',
    example: 'yZ3k9Qm2...redacted',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  refreshToken!: string;
}

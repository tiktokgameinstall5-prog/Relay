import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Body for POST /api/auth/session/refresh and POST /api/auth/session/logout.
 *
 * The token may arrive EITHER here in the body OR in the HttpOnly relay_rt cookie
 * (see auth/cookie.ts). CLAUDE.md §6 requires one API shared by the web app and
 * the Flutter client: mobile has no cookie jar and sends the token here; the
 * browser holds the cookie its JS cannot read and sends nothing in the body. So
 * this field is OPTIONAL — the handler falls back to the cookie when it is absent
 * — but still validated when present. See AuthResult.refreshToken for the shape.
 *
 * Unlike login.dto.ts's password field, validating this shape leaks nothing: a
 * refresh token is 256 bits of server-generated randomness, not a user secret an
 * attacker is guessing, so there is no response-space oracle to protect. An
 * over-long value is a malformed request and gets a 400; a well-formed but wrong
 * token reaches the handler and gets the uniform 401. MaxLength caps it well
 * above the ~43-char base64url tokens we mint so a garbage megabyte body is
 * rejected before hashing.
 */
export class RefreshTokenDto {
  @ApiPropertyOptional({
    maxLength: 512,
    description:
      'The opaque refresh token returned by login, signup, or a prior refresh. ' +
      'Optional: browser clients omit it and rely on the HttpOnly relay_rt cookie ' +
      'instead; mobile clients send it here.',
    example: 'yZ3k9Qm2...redacted',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  refreshToken?: string;
}

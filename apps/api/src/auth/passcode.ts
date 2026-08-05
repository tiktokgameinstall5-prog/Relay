/**
 * Passcode generation for Manager and Member provisioning.
 *
 * 10 alphanumeric characters from an unambiguous alphabet (no 0/O/o/1/l/I),
 * cryptographically random, hashed with bcrypt before storage.
 *
 * WHY BCRYPT, NOT SHA-256
 *
 * 10 chars from a ~55-character alphabet is ~57 bits of entropy. Behind a fast
 * hash (SHA-256, SHA-3, BLAKE3) that is offline-brute-forceable from a database
 * dump within hours on commodity hardware. Behind bcrypt at cost 12 it is not.
 *
 * CLAUDE.md §1 specifies only "hashed at rest", so this is the strict reading:
 * a passcode is a credential and gets the same protection as a password.
 */
import { randomInt } from 'node:crypto';

/**
 * Excludes visually ambiguous characters: 0 O o 1 l I.
 *
 * A human retypes this from an email, so ambiguity between zero and the letter O
 * (or one and lowercase L) would cause support load and failed login attempts.
 * ~55 characters.
 */
export const PASSCODE_ALPHABET =
  'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** Top of CLAUDE.md §1's "8–10 char" range. ~57 bits. */
export const PASSCODE_LENGTH = 10;

/**
 * Generate a cryptographically random passcode.
 *
 * Uses `crypto.randomInt` rather than `randomBytes(1) % alphabet.length`
 * because the modulo form biases toward the first `256 % 55` characters —
 * small but real, and why the standard library provides `randomInt`.
 */
export function generatePasscode(): string {
  let result = '';
  for (let i = 0; i < PASSCODE_LENGTH; i++) {
    result += PASSCODE_ALPHABET[randomInt(PASSCODE_ALPHABET.length)];
  }
  return result;
}

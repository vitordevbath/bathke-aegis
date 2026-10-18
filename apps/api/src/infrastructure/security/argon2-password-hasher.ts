import argon2 from 'argon2';
import type { PasswordHasher } from '../../application/ports/password-hasher.js';

/**
 * Argon2id parameters — the RFC 9106 §4 second recommended option
 * (64 MiB memory, 3 passes, 4 lanes). Salt (16 bytes, random) and parameters
 * are embedded in the encoded hash, so they can be raised later without
 * invalidating existing hashes.
 */
export const ARGON2_PARAMS = {
  type: argon2.argon2id,
  memoryCost: 65_536, // KiB
  timeCost: 3,
  parallelism: 4,
} as const;

export class Argon2PasswordHasher implements PasswordHasher {
  hash(plain: string): Promise<string> {
    return argon2.hash(plain, ARGON2_PARAMS);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      // Malformed hash: treat as mismatch, never surface details.
      return false;
    }
  }
}

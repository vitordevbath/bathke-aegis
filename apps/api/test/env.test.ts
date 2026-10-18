import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadDatabaseEnv, loadEnv } from '../src/shared/env.js';

// Assembled at runtime: no secret-looking literal lives in the repository.
const strongSecret = () => randomBytes(48).toString('base64url');
const base = () => ({ DATABASE_URL: 'mysql://test@localhost:3306/test', JWT_SECRET: strongSecret() });

describe('loadEnv', () => {
  it('accepts a strong secret and applies defaults', () => {
    const env = loadEnv(base());
    expect(env.JWT_TTL_SECONDS).toBe(3600);
    expect(env.AUTH_RATE_LIMIT_MAX).toBe(10);
  });

  it('requires JWT_SECRET (no fallback)', () => {
    expect(() => loadEnv({ DATABASE_URL: base().DATABASE_URL })).toThrow(/JWT_SECRET/);
  });

  it.each([
    ['too short', 'Ab1!'.repeat(7)],
    ['the .env.example placeholder', 'change-me-to-a-long-random-value'],
    ['a weak marker', `secret-${strongSecret()}`],
    ['too little variety', 'ab'.repeat(32)],
  ])('rejects a JWT_SECRET that is %s', (_case, secret) => {
    expect(() => loadEnv({ ...base(), JWT_SECRET: secret })).toThrow(/JWT_SECRET/);
  });

  it('reports variable names, never values', () => {
    const secret = 'change-me-to-a-long-random-value';
    try {
      loadEnv({ ...base(), JWT_SECRET: secret });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it('requires DATABASE_URL', () => {
    expect(() => loadEnv({ JWT_SECRET: strongSecret() })).toThrow(/DATABASE_URL/);
    expect(() => loadDatabaseEnv({})).toThrow(/DATABASE_URL/);
  });
});

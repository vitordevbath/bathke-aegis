import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { AuthenticationError } from '@aegis/domain';
import { Argon2PasswordHasher } from '../src/infrastructure/security/argon2-password-hasher.js';
import { JoseTokenService } from '../src/infrastructure/security/jose-token-service.js';

const secret = () => randomBytes(48).toString('base64url');

describe('Argon2PasswordHasher', () => {
  const hasher = new Argon2PasswordHasher();

  it('produces salted Argon2id hashes with the configured parameters', async () => {
    const first = await hasher.hash('Aegis-Strong1');
    const second = await hasher.hash('Aegis-Strong1');
    expect(first).toMatch(/^\$argon2id\$v=19\$m=65536,p=4,t=3\$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain('Aegis-Strong1');
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hasher.hash('Aegis-Strong1');
    expect(await hasher.verify(hash, 'Aegis-Strong1')).toBe(true);
    expect(await hasher.verify(hash, 'Aegis-Strong2')).toBe(false);
  });

  it('treats a malformed hash as a mismatch', async () => {
    expect(await hasher.verify('not-a-hash', 'Aegis-Strong1')).toBe(false);
  });
});

describe('JoseTokenService', () => {
  const userId = '7b0c3f5e-4a59-4c3e-9a51-0f6f2b0e2d11';

  it('issues a token that carries only the subject and standard claims', async () => {
    const service = new JoseTokenService({ secret: secret(), ttlSeconds: 900 });
    const { token, expiresIn } = await service.issue(userId);

    expect(expiresIn).toBe(900);
    expect(decodeProtectedHeader(token)).toEqual({ alg: 'HS256' });
    const claims = decodeJwt(token);
    expect(Object.keys(claims).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'sub', 'typ']);
    expect(claims.sub).toBe(userId);
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(900);
    await expect(service.verify(token)).resolves.toEqual({ userId });
  });

  it('rejects an expired token', async () => {
    const issuedAt = new Date('2026-01-01T00:00:00Z');
    const key = secret();
    const issuer = new JoseTokenService({ secret: key, ttlSeconds: 60, now: () => issuedAt });
    const { token } = await issuer.issue(userId);
    const later = new JoseTokenService({ secret: key, ttlSeconds: 60, now: () => new Date(issuedAt.getTime() + 61_000) });

    await expect(later.verify(token)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('rejects a token signed with another key', async () => {
    const { token } = await new JoseTokenService({ secret: secret(), ttlSeconds: 60 }).issue(userId);
    await expect(new JoseTokenService({ secret: secret(), ttlSeconds: 60 }).verify(token)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it('rejects an unsigned (alg: none) token and tampered payloads', async () => {
    const service = new JoseTokenService({ secret: secret(), ttlSeconds: 60 });
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const claims = { sub: userId, typ: 'access', iss: 'bathke-aegis', aud: 'aegis-web', iat: now, exp: now + 60 };
    const unsigned = `${encode({ alg: 'none' })}.${encode(claims)}.`;

    const { token } = await service.issue(userId);
    const [header, , signature] = token.split('.');
    const tampered = `${header}.${encode({ ...claims, sub: 'someone-else' })}.${signature}`;

    await expect(service.verify(unsigned)).rejects.toBeInstanceOf(AuthenticationError);
    await expect(service.verify(tampered)).rejects.toBeInstanceOf(AuthenticationError);
    await expect(service.verify('garbage')).rejects.toBeInstanceOf(AuthenticationError);
  });
});

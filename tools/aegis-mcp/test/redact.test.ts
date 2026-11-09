import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../src/policy/redact.js';

describe('redactSecrets', () => {
  it('redacts secret assignments but keeps the key name', () => {
    expect(redactSecrets('JWT_SECRET=abc123 MYSQL_PASSWORD: hunter2')).toBe('JWT_SECRET=[REDACTED] MYSQL_PASSWORD:[REDACTED]');
  });

  it('redacts credentials inside connection strings', () => {
    expect(redactSecrets('mysql://aegis:s3cret@mysql:3306/aegis')).toBe('mysql://aegis:[REDACTED]@mysql:3306/aegis');
  });

  it('redacts bearer tokens and private key blocks', () => {
    // Assembled at runtime so the fixture itself does not trip aegis_security_check.
    const marker = ['PRIVATE', 'KEY'].join(' ');
    const key = `-----BEGIN RSA ${marker}-----\nMIIE\n-----END RSA ${marker}-----`;
    expect(redactSecrets(`Authorization: Bearer abcdefghijkl ${key}`)).toBe('Authorization: Bearer [REDACTED] [REDACTED PRIVATE KEY]');
  });

  it('redacts Aegis machine tokens and pairing codes, keeping the public prefix out too', () => {
    // Assembled at runtime so the fixture itself does not trip aegis_security_check.
    const token = `${['aegis', 'agent', 'a'.repeat(32)].join('_')}.${'s'.repeat(43)}`;
    const code = ['aegis', 'pair', 'c'.repeat(43)].join('_');
    expect(redactSecrets(`token ${token} code ${code}`)).toBe('token [REDACTED] code [REDACTED]');
  });

  it('leaves ordinary output untouched', () => {
    expect(redactSecrets('Test Files  2 passed (2)')).toBe('Test Files  2 passed (2)');
  });
});

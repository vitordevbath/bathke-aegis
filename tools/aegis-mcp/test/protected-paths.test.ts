import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PathAccessDeniedError, isProtectedPath, resolveRepoPath } from '../src/policy/protected-paths.js';

describe('isProtectedPath', () => {
  it.each([
    '.env',
    '.env.production',
    '.env.local',
    'apps/api/.env',
    'apps\\api\\.ENV.test',
    'secrets/foo',
    'apps/api/secrets/db.json',
    'credentials/gcp.json',
    'infra/nginx/tls/server.pem',
    'deploy/id.key',
    'certs/client.p12',
    'certs/client.PFX',
  ])('denies %s', (candidate) => {
    expect(isProtectedPath(candidate)).toBe(true);
  });

  it.each(['src/foo', '.env.example', 'apps/api/.env.example', 'docs/SECURITY.md', 'apps/web/src/keyboard.ts', 'environment.md'])(
    'allows %s',
    (candidate) => {
      expect(isProtectedPath(candidate)).toBe(false);
    },
  );
});

describe('resolveRepoPath', () => {
  const root = path.resolve('/repo');

  it('resolves allowlisted paths', () => {
    expect(resolveRepoPath(root, 'docs/ARCHITECTURE.md')).toBe(path.join(root, 'docs', 'ARCHITECTURE.md'));
  });

  it.each(['../outside.txt', 'docs/../../etc/passwd', '.env', 'apps/api/.env.production', 'node_modules/x', 'random-root-file.txt'])(
    'rejects %s',
    (candidate) => {
      expect(() => resolveRepoPath(root, candidate)).toThrow(PathAccessDeniedError);
    },
  );
});

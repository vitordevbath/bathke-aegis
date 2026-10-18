import { describe, expect, it } from 'vitest';
import { RepoReader, findRepoRoot } from '../src/repo.js';
import { evaluateRubric } from '../src/tools/rubric-status.js';

describe('evaluateRubric', () => {
  const results = new Map(evaluateRubric(new RepoReader(findRepoRoot())).map((result) => [result.requirement, result]));

  it.each([
    'User registration',
    'Authentication',
    'JWT',
    'Email validation',
    'CPF validation',
    'Password validation',
    'Password hashing',
    'User ownership',
    'Email immutability',
  ])('reports %s as PASS from implementation and test evidence', (requirement) => {
    expect(results.get(requirement)?.state).toBe('PASS');
  });

  it.each(['Hosts CRUD', 'Detection Rules CRUD', 'Incidents CRUD', 'Investigations CRUD', 'Pagination'])(
    'keeps %s as TODO until it exists',
    (requirement) => {
      expect(results.get(requirement)?.state).toBe('TODO');
    },
  );

  it('degrades to IN_PROGRESS when part of the evidence is missing', () => {
    const partial = Object.create(RepoReader.prototype) as RepoReader;
    const real = new RepoReader(findRepoRoot());
    Object.assign(partial, {
      root: real.root,
      exists: (file: string) => !file.endsWith('security.test.ts') && real.exists(file),
      readText: (file: string) => real.readText(file),
    });
    const jwt = evaluateRubric(partial).find((result) => result.requirement === 'JWT');
    expect(jwt?.state).toBe('IN_PROGRESS');
    expect(jwt?.evidence).toContain('security.test.ts');
  });
});

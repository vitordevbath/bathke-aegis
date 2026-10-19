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
    'Hosts CRUD',
    'Pagination',
    'Detection Rules CRUD',
    'Incidents CRUD',
    'Relationships',
  ])('reports %s as PASS from implementation and test evidence', (requirement) => {
    expect(results.get(requirement)?.state).toBe('PASS');
  });

  it('keeps Investigations CRUD as TODO until it exists', () => {
    expect(results.get('Investigations CRUD')?.state).toBe('TODO');
  });

  it('degrades Incidents CRUD to IN_PROGRESS without its MySQL evidence', () => {
    const partial = Object.create(RepoReader.prototype) as RepoReader;
    const real = new RepoReader(findRepoRoot());
    Object.assign(partial, {
      root: real.root,
      exists: (file: string) => !file.endsWith('incidents.mysql.test.ts') && real.exists(file),
      readText: (file: string) => real.readText(file),
    });
    const incidents = evaluateRubric(partial).find((result) => result.requirement === 'Incidents CRUD');
    expect(incidents?.state).toBe('IN_PROGRESS');
    expect(incidents?.evidence).toContain('incidents.mysql.test.ts');
  });

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

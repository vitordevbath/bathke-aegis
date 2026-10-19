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
    'Investigations CRUD',
    'Relationships',
    'Academic CRUDs (4/4)',
  ])('reports %s as PASS from implementation and test evidence', (requirement) => {
    expect(results.get(requirement)?.state).toBe('PASS');
  });

  it('reports the four academic CRUDs from the individual checks', () => {
    expect(results.get('Academic CRUDs (4/4)')?.evidence).toContain('4/4 CRUDs');
  });

  it('degrades Investigations CRUD and the 4/4 summary to IN_PROGRESS without the investigations web screens', () => {
    const partial = Object.create(RepoReader.prototype) as RepoReader;
    const real = new RepoReader(findRepoRoot());
    Object.assign(partial, {
      root: real.root,
      exists: (file: string) => !file.endsWith('EditInvestigationPage.tsx') && real.exists(file),
      readText: (file: string) => real.readText(file),
    });
    const degraded = new Map(evaluateRubric(partial).map((result) => [result.requirement, result]));
    expect(degraded.get('Investigations CRUD')).toMatchObject({ state: 'IN_PROGRESS', evidence: expect.stringContaining('EditInvestigationPage.tsx') });
    expect(degraded.get('Academic CRUDs (4/4)')).toMatchObject({ state: 'IN_PROGRESS', evidence: '3/4 CRUDs; not yet PASS: Investigations CRUD' });
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

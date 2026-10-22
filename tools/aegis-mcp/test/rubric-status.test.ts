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
    'Docker',
    'Nginx',
    'Network isolation',
    'Frontend componentization',
    'Pages and components organization',
    'Encapsulation',
    'Valid constructors and invariants',
    'Object-oriented domain model',
    'Inheritance',
    'Abstract classes',
    'Polymorphism',
    'Interfaces and type aliases',
    'Avoid explicit any',
    'Layered organization',
    'TypeScript application without injected JavaScript',
    'Docker Compose services and environment',
    'Frontend and backend separation',
    'Persistent MySQL volume',
    'Agent guardrails',
    'Sensitive file read and exposure protection',
    'SOLID / Dependency Inversion',
    'SOLID / Open-Closed',
    'SOLID / Liskov Substitution',
  ])('reports %s as PASS from implementation and test evidence', (requirement) => {
    expect(results.get(requirement)?.state).toBe('PASS');
  });

  it.each([
    'Getters and setters',
    'SOLID / Single Responsibility',
    'Naming conventions',
  ])('keeps %s in progress when automated evidence requires manual review', (requirement) => {
    expect(results.get(requirement)).toMatchObject({ state: 'IN_PROGRESS', evidence: expect.stringContaining('manual design review required') });
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

  it('keeps infrastructure IN_PROGRESS when the infra test is not run by CI', () => {
    const partial = Object.create(RepoReader.prototype) as RepoReader;
    const real = new RepoReader(findRepoRoot());
    Object.assign(partial, {
      root: real.root,
      exists: (file: string) => real.exists(file),
      readText: (file: string) => (file === '.github/workflows/ci.yml' ? real.readText(file).replace('npm run test:infra', 'echo skipped') : real.readText(file)),
    });
    const degraded = new Map(evaluateRubric(partial).map((result) => [result.requirement, result]));
    for (const requirement of ['Docker', 'Nginx', 'Network isolation']) {
      expect(degraded.get(requirement)).toMatchObject({ state: 'IN_PROGRESS', evidence: expect.stringContaining('ci.yml') });
    }
  });

  it('fails isolation when a network stops being internal', () => {
    const partial = Object.create(RepoReader.prototype) as RepoReader;
    const real = new RepoReader(findRepoRoot());
    Object.assign(partial, {
      root: real.root,
      exists: (file: string) => real.exists(file),
      readText: (file: string) => (file === 'compose.yaml' ? real.readText(file).replace(/aegis_data:\s*internal:\s*true/, 'aegis_data: {}') : real.readText(file)),
    });
    expect(evaluateRubric(partial).find((result) => result.requirement === 'Network isolation')?.state).toBe('IN_PROGRESS');
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

  it('does not report inheritance as PASS when the production entity relation is absent', () => {
    const partial = Object.create(RepoReader.prototype) as RepoReader;
    const real = new RepoReader(findRepoRoot());
    Object.assign(partial, {
      root: real.root,
      exists: (file: string) => real.exists(file),
      listFiles: (directory: string, depth?: number) => real.listFiles(directory, depth),
      readText: (file: string) => file === 'apps/api/src/domain/user.ts' ? real.readText(file).replace('extends Entity<string>', '') : real.readText(file),
    });
    expect(evaluateRubric(partial).find((result) => result.requirement === 'Inheritance')?.state).toBe('IN_PROGRESS');
  });

  it('finds explicit any through the TypeScript AST instead of matching prose', () => {
    const partial = Object.create(RepoReader.prototype) as RepoReader;
    const real = new RepoReader(findRepoRoot());
    Object.assign(partial, {
      root: real.root,
      exists: (file: string) => real.exists(file),
      listFiles: (directory: string, depth?: number) => real.listFiles(directory, depth),
      readText: (file: string) => file === 'apps/api/src/domain/host.ts' ? `${real.readText(file)}\nconst explicitAny: any = null;\n` : real.readText(file),
    });
    expect(evaluateRubric(partial).find((result) => result.requirement === 'Avoid explicit any')).toMatchObject({
      state: 'IN_PROGRESS',
      evidence: expect.stringContaining('apps/api/src/domain/host.ts'),
    });
  });

  const withText = (file: string, rewrite: (text: string) => string) => {
    const partial = Object.create(RepoReader.prototype) as RepoReader;
    const real = new RepoReader(findRepoRoot());
    Object.assign(partial, {
      root: real.root,
      exists: (path: string) => real.exists(path),
      readText: (path: string) => (path === file ? rewrite(real.readText(path)) : real.readText(path)),
    });
    return new Map(evaluateRubric(partial).map((result) => [result.requirement, result]));
  };

  it('drops Open-Closed to IN_PROGRESS as soon as the ingestion pipeline branches on an event type', () => {
    const degraded = withText('apps/api/src/application/event-ingestion-service.ts', (text) => `${text}\nif (type === 'SYSTEM_BOOT') {}\n`);
    expect(degraded.get('SOLID / Open-Closed')).toMatchObject({ state: 'IN_PROGRESS', evidence: expect.stringContaining('event-ingestion-service.ts') });
  });

  it('drops Liskov to IN_PROGRESS when the contract suite no longer runs against MySQL', () => {
    const degraded = withText('apps/api/test/contracts/event-repository.contract.test.ts', (text) => text.replace("'Drizzle / MySQL'", "'skipped'"));
    expect(degraded.get('SOLID / Liskov Substitution')?.state).toBe('IN_PROGRESS');
  });
});

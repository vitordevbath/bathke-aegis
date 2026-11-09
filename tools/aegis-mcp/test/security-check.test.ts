import { describe, expect, it } from 'vitest';
import type { RepoReader } from '../src/repo.js';
import { securityCheck } from '../src/tools/security-check.js';

const repoWith = (content: string) =>
  ({
    exists: (file: string) => file === 'README.md',
    listFiles: () => [],
    readText: (file: string) => (file === 'README.md' ? content : ''),
  }) as unknown as RepoReader;

describe('securityCheck: Aegis machine secrets', () => {
  // Assembled at runtime so this fixture does not trip the check it verifies.
  const token = `${['aegis', 'agent', 'a'.repeat(32)].join('_')}.${'s'.repeat(43)}`;
  const code = ['aegis', 'pair', 'c'.repeat(43)].join('_');

  it.each([
    ['machine token', token],
    ['pairing code', code],
  ])('reports a committed %s by location and rule, without the value', (_name, value) => {
    const { findings } = securityCheck(repoWith(`linha\n${value}\n`));
    expect(findings).toEqual([{ file: 'README.md', line: 2, rule: 'aegis-machine-secret' }]);
    expect(JSON.stringify(findings)).not.toContain(value);
  });

  it('ignores the public prefix and format descriptions', () => {
    const { findings } = securityCheck(repoWith('prefixo aegis_agent_1a2b3c4d e formato aegis_pair_<43 caracteres>'));
    expect(findings).toEqual([]);
  });
});

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '../src/repo.js';
import { ARCHITECTURE, architectureInfo } from '../src/tools/architecture-info.js';

/** The architecture the MCP reports is checked against the repository, so it cannot silently go stale again. */
const root = findRepoRoot();
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const component = (name: string) => {
  const found = ARCHITECTURE.find((item) => item.name === name);
  if (!found) throw new Error(`missing component ${name}`);
  return found;
};

describe('aegis_architecture_info matches the repository', () => {
  it('every CURRENT component points at a path that exists', () => {
    for (const item of ARCHITECTURE.filter((entry) => entry.status === 'CURRENT')) {
      expect(readdirSync(path.join(root, item.path)).length, item.name).toBeGreaterThan(0);
    }
  });

  it('lists every table and the exact migration count', () => {
    const tables = [...read('apps/api/src/infrastructure/db/schema.ts').matchAll(/mysqlTable\(\s*'([a-z_]+)'/g)].map((match) => match[1] ?? '');
    const mysql = component('MySQL').summary;
    for (const table of tables) expect(mysql, table).toContain(table);
    const migrations = (JSON.parse(read('apps/api/drizzle/meta/_journal.json')) as { entries: unknown[] }).entries.length;
    expect(mysql).toContain(`${migrations} versioned migrations (0000–${String(migrations - 1).padStart(4, '0')})`);
  });

  it('the Collector is CURRENT only because its crate exists, and eBPF stays PLANNED without one', () => {
    expect(component('Aegis Collector').status).toBe('CURRENT');
    expect(read('native/aegis-collector/Cargo.toml')).toContain('name = "aegis-collector"');
    expect(component('eBPF telemetry').status).toBe('PLANNED');
    expect(readdirSync(path.join(root, 'native/ebpf'))).toEqual(['README.md']);
  });

  it('names machine routes and scopes that exist in the code', () => {
    const api = component('Aegis API').summary;
    expect(read('apps/api/src/presentation/http/routes/heartbeat.route.ts')).toContain("'/workspaces/:workspaceId/hosts/:hostId/heartbeat'");
    expect(read('apps/api/src/presentation/http/routes/agent.route.ts')).toContain("'/agent/pair'");
    expect(api).toContain('POST /agent/pair');
    expect(api).toContain('heartbeat');
    const scopes = read('packages/domain/src/machine-identity.ts');
    for (const scope of ['events:ingest', 'host:heartbeat']) {
      expect(scopes).toContain(`'${scope}'`);
      expect(component('Domain package').summary).toContain(scope);
    }
  });

  it('never presents planned capabilities as current', () => {
    const current = ARCHITECTURE.filter((entry) => entry.status === 'CURRENT')
      .map((entry) => entry.summary)
      .join(' ');
    expect(current).not.toMatch(/\buses eBPF\b|Detection Engine runs|alerts are generated/i);
    expect(architectureInfo()).toContain('PLANNED\n- eBPF telemetry');
  });
});

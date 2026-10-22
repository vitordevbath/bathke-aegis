import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { validateEvent, type NormalizedEventV1 } from '@aegis/domain';
import type { Repositories } from '../../src/application/ports/repositories.js';
import { Host } from '../../src/domain/host.js';
import { TelemetryEvent } from '../../src/domain/telemetry-event.js';
import { Workspace } from '../../src/domain/workspace.js';

/** What each adapter must provide to run the shared contract. */
export interface EventRepositoryHarness {
  readonly repositories: Repositories;
}

const T0 = Date.parse('2026-05-01T10:00:00.000Z');

function normalized(sourceEventId: string, minute: number, type: 'PROCESS_STARTED' | 'SYSTEM_BOOT' = 'PROCESS_STARTED'): NormalizedEventV1 {
  const occurredAt = new Date(T0 + minute * 60_000).toISOString();
  const body =
    type === 'SYSTEM_BOOT'
      ? { category: 'SYSTEM', type, data: { system: { eventType: 'BOOT' } } }
      : { category: 'PROCESS', type, data: { process: { pid: 100 + minute, name: 'bash', executable: '/usr/bin/bash' } } };
  const result = validateEvent({ schemaVersion: 1, sourceEventId, occurredAt, ...body });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.event;
}

/**
 * The behavioral contract of `EventRepository`, run unchanged against every
 * implementation (in-memory and Drizzle/MySQL). Passing it is what makes the
 * implementations substitutable for the ingestion service and the queries.
 */
export function describeEventRepositoryContract(name: string, setup: () => Promise<EventRepositoryHarness>, enabled = true): void {
  describe.skipIf(!enabled)(`EventRepository contract — ${name}`, () => {
    let repositories: Repositories;

    const tenant = async () => {
      const now = new Date();
      const workspace = Workspace.restore({ id: randomUUID(), name: 'Workspace de contrato', kind: 'personal', createdAt: now, updatedAt: now });
      await repositories.workspaces.insert(workspace);
      const host = async (displayName: string) => {
        const created = Host.register({ workspaceId: workspace.id, displayName });
        await repositories.hosts.insert(created);
        return created;
      };
      return { workspaceId: workspace.id, host };
    };

    beforeAll(async () => {
      ({ repositories } = await setup());
    });

    it('stores a batch and reads each event back with its host name, only inside its workspace', async () => {
      const a = await tenant();
      const b = await tenant();
      const host = await a.host('servidor-web-01');
      const event = TelemetryEvent.receive({ workspaceId: a.workspaceId, hostId: host.id }, normalized(randomUUID(), 1), new Date(T0 + 120_000));
      await repositories.events.insertMany([event]);

      const stored = await repositories.events.findInWorkspace(a.workspaceId, event.id);
      expect(stored?.hostDisplayName).toBe('servidor-web-01');
      expect(stored?.event.toSnapshot()).toEqual(event.toSnapshot());
      expect(await repositories.events.findInWorkspace(b.workspaceId, event.id)).toBeNull();
      expect(await repositories.events.findInWorkspace(a.workspaceId, randomUUID())).toBeNull();
    });

    it('treats an empty batch as a no-op', async () => {
      await expect(repositories.events.insertMany([])).resolves.toBeUndefined();
    });

    it('reports fingerprints by source id for one host only; the same source id may exist on other hosts', async () => {
      const t = await tenant();
      const [h1, h2] = [await t.host('host-1'), await t.host('host-2')];
      const sourceId = randomUUID();
      const first = TelemetryEvent.receive({ workspaceId: t.workspaceId, hostId: h1.id }, normalized(sourceId, 1));
      const second = TelemetryEvent.receive({ workspaceId: t.workspaceId, hostId: h2.id }, normalized(sourceId, 2));
      await repositories.events.insertMany([first, second]);

      expect(await repositories.events.fingerprintsBySourceId(h1.id, [sourceId, randomUUID()])).toEqual(new Map([[sourceId, first.fingerprint]]));
      expect(await repositories.events.fingerprintsBySourceId(h2.id, [sourceId])).toEqual(new Map([[sourceId, second.fingerprint]]));
      expect(await repositories.events.fingerprintsBySourceId(h1.id, [])).toEqual(new Map());
    });

    it('refuses a second event with the same (host, sourceEventId) and stores nothing from that batch', async () => {
      const t = await tenant();
      const host = await t.host('host-unico');
      const sourceId = randomUUID();
      const origin = { workspaceId: t.workspaceId, hostId: host.id };
      await repositories.events.insertMany([TelemetryEvent.receive(origin, normalized(sourceId, 1))]);

      const fresh = TelemetryEvent.receive(origin, normalized(randomUUID(), 2));
      await expect(repositories.events.insertMany([fresh, TelemetryEvent.receive(origin, normalized(sourceId, 3))])).rejects.toThrow();
      expect(await repositories.events.findInWorkspace(t.workspaceId, fresh.id)).toBeNull();
      expect((await repositories.events.listInWorkspace(t.workspaceId, { page: 1, pageSize: 10 })).total).toBe(1);
    });

    it('refuses events for a host that does not exist', async () => {
      const t = await tenant();
      await expect(repositories.events.insertMany([TelemetryEvent.receive({ workspaceId: t.workspaceId, hostId: randomUUID() }, normalized(randomUUID(), 1))])).rejects.toThrow();
    });

    it('lists the timeline newest first (occurredAt, then id), paginated and filtered', async () => {
      const t = await tenant();
      const [web, db] = [await t.host('web'), await t.host('db')];
      const items = Array.from({ length: 25 }, (_, i) =>
        TelemetryEvent.receive({ workspaceId: t.workspaceId, hostId: i % 5 === 0 ? db.id : web.id }, normalized(randomUUID(), Math.floor(i / 2), i % 3 === 0 ? 'SYSTEM_BOOT' : 'PROCESS_STARTED')),
      );
      await repositories.events.insertMany(items);

      const pages = await Promise.all([1, 2, 3].map((page) => repositories.events.listInWorkspace(t.workspaceId, { page, pageSize: 10 })));
      expect(pages.map((page) => page.items.length)).toEqual([10, 10, 5]);
      expect(pages[0]?.total).toBe(25);
      const listed = pages.flatMap((page) => page.items.map((item) => item.event.toSnapshot()));
      const expected = items
        .map((item) => item.toSnapshot())
        .sort((x, y) => y.occurredAt.getTime() - x.occurredAt.getTime() || (x.id < y.id ? 1 : -1))
        .map((item) => item.id);
      expect(listed.map((item) => item.id)).toEqual(expected);

      const snapshots = items.map((item) => item.toSnapshot());
      const count = (predicate: (event: (typeof snapshots)[number]) => boolean) => snapshots.filter(predicate).length;
      const total = async (filter: object) => (await repositories.events.listInWorkspace(t.workspaceId, { page: 1, pageSize: 100, ...filter })).total;
      const [from, to] = [new Date(T0 + 2 * 60_000), new Date(T0 + 4 * 60_000)];
      expect(await total({ hostId: db.id })).toBe(count((event) => event.hostId === db.id));
      expect(await total({ category: 'SYSTEM' })).toBe(count((event) => event.category === 'SYSTEM'));
      expect(await total({ eventType: 'PROCESS_STARTED' })).toBe(count((event) => event.type === 'PROCESS_STARTED'));
      expect(await total({ hostId: web.id, category: 'SYSTEM' })).toBe(count((event) => event.hostId === web.id && event.category === 'SYSTEM'));
      // Inclusive bounds on occurredAt.
      expect(await total({ from, to })).toBe(count((event) => event.occurredAt >= from && event.occurredAt <= to));
      expect(await total({ from: to, to })).toBe(count((event) => event.occurredAt.getTime() === to.getTime()));
      expect(await total({ from: new Date(T0 + 60 * 60_000) })).toBe(0);
    });

    it('answers whether a host has events', async () => {
      const t = await tenant();
      const [used, unused] = [await t.host('used'), await t.host('unused')];
      await repositories.events.insertMany([TelemetryEvent.receive({ workspaceId: t.workspaceId, hostId: used.id }, normalized(randomUUID(), 1))]);
      expect(await repositories.events.existsForHost(used.id)).toBe(true);
      expect(await repositories.events.existsForHost(unused.id)).toBe(false);
    });
  });
}

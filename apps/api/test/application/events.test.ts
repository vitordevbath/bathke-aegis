import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { EventIdConflictError, MachineScopeError, NotFoundError, ValidationError } from '@aegis/domain';
import type { PasswordHasher } from '../../src/application/ports/password-hasher.js';
import type { Repositories, UnitOfWork } from '../../src/application/ports/repositories.js';
import { EventIngestionService } from '../../src/application/event-ingestion-service.js';
import { RegisterUser } from '../../src/application/use-cases/register-user.js';
import { WorkspaceAccess } from '../../src/application/workspace-access.js';
import { CreateHost } from '../../src/application/use-cases/hosts/create-host.js';
import { IngestEventsAsMachine } from '../../src/application/use-cases/events/ingest-events.js';
import { MachineAuthContext } from '../../src/application/machine-auth-context.js';
import { ListEvents } from '../../src/application/use-cases/events/list-events.js';
import { GetEvent } from '../../src/application/use-cases/events/get-event.js';
import { Membership } from '../../src/domain/membership.js';
import { createInMemoryPersistence } from '../support/in-memory-persistence.js';
import { makeRegistration } from '../support/fixtures.js';
import { bearer, buildTestApp, pairHost, signedInUser } from '../support/test-app.js';

const plainHasher: PasswordHasher = { hash: async (plain) => `hashed:${plain}`, verify: async (hash, plain) => hash === `hashed:${plain}` };
const NOW = new Date('2026-05-01T12:00:00.000Z');

const boot = (sourceEventId = randomUUID(), occurredAt = '2026-05-01T11:00:00Z') => ({
  schemaVersion: 1,
  sourceEventId,
  occurredAt,
  category: 'SYSTEM',
  type: 'SYSTEM_BOOT',
  data: { system: { eventType: 'BOOT' } },
});

describe('EventIngestionService (transport-independent core)', () => {
  let persistence: ReturnType<typeof createInMemoryPersistence>;
  let access: WorkspaceAccess;

  const tenant = async () => {
    const account = await new RegisterUser(persistence.repositories, persistence.unitOfWork, plainHasher).execute(makeRegistration());
    const workspaceId = account.workspaces[0]?.workspace.id ?? '';
    const host = await new CreateHost(access, persistence.repositories.hosts).execute(account.user, workspaceId, { displayName: 'servidor' });
    return { user: account.user, workspaceId, hostId: host.id };
  };

  beforeEach(() => {
    persistence = createInMemoryPersistence();
    access = new WorkspaceAccess(persistence.repositories.memberships);
  });

  it('ingests for an origin given by the caller, with no user, token or HTTP involved', async () => {
    const t = await tenant();
    const service = new EventIngestionService(persistence.unitOfWork, () => NOW);
    expect(await service.ingest({ workspaceId: t.workspaceId, hostId: t.hostId }, [boot()])).toEqual({ received: 1, inserted: 1, deduplicated: 0 });
    const [stored] = [...persistence.store.events.values()];
    expect(stored).toMatchObject({ workspaceId: t.workspaceId, hostId: t.hostId, ingestedAt: NOW });
  });

  it('uses its clock for the future-skew check and the ingestion time', async () => {
    const t = await tenant();
    const service = new EventIngestionService(persistence.unitOfWork, () => NOW);
    const origin = { workspaceId: t.workspaceId, hostId: t.hostId };
    await expect(service.ingest(origin, [boot(randomUUID(), '2026-05-01T12:06:00Z')])).rejects.toBeInstanceOf(ValidationError);
    await expect(service.ingest(origin, [boot(randomUUID(), '2026-05-01T12:04:00Z')])).resolves.toMatchObject({ inserted: 1 });
  });

  it('404 for a host outside the given workspace, before touching storage', async () => {
    const a = await tenant();
    const b = await tenant();
    const service = new EventIngestionService(persistence.unitOfWork, () => NOW);
    await expect(service.ingest({ workspaceId: a.workspaceId, hostId: b.hostId }, [boot()])).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.ingest({ workspaceId: a.workspaceId, hostId: randomUUID() }, [boot()])).rejects.toBeInstanceOf(NotFoundError);
    expect(persistence.store.events.size).toBe(0);
  });

  it('rolls back the whole batch when the insert fails mid-transaction', async () => {
    const t = await tenant();
    const failing: UnitOfWork = {
      run: (work) =>
        persistence.unitOfWork.run((repositories) => {
          const events = new Proxy(repositories.events, {
            get: (target, property, receiver) =>
              property === 'insertMany'
                ? async (items: Parameters<typeof target.insertMany>[0]) => {
                    await target.insertMany(items);
                    throw new Error('simulated failure after insert');
                  }
                : Reflect.get(target, property, receiver),
          });
          const sabotaged: Repositories = { ...repositories, events };
          return work(sabotaged);
        }),
    };
    await expect(new EventIngestionService(failing, () => NOW).ingest({ workspaceId: t.workspaceId, hostId: t.hostId }, [boot(), boot()])).rejects.toThrow(
      'simulated failure after insert',
    );
    expect(persistence.store.events.size).toBe(0);
  });

  it('reports a conflicting reuse with the index of the offending event and stores nothing from the batch', async () => {
    const t = await tenant();
    const service = new EventIngestionService(persistence.unitOfWork, () => NOW);
    const origin = { workspaceId: t.workspaceId, hostId: t.hostId };
    const reused = randomUUID();
    await service.ingest(origin, [boot(reused)]);
    const error = await service.ingest(origin, [boot(), boot(), boot(reused, '2026-05-01T11:30:00Z')]).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EventIdConflictError);
    expect((error as EventIdConflictError).field).toBe('events.2.sourceEventId');
    expect(persistence.store.events.size).toBe(1);
  });

  it('machine adapter: only the identified host, only with the scope; members may read, outsiders get 404', async () => {
    const owner = await tenant();
    const viewer = await tenant();
    const outsider = await tenant();
    persistence.store.memberships.set(
      `${viewer.user.id}:${owner.workspaceId}`,
      Membership.restore({ userId: viewer.user.id, workspaceId: owner.workspaceId, role: 'VIEWER', createdAt: new Date() }).toSnapshot(),
    );
    const ingest = new IngestEventsAsMachine(new EventIngestionService(persistence.unitOfWork));
    const machine = new MachineAuthContext(randomUUID(), owner.workspaceId, owner.hostId, ['events:ingest']);
    await ingest.execute(machine, owner.workspaceId, owner.hostId, [boot(randomUUID(), new Date(Date.now() - 60_000).toISOString())]);
    const [stored] = [...persistence.store.events.values()];

    await expect(ingest.execute(new MachineAuthContext(randomUUID(), owner.workspaceId, owner.hostId, []), owner.workspaceId, owner.hostId, [boot()])).rejects.toBeInstanceOf(MachineScopeError);
    await expect(ingest.execute(machine, outsider.workspaceId, outsider.hostId, [boot()])).rejects.toBeInstanceOf(NotFoundError);
    await expect(ingest.execute(machine, owner.workspaceId, viewer.hostId, [boot()])).rejects.toBeInstanceOf(NotFoundError);
    await expect(new ListEvents(access, persistence.repositories.events).execute(viewer.user, owner.workspaceId, { page: 1, pageSize: 10 })).resolves.toMatchObject({ total: 1 });
    await expect(new GetEvent(access, persistence.repositories.events).execute(viewer.user, owner.workspaceId, stored?.id ?? '')).resolves.toMatchObject({
      hostDisplayName: 'servidor',
    });
    await expect(new GetEvent(access, persistence.repositories.events).execute(outsider.user, outsider.workspaceId, stored?.id ?? '')).rejects.toBeInstanceOf(NotFoundError);
    expect(persistence.store.events.size).toBe(1);
  });
});

describe('ingestion rate limit', () => {
  it('has its own per-IP budget, separate from the login limit (429 once exceeded)', async () => {
    const { app } = await buildTestApp({ ingestRateLimitMax: 2 });
    try {
      const { token, session } = await signedInUser(app);
      const base = `/workspaces/${session.workspaces[0]?.id}`;
      const host = (await app.inject({ method: 'POST', url: `${base}/hosts`, headers: bearer(token), payload: { displayName: 'servidor' } })).json<{ id: string }>();
      const machine = bearer((await pairHost(app, token, session.workspaces[0]?.id ?? '', host.id)).token);
      const send = () =>
        app.inject({ method: 'POST', url: `${base}/hosts/${host.id}/events/ingest`, headers: machine, payload: { events: [boot(randomUUID(), new Date(Date.now() - 60_000).toISOString())] } });
      expect([(await send()).statusCode, (await send()).statusCode, (await send()).statusCode]).toEqual([200, 200, 429]);
      // Reads are not limited by the ingestion budget.
      expect((await app.inject({ method: 'GET', url: `${base}/events`, headers: bearer(token) })).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});

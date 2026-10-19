import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, ForbiddenError, InvalidStateError, InvestigationConclusionRequiredError, NotFoundError, ValidationError } from '@aegis/domain';
import type { PasswordHasher } from '../../src/application/ports/password-hasher.js';
import type { Repositories, UnitOfWork } from '../../src/application/ports/repositories.js';
import { RegisterUser } from '../../src/application/use-cases/register-user.js';
import { WorkspaceAccess } from '../../src/application/workspace-access.js';
import { CreateHost } from '../../src/application/use-cases/hosts/create-host.js';
import { CreateIncident } from '../../src/application/use-cases/incidents/create-incident.js';
import { DeleteIncident } from '../../src/application/use-cases/incidents/delete-incident.js';
import { CreateInvestigation } from '../../src/application/use-cases/investigations/create-investigation.js';
import { GetInvestigation } from '../../src/application/use-cases/investigations/get-investigation.js';
import { ListInvestigations } from '../../src/application/use-cases/investigations/list-investigations.js';
import { UpdateInvestigation } from '../../src/application/use-cases/investigations/update-investigation.js';
import { DeleteInvestigation } from '../../src/application/use-cases/investigations/delete-investigation.js';
import type { InvestigationDetails } from '../../src/domain/investigation.js';
import { Membership } from '../../src/domain/membership.js';
import { createInMemoryPersistence } from '../support/in-memory-persistence.js';
import { makeRegistration } from '../support/fixtures.js';

const plainHasher: PasswordHasher = { hash: async (plain) => `hashed:${plain}`, verify: async (hash, plain) => hash === `hashed:${plain}` };
const UNKNOWN_INCIDENTS = [{ field: 'incidentIds', message: 'Um ou mais incidentes não existem neste workspace.' }];
const CONCLUSION = 'Falso positivo: atualização legítima do servidor.';

const issuesOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ValidationError);
  return (error as ValidationError).issues;
};

describe('investigation use cases', () => {
  let persistence: ReturnType<typeof createInMemoryPersistence>;
  let access: WorkspaceAccess;

  const tenant = async () => {
    const account = await new RegisterUser(persistence.repositories, persistence.unitOfWork, plainHasher).execute(makeRegistration());
    const user = account.user;
    const workspaceId = account.workspaces[0]?.workspace.id ?? '';
    return {
      user,
      workspaceId,
      incident: async (title: string) => {
        const host = await new CreateHost(access, persistence.repositories.hosts).execute(user, workspaceId, { displayName: `host-${title}` });
        const view = await new CreateIncident(access, persistence.unitOfWork).execute(user, workspaceId, {
          title,
          severity: 'HIGH',
          hostIds: [host.id],
          detectionRuleIds: [],
        });
        return view.incident;
      },
    };
  };

  const details = (overrides: Partial<InvestigationDetails>): InvestigationDetails => ({
    title: 'Atividade incomum nos servidores web',
    incidentIds: [],
    ...overrides,
  });

  const create = (unitOfWork: UnitOfWork = persistence.unitOfWork) => new CreateInvestigation(access, unitOfWork);
  const update = () => new UpdateInvestigation(access, persistence.unitOfWork);
  const deleteIncident = () => new DeleteIncident(access, persistence.repositories.incidents, persistence.repositories.investigations);

  beforeEach(() => {
    persistence = createInMemoryPersistence();
    access = new WorkspaceAccess(persistence.repositories.memberships);
  });

  it('opens an OPEN investigation with incidents resolved from its workspace', async () => {
    const a = await tenant();
    const [web1, web2] = [await a.incident('Shell no web-01'), await a.incident('Shell no web-02')];
    const view = await create().execute(a.user, a.workspaceId, details({ incidentIds: [web1.id, web2.id] }));

    expect(view.incidents.map((incident) => incident.title).sort()).toEqual(['Shell no web-01', 'Shell no web-02']);
    expect(persistence.store.investigations.get(view.investigation.id)).toMatchObject({
      status: 'OPEN',
      conclusion: null,
      closedAt: null,
      incidentIds: [web1.id, web2.id],
    });
  });

  it('refuses foreign or missing incidents with the same message, persisting nothing', async () => {
    const a = await tenant();
    const b = await tenant();
    const [incidentA, incidentB] = [await a.incident('Incidente A'), await b.incident('Incidente B')];

    expect(await issuesOf(create().execute(a.user, a.workspaceId, details({ incidentIds: [incidentA.id, incidentB.id] })))).toEqual(UNKNOWN_INCIDENTS);
    const missing = '00000000-0000-4000-8000-000000000000';
    expect(await issuesOf(create().execute(a.user, a.workspaceId, details({ incidentIds: [missing] })))).toEqual(UNKNOWN_INCIDENTS);
    expect(persistence.store.investigations.size).toBe(0);
  });

  it('rolls back the investigation row when writing the relations fails mid-transaction', async () => {
    const a = await tenant();
    const incident = await a.incident('Caso');
    const failing: UnitOfWork = {
      run: (work) =>
        persistence.unitOfWork.run((repositories) => {
          // The investigation row is written, then the relation write "fails".
          const investigations = new Proxy(repositories.investigations, {
            get: (target, property, receiver) =>
              property === 'insert'
                ? async (investigation: Parameters<typeof target.insert>[0]) => {
                    await target.insert(investigation);
                    throw new Error('simulated relation failure');
                  }
                : Reflect.get(target, property, receiver),
          });
          const sabotaged: Repositories = { ...repositories, investigations };
          return work(sabotaged);
        }),
    };
    await expect(create(failing).execute(a.user, a.workspaceId, details({ incidentIds: [incident.id] }))).rejects.toThrow('simulated relation failure');
    expect(persistence.store.investigations.size).toBe(0);
  });

  it('writes the conclusion and closes in one update; a refused close changes nothing', async () => {
    const a = await tenant();
    const b = await tenant();
    const [i1, i2, foreign] = [await a.incident('I1'), await a.incident('I2'), await b.incident('IB')];
    const { investigation } = await create().execute(a.user, a.workspaceId, details({ incidentIds: [i1.id] }));

    const started = await update().execute(a.user, a.workspaceId, investigation.id, details({ incidentIds: [i1.id, i2.id], conclusion: 'Rascunho' }), 'IN_PROGRESS');
    expect(started.investigation.toSnapshot()).toMatchObject({ status: 'IN_PROGRESS', conclusion: 'Rascunho', incidentIds: [i1.id, i2.id] });
    const before = persistence.store.investigations.get(investigation.id);

    // Draft too short to close: refused by the entity, nothing written.
    await expect(update().execute(a.user, a.workspaceId, investigation.id, details({ incidentIds: [i1.id], conclusion: 'Rascunho' }), 'CLOSED')).rejects.toBeInstanceOf(
      InvestigationConclusionRequiredError,
    );
    // Valid close + foreign incident: the whole update is refused.
    await issuesOf(update().execute(a.user, a.workspaceId, investigation.id, details({ incidentIds: [foreign.id], conclusion: CONCLUSION }), 'CLOSED'));
    expect(persistence.store.investigations.get(investigation.id)).toEqual(before);

    const closed = await update().execute(a.user, a.workspaceId, investigation.id, details({ incidentIds: [i1.id, i2.id], conclusion: CONCLUSION }), 'CLOSED');
    expect(closed.investigation.toSnapshot()).toMatchObject({ status: 'CLOSED', conclusion: CONCLUSION });
    expect(closed.investigation.closedAt).toBeInstanceOf(Date);
  });

  it('keeps a CLOSED investigation read-only but deletable', async () => {
    const a = await tenant();
    const incident = await a.incident('Caso');
    const { investigation } = await create().execute(a.user, a.workspaceId, details({ incidentIds: [incident.id] }));
    await update().execute(a.user, a.workspaceId, investigation.id, details({ incidentIds: [incident.id], conclusion: CONCLUSION }), 'CLOSED');
    const closed = persistence.store.investigations.get(investigation.id);

    for (const status of [undefined, 'CLOSED', 'OPEN'] as const) {
      await expect(
        update().execute(a.user, a.workspaceId, investigation.id, details({ title: 'Outro', incidentIds: [incident.id], conclusion: CONCLUSION }), status),
      ).rejects.toBeInstanceOf(InvalidStateError);
    }
    expect(persistence.store.investigations.get(investigation.id)).toEqual(closed);
    await new DeleteInvestigation(access, persistence.repositories.investigations).execute(a.user, a.workspaceId, investigation.id);
    expect(persistence.store.investigations.size).toBe(0);
  });

  it('lets a non-owner member read but not write; outsiders get 404', async () => {
    const owner = await tenant();
    const viewer = await tenant();
    const outsider = await tenant();
    const incident = await owner.incident('Caso');
    const { investigation } = await create().execute(owner.user, owner.workspaceId, details({ incidentIds: [incident.id] }));
    persistence.store.memberships.set(
      `${viewer.user.id}:${owner.workspaceId}`,
      Membership.restore({ userId: viewer.user.id, workspaceId: owner.workspaceId, role: 'VIEWER', createdAt: new Date() }).toSnapshot(),
    );
    const { investigations } = persistence.repositories;
    const get = new GetInvestigation(access, persistence.repositories);

    await expect(get.execute(viewer.user, owner.workspaceId, investigation.id)).resolves.toMatchObject({ investigation: { id: investigation.id } });
    await expect(new ListInvestigations(access, investigations).execute(viewer.user, owner.workspaceId, { page: 1, pageSize: 10 })).resolves.toMatchObject({ total: 1 });
    await expect(create().execute(viewer.user, owner.workspaceId, details({ incidentIds: [incident.id] }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(update().execute(viewer.user, owner.workspaceId, investigation.id, details({ incidentIds: [incident.id] }), 'IN_PROGRESS')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(new DeleteInvestigation(access, investigations).execute(viewer.user, owner.workspaceId, investigation.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(get.execute(outsider.user, owner.workspaceId, investigation.id)).rejects.toBeInstanceOf(NotFoundError);
    // The outsider's own workspace with the owner's investigation id: still 404.
    await expect(new DeleteInvestigation(access, investigations).execute(outsider.user, outsider.workspaceId, investigation.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(persistence.store.investigations.get(investigation.id)?.status).toBe('OPEN');
  });

  it('protects an investigated incident, without revealing it to other tenants, and frees it once unlinked', async () => {
    const a = await tenant();
    const b = await tenant();
    const [grouped, spare] = [await a.incident('Agrupado'), await a.incident('Reserva')];
    const { investigation } = await create().execute(a.user, a.workspaceId, details({ incidentIds: [grouped.id] }));

    await expect(deleteIncident().execute(a.user, a.workspaceId, grouped.id)).rejects.toThrow(ConflictError);
    await expect(deleteIncident().execute(a.user, a.workspaceId, grouped.id)).rejects.toThrow('Este incidente faz parte de investigações.');
    // B probing A's grouped incident through B's workspace: 404, never the 409 that would confirm it exists.
    await expect(deleteIncident().execute(b.user, b.workspaceId, grouped.id)).rejects.toBeInstanceOf(NotFoundError);

    await update().execute(a.user, a.workspaceId, investigation.id, details({ incidentIds: [spare.id] }));
    await deleteIncident().execute(a.user, a.workspaceId, grouped.id);
    expect(persistence.store.incidents.has(grouped.id)).toBe(false);
  });
});

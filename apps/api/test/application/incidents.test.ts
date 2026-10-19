import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, ForbiddenError, InvalidIncidentTransitionError, InvalidStateError, NotFoundError, ValidationError } from '@aegis/domain';
import type { PasswordHasher } from '../../src/application/ports/password-hasher.js';
import type { Repositories, UnitOfWork } from '../../src/application/ports/repositories.js';
import { RegisterUser } from '../../src/application/use-cases/register-user.js';
import { WorkspaceAccess } from '../../src/application/workspace-access.js';
import { CreateHost } from '../../src/application/use-cases/hosts/create-host.js';
import { DeleteHost } from '../../src/application/use-cases/hosts/delete-host.js';
import { CreateDetectionRule } from '../../src/application/use-cases/detection-rules/create-detection-rule.js';
import { DeleteDetectionRule } from '../../src/application/use-cases/detection-rules/delete-detection-rule.js';
import { CreateIncident } from '../../src/application/use-cases/incidents/create-incident.js';
import { GetIncident } from '../../src/application/use-cases/incidents/get-incident.js';
import { ListIncidents } from '../../src/application/use-cases/incidents/list-incidents.js';
import { UpdateIncident } from '../../src/application/use-cases/incidents/update-incident.js';
import { DeleteIncident } from '../../src/application/use-cases/incidents/delete-incident.js';
import type { IncidentDetails } from '../../src/domain/incident.js';
import { Membership } from '../../src/domain/membership.js';
import { createInMemoryPersistence } from '../support/in-memory-persistence.js';
import { makeRegistration } from '../support/fixtures.js';

const plainHasher: PasswordHasher = { hash: async (plain) => `hashed:${plain}`, verify: async (hash, plain) => hash === `hashed:${plain}` };

const issuesOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ValidationError);
  return (error as ValidationError).issues;
};

describe('incident use cases', () => {
  let persistence: ReturnType<typeof createInMemoryPersistence>;
  let access: WorkspaceAccess;

  const tenant = async () => {
    const account = await new RegisterUser(persistence.repositories, persistence.unitOfWork, plainHasher).execute(makeRegistration());
    const user = account.user;
    const workspaceId = account.workspaces[0]?.workspace.id ?? '';
    return {
      user,
      workspaceId,
      host: (name: string) => new CreateHost(access, persistence.repositories.hosts).execute(user, workspaceId, { displayName: name }),
      rule: async (name: string) =>
        (
          await new CreateDetectionRule(access, persistence.unitOfWork).execute(user, workspaceId, {
            name,
            severity: 'HIGH',
            enabled: true,
            eventCategory: 'PROCESS',
            scope: 'ALL_HOSTS',
            targetHostIds: [],
            definition: { version: 1, match: 'ALL', conditions: [{ field: 'process.name', operator: 'EQUALS', value: 'bash' }] },
          })
        ).rule,
    };
  };

  const details = (overrides: Partial<IncidentDetails>): IncidentDetails => ({
    title: 'Shell inesperado no servidor web',
    severity: 'HIGH',
    hostIds: [],
    detectionRuleIds: [],
    ...overrides,
  });

  const create = (unitOfWork: UnitOfWork = persistence.unitOfWork) => new CreateIncident(access, unitOfWork);
  const update = () => new UpdateIncident(access, persistence.unitOfWork);

  beforeEach(() => {
    persistence = createInMemoryPersistence();
    access = new WorkspaceAccess(persistence.repositories.memberships);
  });

  it('opens a MANUAL incident with hosts and rules resolved from its workspace', async () => {
    const a = await tenant();
    const [web1, web2, rule] = [await a.host('servidor-web-01'), await a.host('servidor-web-02'), await a.rule('Shell iniciado por servidor web')];
    const view = await create().execute(a.user, a.workspaceId, details({ hostIds: [web2.id, web1.id], detectionRuleIds: [rule.id] }));

    expect(view.hosts.map((host) => host.displayName)).toEqual(['servidor-web-01', 'servidor-web-02']);
    expect(view.detectionRules.map((item) => item.name)).toEqual(['Shell iniciado por servidor web']);
    expect(persistence.store.incidents.get(view.incident.id)).toMatchObject({ status: 'OPEN', origin: 'MANUAL', resolvedAt: null, hostIds: [web2.id, web1.id] });
  });

  it('refuses foreign or missing hosts and rules with the same messages, persisting nothing', async () => {
    const a = await tenant();
    const b = await tenant();
    const [hostA, hostB, ruleB] = [await a.host('Host A'), await b.host('Host B'), await b.rule('Regra B')];

    const issues = await issuesOf(create().execute(a.user, a.workspaceId, details({ hostIds: [hostA.id, hostB.id], detectionRuleIds: [ruleB.id] })));
    expect(issues).toEqual([
      { field: 'hostIds', message: 'Um ou mais hosts não existem neste workspace.' },
      { field: 'detectionRuleIds', message: 'Uma ou mais regras não existem neste workspace.' },
    ]);
    const missing = '00000000-0000-4000-8000-000000000000';
    const missingIssues = await issuesOf(create().execute(a.user, a.workspaceId, details({ hostIds: [missing], detectionRuleIds: [missing] })));
    expect(missingIssues).toEqual(issues);
    expect(persistence.store.incidents.size).toBe(0);
  });

  it('rolls back the incident row when writing the relations fails mid-transaction', async () => {
    const a = await tenant();
    const host = await a.host('Servidor');
    const failing: UnitOfWork = {
      run: (work) =>
        persistence.unitOfWork.run((repositories) => {
          // The incident row is written, then the relation write "fails".
          const incidents = new Proxy(repositories.incidents, {
            get: (target, property, receiver) =>
              property === 'insert'
                ? async (incident: Parameters<typeof target.insert>[0]) => {
                    await target.insert(incident);
                    throw new Error('simulated relation failure');
                  }
                : Reflect.get(target, property, receiver),
          });
          const sabotaged: Repositories = { ...repositories, incidents };
          return work(sabotaged);
        }),
    };
    await expect(create(failing).execute(a.user, a.workspaceId, details({ hostIds: [host.id] }))).rejects.toThrow('simulated relation failure');
    expect(persistence.store.incidents.size).toBe(0);
  });

  it('applies edits and the lifecycle in one transaction; a failure leaves everything as it was', async () => {
    const a = await tenant();
    const b = await tenant();
    const [h1, h2, hostB] = [await a.host('H1'), await a.host('H2'), await b.host('HB')];
    const { incident } = await create().execute(a.user, a.workspaceId, details({ hostIds: [h1.id] }));

    const resolved = await update().execute(a.user, a.workspaceId, incident.id, details({ title: 'Resolvido', hostIds: [h1.id, h2.id] }), 'RESOLVED');
    expect(resolved.incident.toSnapshot()).toMatchObject({ title: 'Resolvido', status: 'RESOLVED', hostIds: [h1.id, h2.id] });
    expect(resolved.incident.resolvedAt).toBeInstanceOf(Date);

    const before = persistence.store.incidents.get(incident.id);
    // Valid transition + foreign host: the whole update is refused.
    await issuesOf(update().execute(a.user, a.workspaceId, incident.id, details({ hostIds: [hostB.id] }), 'CLOSED'));
    // Invalid transition: refused by the entity.
    await expect(update().execute(a.user, a.workspaceId, incident.id, details({ hostIds: [h1.id] }), 'OPEN')).rejects.toBeInstanceOf(
      InvalidIncidentTransitionError,
    );
    expect(persistence.store.incidents.get(incident.id)).toEqual(before);
  });

  it('keeps a CLOSED incident read-only but deletable', async () => {
    const a = await tenant();
    const host = await a.host('Servidor');
    const { incident } = await create().execute(a.user, a.workspaceId, details({ hostIds: [host.id] }));
    await update().execute(a.user, a.workspaceId, incident.id, details({ hostIds: [host.id] }), 'RESOLVED');
    await update().execute(a.user, a.workspaceId, incident.id, details({ hostIds: [host.id] }), 'CLOSED');

    await expect(update().execute(a.user, a.workspaceId, incident.id, details({ title: 'Outro', hostIds: [host.id] }))).rejects.toBeInstanceOf(
      InvalidStateError,
    );
    await new DeleteIncident(access, persistence.repositories.incidents).execute(a.user, a.workspaceId, incident.id);
    expect(persistence.store.incidents.size).toBe(0);
  });

  it('lets a non-owner member read but not write; outsiders get 404', async () => {
    const owner = await tenant();
    const viewer = await tenant();
    const outsider = await tenant();
    const host = await owner.host('Servidor');
    const { incident } = await create().execute(owner.user, owner.workspaceId, details({ hostIds: [host.id] }));
    persistence.store.memberships.set(
      `${viewer.user.id}:${owner.workspaceId}`,
      Membership.restore({ userId: viewer.user.id, workspaceId: owner.workspaceId, role: 'VIEWER', createdAt: new Date() }).toSnapshot(),
    );
    const { incidents } = persistence.repositories;

    await expect(new GetIncident(access, persistence.repositories).execute(viewer.user, owner.workspaceId, incident.id)).resolves.toMatchObject({ incident: { id: incident.id } });
    await expect(new ListIncidents(access, incidents).execute(viewer.user, owner.workspaceId, { page: 1, pageSize: 10 })).resolves.toMatchObject({ total: 1 });
    await expect(create().execute(viewer.user, owner.workspaceId, details({ hostIds: [host.id] }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(update().execute(viewer.user, owner.workspaceId, incident.id, details({ hostIds: [host.id] }), 'RESOLVED')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new DeleteIncident(access, incidents).execute(viewer.user, owner.workspaceId, incident.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new GetIncident(access, persistence.repositories).execute(outsider.user, owner.workspaceId, incident.id)).rejects.toBeInstanceOf(NotFoundError);
    // The outsider's own workspace with the owner's incident id: still 404.
    await expect(new DeleteIncident(access, incidents).execute(outsider.user, outsider.workspaceId, incident.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(persistence.store.incidents.get(incident.id)?.status).toBe('OPEN');
  });

  it('protects hosts and rules related to an incident, and frees them once unlinked', async () => {
    const a = await tenant();
    const b = await tenant();
    const { hosts, detectionRules, incidents } = persistence.repositories;
    const deleteHost = new DeleteHost(access, hosts, detectionRules, incidents);
    const deleteRule = new DeleteDetectionRule(access, detectionRules, incidents);
    const [involved, spare, rule] = [await a.host('Envolvido'), await a.host('Reserva'), await a.rule('Relacionada')];
    const { incident } = await create().execute(a.user, a.workspaceId, details({ hostIds: [involved.id], detectionRuleIds: [rule.id] }));

    await expect(deleteHost.execute(a.user, a.workspaceId, involved.id)).rejects.toThrow(ConflictError);
    await expect(deleteRule.execute(a.user, a.workspaceId, rule.id)).rejects.toThrow('Esta regra está relacionada a incidentes.');
    // B probing A's related rule through B's workspace: 404, never the 409 that would confirm it exists.
    await expect(deleteRule.execute(b.user, b.workspaceId, rule.id)).rejects.toBeInstanceOf(NotFoundError);

    await update().execute(a.user, a.workspaceId, incident.id, details({ hostIds: [spare.id] }));
    await deleteHost.execute(a.user, a.workspaceId, involved.id);
    await deleteRule.execute(a.user, a.workspaceId, rule.id);
    expect(persistence.store.hosts.has(involved.id)).toBe(false);
    expect(persistence.store.detectionRules.has(rule.id)).toBe(false);
  });
});

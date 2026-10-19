import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@aegis/domain';
import type { PasswordHasher } from '../../src/application/ports/password-hasher.js';
import type { UnitOfWork } from '../../src/application/ports/repositories.js';
import { RegisterUser } from '../../src/application/use-cases/register-user.js';
import { WorkspaceAccess } from '../../src/application/workspace-access.js';
import { CreateHost } from '../../src/application/use-cases/hosts/create-host.js';
import { DeleteHost } from '../../src/application/use-cases/hosts/delete-host.js';
import { CreateDetectionRule } from '../../src/application/use-cases/detection-rules/create-detection-rule.js';
import { UpdateDetectionRule } from '../../src/application/use-cases/detection-rules/update-detection-rule.js';
import { DeleteDetectionRule } from '../../src/application/use-cases/detection-rules/delete-detection-rule.js';
import type { DetectionRuleDetails } from '../../src/domain/detection-rule.js';
import { Membership } from '../../src/domain/membership.js';
import { createInMemoryPersistence } from '../support/in-memory-persistence.js';
import { makeRegistration } from '../support/fixtures.js';

const plainHasher: PasswordHasher = { hash: async (plain) => `hashed:${plain}`, verify: async (hash, plain) => hash === `hashed:${plain}` };

const details = (overrides: Partial<DetectionRuleDetails> = {}): DetectionRuleDetails => ({
  name: 'Shell em servidor web',
  severity: 'HIGH',
  enabled: true,
  eventCategory: 'PROCESS',
  scope: 'ALL_HOSTS',
  targetHostIds: [],
  definition: { version: 1, match: 'ALL', conditions: [{ field: 'process.name', operator: 'EQUALS', value: 'bash' }] },
  ...overrides,
});

describe('detection rule use cases', () => {
  let persistence: ReturnType<typeof createInMemoryPersistence>;
  let access: WorkspaceAccess;

  const tenant = async () => {
    const account = await new RegisterUser(persistence.repositories, persistence.unitOfWork, plainHasher).execute(makeRegistration());
    const workspaceId = account.workspaces[0]?.workspace.id ?? '';
    const host = (name: string) => new CreateHost(access, persistence.repositories.hosts).execute(account.user, workspaceId, { displayName: name });
    return { user: account.user, workspaceId, host };
  };

  beforeEach(() => {
    persistence = createInMemoryPersistence();
    access = new WorkspaceAccess(persistence.repositories.memberships);
  });

  it('creates SELECTED_HOSTS rules with targets resolved from the same workspace', async () => {
    const a = await tenant();
    const [h1, h2] = [await a.host('Banco'), await a.host('Web')];
    const view = await new CreateDetectionRule(access, persistence.unitOfWork).execute(
      a.user,
      a.workspaceId,
      details({ scope: 'SELECTED_HOSTS', targetHostIds: [h2.id, h1.id] }),
    );
    expect(view.targets.map((host) => host.displayName)).toEqual(['Banco', 'Web']);
    expect(persistence.store.detectionRules.get(view.rule.id)?.targetHostIds).toEqual([h2.id, h1.id]);
  });

  it('refuses a target from another workspace with the same message as a missing host, persisting nothing', async () => {
    const a = await tenant();
    const b = await tenant();
    const own = await a.host('Meu host');
    const foreign = await b.host('Host de B');
    const create = new CreateDetectionRule(access, persistence.unitOfWork);

    const foreignAttempt = create.execute(a.user, a.workspaceId, details({ scope: 'SELECTED_HOSTS', targetHostIds: [own.id, foreign.id] }));
    await expect(foreignAttempt).rejects.toMatchObject({ issues: [{ field: 'hostIds', message: 'Um ou mais hosts não existem neste workspace.' }] });
    const missingAttempt = create.execute(a.user, a.workspaceId, details({ scope: 'SELECTED_HOSTS', targetHostIds: ['00000000-0000-4000-8000-000000000000'] }));
    await expect(missingAttempt).rejects.toMatchObject({ issues: [{ field: 'hostIds', message: 'Um ou mais hosts não existem neste workspace.' }] });
    expect(persistence.store.detectionRules.size).toBe(0);
  });

  it('switches ALL → SELECTED → ALL and keeps the rule untouched when an update fails', async () => {
    const a = await tenant();
    const b = await tenant();
    const host = await a.host('Servidor');
    const foreign = await b.host('Host de B');
    const rule = (await new CreateDetectionRule(access, persistence.unitOfWork).execute(a.user, a.workspaceId, details())).rule;
    const update = new UpdateDetectionRule(access, persistence.unitOfWork);

    await update.execute(a.user, a.workspaceId, rule.id, details({ scope: 'SELECTED_HOSTS', targetHostIds: [host.id] }));
    expect(persistence.store.detectionRules.get(rule.id)?.targetHostIds).toEqual([host.id]);

    const before = persistence.store.detectionRules.get(rule.id);
    await expect(
      update.execute(a.user, a.workspaceId, rule.id, details({ name: 'Alterada', scope: 'SELECTED_HOSTS', targetHostIds: [host.id, foreign.id] })),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(persistence.store.detectionRules.get(rule.id)).toEqual(before);

    await update.execute(a.user, a.workspaceId, rule.id, details({ scope: 'ALL_HOSTS', targetHostIds: [] }));
    expect(persistence.store.detectionRules.get(rule.id)?.targetHostIds).toEqual([]);
  });

  it('rolls back the rule when the targets cannot be written inside the transaction', async () => {
    const a = await tenant();
    const host = await a.host('Servidor');
    const sabotaged: UnitOfWork = {
      run: (work) =>
        persistence.unitOfWork.run(async (repositories) =>
          work({
            ...repositories,
            detectionRules: Object.assign(Object.create(Object.getPrototypeOf(repositories.detectionRules)), repositories.detectionRules, {
              insert: async () => {
                throw new Error('simulated targets failure');
              },
            }),
          }),
        ),
    };
    await expect(
      new CreateDetectionRule(access, sabotaged).execute(a.user, a.workspaceId, details({ scope: 'SELECTED_HOSTS', targetHostIds: [host.id] })),
    ).rejects.toThrow('simulated targets failure');
    expect(persistence.store.detectionRules.size).toBe(0);
  });

  it('isolates tenants: B cannot update or delete A rules (404) and a non-owner member cannot write (403)', async () => {
    const a = await tenant();
    const b = await tenant();
    const rule = (await new CreateDetectionRule(access, persistence.unitOfWork).execute(a.user, a.workspaceId, details())).rule;

    await expect(new UpdateDetectionRule(access, persistence.unitOfWork).execute(b.user, a.workspaceId, rule.id, details())).rejects.toBeInstanceOf(NotFoundError);
    await expect(new UpdateDetectionRule(access, persistence.unitOfWork).execute(b.user, b.workspaceId, rule.id, details())).rejects.toBeInstanceOf(NotFoundError);
    await expect(new DeleteDetectionRule(access, persistence.repositories.detectionRules, persistence.repositories.incidents).execute(b.user, b.workspaceId, rule.id)).rejects.toBeInstanceOf(NotFoundError);

    persistence.store.memberships.set(
      `${b.user.id}:${a.workspaceId}`,
      Membership.restore({ userId: b.user.id, workspaceId: a.workspaceId, role: 'VIEWER', createdAt: new Date() }).toSnapshot(),
    );
    await expect(new DeleteDetectionRule(access, persistence.repositories.detectionRules, persistence.repositories.incidents).execute(b.user, a.workspaceId, rule.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(persistence.store.detectionRules.has(rule.id)).toBe(true);
  });

  it('blocks deleting a host targeted by a rule (409) and allows it once the rule no longer targets it', async () => {
    const a = await tenant();
    const host = await a.host('Servidor');
    const rule = (
      await new CreateDetectionRule(access, persistence.unitOfWork).execute(a.user, a.workspaceId, details({ scope: 'SELECTED_HOSTS', targetHostIds: [host.id] }))
    ).rule;
    const deleteHost = new DeleteHost(access, persistence.repositories.hosts, persistence.repositories.detectionRules, persistence.repositories.incidents);

    await expect(deleteHost.execute(a.user, a.workspaceId, host.id)).rejects.toBeInstanceOf(ConflictError);
    await new DeleteDetectionRule(access, persistence.repositories.detectionRules, persistence.repositories.incidents).execute(a.user, a.workspaceId, rule.id);
    await expect(deleteHost.execute(a.user, a.workspaceId, host.id)).resolves.toBeUndefined();
  });
});

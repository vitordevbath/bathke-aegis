import { beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenError, NotFoundError } from '@aegis/domain';
import type { PasswordHasher } from '../../src/application/ports/password-hasher.js';
import { RegisterUser } from '../../src/application/use-cases/register-user.js';
import { WorkspaceAccess } from '../../src/application/workspace-access.js';
import { CreateHost } from '../../src/application/use-cases/hosts/create-host.js';
import { ListHosts } from '../../src/application/use-cases/hosts/list-hosts.js';
import { GetHost } from '../../src/application/use-cases/hosts/get-host.js';
import { UpdateHost } from '../../src/application/use-cases/hosts/update-host.js';
import { DeleteHost } from '../../src/application/use-cases/hosts/delete-host.js';
import { Membership } from '../../src/domain/membership.js';
import { createInMemoryPersistence } from '../support/in-memory-persistence.js';
import { makeRegistration } from '../support/fixtures.js';

const plainHasher: PasswordHasher = { hash: async (plain) => `hashed:${plain}`, verify: async (hash, plain) => hash === `hashed:${plain}` };

describe('WorkspaceAccess and host use cases', () => {
  let persistence: ReturnType<typeof createInMemoryPersistence>;
  let access: WorkspaceAccess;

  const register = async () => {
    const account = await new RegisterUser(persistence.repositories, persistence.unitOfWork, plainHasher).execute(makeRegistration());
    return { user: account.user, workspaceId: account.workspaces[0]?.workspace.id ?? '' };
  };

  beforeEach(() => {
    persistence = createInMemoryPersistence();
    access = new WorkspaceAccess(persistence.repositories.memberships);
  });

  it('treats a workspace the user does not belong to exactly like a missing one', async () => {
    const a = await register();
    const b = await register();

    await expect(access.requireMember(a.user, b.workspaceId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(access.requireMember(a.user, '00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(NotFoundError);
    await expect(access.requireManager(a.user, a.workspaceId)).resolves.toMatchObject({ role: 'OWNER' });
  });

  it('lets a non-owner member read but not write (deny-by-default for future roles)', async () => {
    const owner = await register();
    const viewer = await register();
    const hosts = persistence.repositories.hosts;
    const host = await new CreateHost(access, hosts).execute(owner.user, owner.workspaceId, { displayName: 'Servidor' });
    persistence.store.memberships.set(
      `${viewer.user.id}:${owner.workspaceId}`,
      Membership.restore({ userId: viewer.user.id, workspaceId: owner.workspaceId, role: 'VIEWER', createdAt: new Date() }).toSnapshot(),
    );

    await expect(new GetHost(access, hosts).execute(viewer.user, owner.workspaceId, host.id)).resolves.toMatchObject({ id: host.id });
    await expect(new ListHosts(access, hosts).execute(viewer.user, owner.workspaceId, { page: 1, pageSize: 10 })).resolves.toMatchObject({ total: 1 });
    await expect(new CreateHost(access, hosts).execute(viewer.user, owner.workspaceId, { displayName: 'Outro' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new UpdateHost(access, hosts).execute(viewer.user, owner.workspaceId, host.id, { displayName: 'X1' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new DeleteHost(access, hosts, persistence.repositories.detectionRules, persistence.repositories.incidents, persistence.repositories.events).execute(viewer.user, owner.workspaceId, host.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(persistence.store.hosts.size).toBe(1);
  });

  it('cannot reach a host through another workspace id, even the caller own one', async () => {
    const a = await register();
    const b = await register();
    const hosts = persistence.repositories.hosts;
    const hostB = await new CreateHost(access, hosts).execute(b.user, b.workspaceId, { displayName: 'Host B' });

    // A uses their own (valid) workspace with B's host id.
    await expect(new GetHost(access, hosts).execute(a.user, a.workspaceId, hostB.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new UpdateHost(access, hosts).execute(a.user, a.workspaceId, hostB.id, { displayName: 'Hack' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new DeleteHost(access, hosts, persistence.repositories.detectionRules, persistence.repositories.incidents, persistence.repositories.events).execute(a.user, a.workspaceId, hostB.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(persistence.store.hosts.get(hostB.id)?.displayName).toBe('Host B');
  });
});

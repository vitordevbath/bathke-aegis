import { NotFoundError } from '@aegis/domain';
import type { Host } from '../../../domain/host.js';
import type { User } from '../../../domain/user.js';
import type { HostRepository } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';
import type { HostDetailsInput } from './create-host.js';

/** Replaces the administrative fields. Collector-controlled fields cannot be reached from here. */
export class UpdateHost {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly hosts: HostRepository,
  ) {}

  async execute(user: User, workspaceId: string, hostId: string, input: HostDetailsInput): Promise<Host> {
    await this.access.requireManager(user, workspaceId);
    const host = await this.hosts.findInWorkspace(workspaceId, hostId);
    if (!host) throw new NotFoundError();
    host.updateDetails({ displayName: input.displayName, description: input.description ?? null });
    await this.hosts.update(host);
    return host;
  }
}

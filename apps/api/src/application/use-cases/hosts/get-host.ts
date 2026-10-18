import { NotFoundError } from '@aegis/domain';
import type { Host } from '../../../domain/host.js';
import type { User } from '../../../domain/user.js';
import type { HostRepository } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';

export class GetHost {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly hosts: HostRepository,
  ) {}

  /** Missing host and host of another workspace are the same 404. */
  async execute(user: User, workspaceId: string, hostId: string): Promise<Host> {
    await this.access.requireMember(user, workspaceId);
    const host = await this.hosts.findInWorkspace(workspaceId, hostId);
    if (!host) throw new NotFoundError();
    return host;
  }
}

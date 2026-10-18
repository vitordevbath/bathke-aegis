import type { Host } from '../../../domain/host.js';
import type { User } from '../../../domain/user.js';
import type { Page } from '../../pagination.js';
import type { HostListFilter, HostRepository } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';

export class ListHosts {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly hosts: HostRepository,
  ) {}

  async execute(user: User, workspaceId: string, filter: HostListFilter): Promise<Page<Host>> {
    await this.access.requireMember(user, workspaceId);
    return this.hosts.listInWorkspace(workspaceId, filter);
  }
}

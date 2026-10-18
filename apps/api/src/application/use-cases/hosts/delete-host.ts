import { NotFoundError } from '@aegis/domain';
import type { User } from '../../../domain/user.js';
import type { HostRepository } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';

/**
 * Physical delete: hosts have no telemetry or history yet. Once events
 * reference hosts, this policy will be revisited (e.g. archival).
 */
export class DeleteHost {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly hosts: HostRepository,
  ) {}

  async execute(user: User, workspaceId: string, hostId: string): Promise<void> {
    await this.access.requireManager(user, workspaceId);
    if (!(await this.hosts.deleteInWorkspace(workspaceId, hostId))) throw new NotFoundError();
  }
}

import { ConflictError, NotFoundError } from '@aegis/domain';
import type { User } from '../../../domain/user.js';
import type { DetectionRuleRepository, HostRepository } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';

export const HOST_TARGETED_MESSAGE = 'Este host é alvo de regras de detecção. Remova-o dessas regras antes de excluí-lo.';

/**
 * Physical delete: hosts have no telemetry or history yet. Once events
 * reference hosts, this policy will be revisited (e.g. archival).
 * A host targeted by a detection rule cannot be deleted (409): otherwise a
 * SELECTED_HOSTS rule could silently lose its last target.
 */
export class DeleteHost {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly hosts: HostRepository,
    private readonly detectionRules: DetectionRuleRepository,
  ) {}

  async execute(user: User, workspaceId: string, hostId: string): Promise<void> {
    await this.access.requireManager(user, workspaceId);
    const host = await this.hosts.findInWorkspace(workspaceId, hostId);
    if (!host) throw new NotFoundError();
    if (await this.detectionRules.isHostTargeted(host.id)) throw new ConflictError(HOST_TARGETED_MESSAGE);
    if (!(await this.hosts.deleteInWorkspace(workspaceId, hostId))) throw new NotFoundError();
  }
}

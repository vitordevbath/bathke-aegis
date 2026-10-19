import { ConflictError, NotFoundError } from '@aegis/domain';
import type { User } from '../../../domain/user.js';
import type { DetectionRuleRepository, HostRepository, IncidentRepository } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';

export const HOST_TARGETED_MESSAGE = 'Este host é alvo de regras de detecção. Remova-o dessas regras antes de excluí-lo.';
export const HOST_IN_INCIDENT_MESSAGE = 'Este host está envolvido em incidentes. Remova-o desses incidentes antes de excluí-lo.';

/**
 * Physical delete: hosts have no telemetry or history yet. Once events
 * reference hosts, this policy will be revisited (e.g. archival).
 * A host targeted by a detection rule or involved in an incident cannot be
 * deleted (409): a rule or an incident must never silently lose a host.
 */
export class DeleteHost {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly hosts: HostRepository,
    private readonly detectionRules: DetectionRuleRepository,
    private readonly incidents: IncidentRepository,
  ) {}

  async execute(user: User, workspaceId: string, hostId: string): Promise<void> {
    await this.access.requireManager(user, workspaceId);
    const host = await this.hosts.findInWorkspace(workspaceId, hostId);
    if (!host) throw new NotFoundError();
    if (await this.detectionRules.isHostTargeted(host.id)) throw new ConflictError(HOST_TARGETED_MESSAGE);
    if (await this.incidents.isHostInvolved(host.id)) throw new ConflictError(HOST_IN_INCIDENT_MESSAGE);
    if (!(await this.hosts.deleteInWorkspace(workspaceId, hostId))) throw new NotFoundError();
  }
}

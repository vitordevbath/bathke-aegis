import { ConflictError, NotFoundError } from '@aegis/domain';
import type { User } from '../../../domain/user.js';
import type { DetectionRuleRepository, EventRepository, HostRepository, IncidentRepository, MachineCredentialRepository } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';

export const HOST_TARGETED_MESSAGE = 'Este host é alvo de regras de detecção. Remova-o dessas regras antes de excluí-lo.';
export const HOST_IN_INCIDENT_MESSAGE = 'Este host está envolvido em incidentes. Remova-o desses incidentes antes de excluí-lo.';
export const HOST_HAS_EVENTS_MESSAGE = 'Este host tem telemetria armazenada e não pode ser excluído; os eventos são históricos e imutáveis.';
export const HOST_HAS_CREDENTIALS_MESSAGE = 'Este host já foi pareado e mantém o histórico das credenciais de máquina; por isso não pode ser excluído.';

/**
 * Physical delete, only while nothing refers to the host (409 otherwise): a
 * rule or an incident must never silently lose a host, and a host with
 * stored events keeps its telemetry history (ADR-036) and one that was paired
 * keeps its credential history for audit — there is no archiving yet. The host is looked up in the workspace
 * first, so a foreign host is a 404, never a 409.
 */
export class DeleteHost {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly hosts: HostRepository,
    private readonly detectionRules: DetectionRuleRepository,
    private readonly incidents: IncidentRepository,
    private readonly events: EventRepository,
    private readonly credentials: MachineCredentialRepository,
  ) {}

  async execute(user: User, workspaceId: string, hostId: string): Promise<void> {
    await this.access.requireManager(user, workspaceId);
    const host = await this.hosts.findInWorkspace(workspaceId, hostId);
    if (!host) throw new NotFoundError();
    if (await this.detectionRules.isHostTargeted(host.id)) throw new ConflictError(HOST_TARGETED_MESSAGE);
    if (await this.incidents.isHostInvolved(host.id)) throw new ConflictError(HOST_IN_INCIDENT_MESSAGE);
    if (await this.events.existsForHost(host.id)) throw new ConflictError(HOST_HAS_EVENTS_MESSAGE);
    if (await this.credentials.existsForHost(host.id)) throw new ConflictError(HOST_HAS_CREDENTIALS_MESSAGE);
    if (!(await this.hosts.deleteInWorkspace(workspaceId, hostId))) throw new NotFoundError();
  }
}

import { NotFoundError } from '@aegis/domain';
import type { User } from '../../../domain/user.js';
import type { Repositories } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';
import type { IncidentView } from './incident-view.js';

export class GetIncident {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly repositories: Pick<Repositories, 'incidents' | 'hosts' | 'detectionRules'>,
  ) {}

  /** Missing incident and incident of another workspace are the same 404. */
  async execute(user: User, workspaceId: string, incidentId: string): Promise<IncidentView> {
    await this.access.requireMember(user, workspaceId);
    const incident = await this.repositories.incidents.findInWorkspace(workspaceId, incidentId);
    if (!incident) throw new NotFoundError();
    const [hosts, detectionRules] = await Promise.all([
      this.repositories.hosts.findManyInWorkspace(workspaceId, incident.hostIds),
      this.repositories.detectionRules.findManyInWorkspace(workspaceId, incident.detectionRuleIds),
    ]);
    return { incident, hosts, detectionRules };
  }
}

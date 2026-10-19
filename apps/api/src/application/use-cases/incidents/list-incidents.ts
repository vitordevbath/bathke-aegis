import type { Incident } from '../../../domain/incident.js';
import type { User } from '../../../domain/user.js';
import type { Page } from '../../pagination.js';
import type { IncidentListFilter, IncidentRepository } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';

export class ListIncidents {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly incidents: IncidentRepository,
  ) {}

  async execute(user: User, workspaceId: string, filter: IncidentListFilter): Promise<Page<Incident>> {
    await this.access.requireMember(user, workspaceId);
    return this.incidents.listInWorkspace(workspaceId, filter);
  }
}

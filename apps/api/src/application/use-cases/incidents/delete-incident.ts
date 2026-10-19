import { ConflictError, NotFoundError } from '@aegis/domain';
import type { User } from '../../../domain/user.js';
import type { IncidentRepository, InvestigationRepository } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';

export const INCIDENT_IN_INVESTIGATION_MESSAGE = 'Este incidente faz parte de investigações. Remova-o dessas investigações antes de excluí-lo.';

/**
 * Physical delete (ADR-027): incidents hold no immutable evidence yet. The
 * relations go with it (ON DELETE CASCADE); hosts and rules are untouched.
 * An incident grouped by an investigation cannot be deleted (409, ADR-030),
 * so an investigation never silently loses a case. The incident is looked up
 * in the workspace first: a foreign incident is a 404, never a 409.
 */
export class DeleteIncident {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly incidents: IncidentRepository,
    private readonly investigations: InvestigationRepository,
  ) {}

  async execute(user: User, workspaceId: string, incidentId: string): Promise<void> {
    await this.access.requireManager(user, workspaceId);
    const incident = await this.incidents.findInWorkspace(workspaceId, incidentId);
    if (!incident) throw new NotFoundError();
    if (await this.investigations.isIncidentInvestigated(incident.id)) throw new ConflictError(INCIDENT_IN_INVESTIGATION_MESSAGE);
    if (!(await this.incidents.deleteInWorkspace(workspaceId, incidentId))) throw new NotFoundError();
  }
}

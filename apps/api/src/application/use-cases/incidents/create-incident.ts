import { Incident, type IncidentDetails } from '../../../domain/incident.js';
import type { User } from '../../../domain/user.js';
import type { UnitOfWork } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';
import { resolveRelations, type IncidentView } from './incident-view.js';

/**
 * Registers a manual incident (OPEN, MANUAL) and its relations atomically:
 * every host and rule must belong to the route workspace, or nothing is written.
 */
export class CreateIncident {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(user: User, workspaceId: string, details: IncidentDetails): Promise<IncidentView> {
    await this.access.requireManager(user, workspaceId);
    const incident = Incident.open(workspaceId, details);
    return this.unitOfWork.run(async (repositories) => {
      const view = await resolveRelations(repositories, incident);
      await repositories.incidents.insert(incident);
      return view;
    });
  }
}

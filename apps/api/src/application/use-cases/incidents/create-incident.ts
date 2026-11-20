import { Incident, type IncidentDetails } from '../../../domain/incident.js';
import { IncidentActivity } from '../../../domain/incident-activity.js';
import type { User } from '../../../domain/user.js';
import type { UnitOfWork } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';
import { resolveRelations, type IncidentView } from './incident-view.js';

/**
 * Registers a manual incident (OPEN, MANUAL) and its relations atomically:
 * every host and rule must belong to the route workspace, or nothing is written.
 * The opening is the first entry of the incident's history (ADR-054).
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
      await repositories.incidentActivities.insertMany([IncidentActivity.opened(incident, { kind: 'USER', userId: user.id }, incident.toSnapshot().createdAt)]);
      return view;
    });
  }
}

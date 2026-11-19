import { NotFoundError, diffIncident, type IncidentStatus } from '@aegis/domain';
import { IncidentActivity } from '../../../domain/incident-activity.js';
import type { IncidentDetails } from '../../../domain/incident.js';
import type { User } from '../../../domain/user.js';
import type { UnitOfWork } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';
import { resolveRelations, type IncidentView } from './incident-view.js';

/**
 * Replaces the editable fields and relations and, when `status` is given,
 * moves the lifecycle through the entity (the only place transitions are
 * decided). Each real change (status, severity, other fields) is appended to
 * the incident's history (ADR-054); saving an untouched form records nothing.
 * Runs in one transaction: any failure leaves the incident as it was.
 */
export class UpdateIncident {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(user: User, workspaceId: string, incidentId: string, details: IncidentDetails, status?: IncidentStatus): Promise<IncidentView> {
    await this.access.requireManager(user, workspaceId);
    return this.unitOfWork.run(async (repositories) => {
      const incident = await repositories.incidents.findInWorkspace(workspaceId, incidentId);
      if (!incident) throw new NotFoundError();
      const before = incident.toSnapshot();
      incident.revise(details);
      if (status) incident.transitionTo(status);
      const view = await resolveRelations(repositories, incident);
      await repositories.incidents.update(incident);
      const author = { kind: 'USER', userId: user.id } as const;
      const now = incident.toSnapshot().updatedAt;
      await repositories.incidentActivities.insertMany(diffIncident(before, incident.toSnapshot()).map((change) => IncidentActivity.changed(incident, change, author, now)));
      return view;
    });
  }
}

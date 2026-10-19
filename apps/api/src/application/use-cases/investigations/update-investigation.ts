import { NotFoundError, type InvestigationStatus } from '@aegis/domain';
import type { InvestigationDetails } from '../../../domain/investigation.js';
import type { User } from '../../../domain/user.js';
import type { UnitOfWork } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';
import { resolveIncidents, type InvestigationView } from './investigation-view.js';

/**
 * Replaces the editable fields (including a draft conclusion) and incidents
 * and, when `status` is given, moves the lifecycle through the entity — the
 * only place transitions and the "no close without conclusion" rule are
 * decided. The new conclusion is applied first, so it can be written and the
 * case closed in the same request. Runs in one transaction: any failure
 * leaves the investigation as it was.
 */
export class UpdateInvestigation {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(
    user: User,
    workspaceId: string,
    investigationId: string,
    details: InvestigationDetails,
    status?: InvestigationStatus,
  ): Promise<InvestigationView> {
    await this.access.requireManager(user, workspaceId);
    return this.unitOfWork.run(async (repositories) => {
      const investigation = await repositories.investigations.findInWorkspace(workspaceId, investigationId);
      if (!investigation) throw new NotFoundError();
      investigation.revise(details);
      if (status) investigation.transitionTo(status);
      const view = await resolveIncidents(repositories.incidents, investigation);
      await repositories.investigations.update(investigation);
      return view;
    });
  }
}

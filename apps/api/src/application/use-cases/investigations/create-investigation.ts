import { Investigation, type InvestigationDetails } from '../../../domain/investigation.js';
import type { User } from '../../../domain/user.js';
import type { UnitOfWork } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';
import { resolveIncidents, type InvestigationView } from './investigation-view.js';

/**
 * Opens an investigation (OPEN, no conclusion) and its incident relations
 * atomically: every incident must belong to the route workspace, or nothing is written.
 */
export class CreateInvestigation {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(user: User, workspaceId: string, details: Omit<InvestigationDetails, 'conclusion'>): Promise<InvestigationView> {
    await this.access.requireManager(user, workspaceId);
    const investigation = Investigation.open(workspaceId, details);
    return this.unitOfWork.run(async (repositories) => {
      const view = await resolveIncidents(repositories.incidents, investigation);
      await repositories.investigations.insert(investigation);
      return view;
    });
  }
}

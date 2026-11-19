import { NotFoundError } from '@aegis/domain';
import { IncidentActivity } from '../../../domain/incident-activity.js';
import type { User } from '../../../domain/user.js';
import type { UnitOfWork } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';

/**
 * Physical delete (ADR-031), also for CLOSED investigations. The incident
 * relations go with it (ON DELETE CASCADE); the incidents themselves are
 * untouched, and each of them keeps an INVESTIGATION_UNLINKED entry with the
 * investigation's title in its history (ADR-054), written in the same transaction.
 */
export class DeleteInvestigation {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(user: User, workspaceId: string, investigationId: string): Promise<void> {
    await this.access.requireManager(user, workspaceId);
    await this.unitOfWork.run(async (repositories) => {
      const investigation = await repositories.investigations.findInWorkspace(workspaceId, investigationId);
      if (!investigation) throw new NotFoundError();
      const author = { kind: 'USER', userId: user.id } as const;
      const now = new Date();
      await repositories.incidentActivities.insertMany(
        investigation.incidentIds.map((incidentId) => IncidentActivity.investigation({ id: incidentId, workspaceId }, 'INVESTIGATION_UNLINKED', investigation, author, now)),
      );
      if (!(await repositories.investigations.deleteInWorkspace(workspaceId, investigationId))) throw new NotFoundError();
    });
  }
}

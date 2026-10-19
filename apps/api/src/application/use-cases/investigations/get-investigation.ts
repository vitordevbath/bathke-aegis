import { NotFoundError } from '@aegis/domain';
import type { User } from '../../../domain/user.js';
import type { Repositories } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';
import type { InvestigationView } from './investigation-view.js';

export class GetInvestigation {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly repositories: Pick<Repositories, 'investigations' | 'incidents'>,
  ) {}

  /** Missing investigation and investigation of another workspace are the same 404. */
  async execute(user: User, workspaceId: string, investigationId: string): Promise<InvestigationView> {
    await this.access.requireMember(user, workspaceId);
    const investigation = await this.repositories.investigations.findInWorkspace(workspaceId, investigationId);
    if (!investigation) throw new NotFoundError();
    const incidents = await this.repositories.incidents.findManyInWorkspace(workspaceId, investigation.incidentIds);
    return { investigation, incidents };
  }
}

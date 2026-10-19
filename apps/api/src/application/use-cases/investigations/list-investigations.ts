import type { Investigation } from '../../../domain/investigation.js';
import type { User } from '../../../domain/user.js';
import type { Page } from '../../pagination.js';
import type { InvestigationListFilter, InvestigationRepository } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';

export class ListInvestigations {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly investigations: InvestigationRepository,
  ) {}

  async execute(user: User, workspaceId: string, filter: InvestigationListFilter): Promise<Page<Investigation>> {
    await this.access.requireMember(user, workspaceId);
    return this.investigations.listInWorkspace(workspaceId, filter);
  }
}

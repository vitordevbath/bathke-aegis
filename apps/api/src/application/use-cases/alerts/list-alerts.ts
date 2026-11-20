import { NotFoundError } from '@aegis/domain';
import type { User } from '../../../domain/user.js';
import type { Page } from '../../pagination.js';
import type { AlertListFilter, AlertRepository, StoredAlert } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';

/** Any member reads alerts; nobody writes them (they come only from the detection engine, ADR-053). */
export class ListAlerts {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly alerts: AlertRepository,
  ) {}

  async execute(user: User, workspaceId: string, filter: AlertListFilter): Promise<Page<StoredAlert>> {
    await this.access.requireMember(user, workspaceId);
    return this.alerts.listInWorkspace(workspaceId, filter);
  }
}

export class GetAlert {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly alerts: AlertRepository,
  ) {}

  async execute(user: User, workspaceId: string, alertId: string): Promise<StoredAlert> {
    await this.access.requireMember(user, workspaceId);
    const alert = await this.alerts.findInWorkspace(workspaceId, alertId);
    if (!alert) throw new NotFoundError();
    return alert;
  }
}

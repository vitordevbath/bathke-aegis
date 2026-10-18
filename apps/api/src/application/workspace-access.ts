import { ForbiddenError, NotFoundError } from '@aegis/domain';
import type { Membership } from '../domain/membership.js';
import type { User } from '../domain/user.js';
import type { MembershipRepository } from './ports/repositories.js';

/**
 * Single place that turns (user, workspaceId) into a membership. A workspace
 * the user does not belong to is reported exactly like a missing one (404),
 * so its existence is never confirmed to outsiders.
 */
export class WorkspaceAccess {
  constructor(private readonly memberships: MembershipRepository) {}

  /** Any member may read the workspace's resources. */
  async requireMember(user: User, workspaceId: string): Promise<Membership> {
    const membership = await this.memberships.find(user.id, workspaceId);
    if (!membership) throw new NotFoundError();
    return membership;
  }

  /** Writes additionally require a role that can manage resources. */
  async requireManager(user: User, workspaceId: string): Promise<Membership> {
    const membership = await this.requireMember(user, workspaceId);
    if (!membership.canManageResources) throw new ForbiddenError();
    return membership;
  }
}

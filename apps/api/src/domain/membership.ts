import type { User } from './user.js';
import type { Workspace } from './workspace.js';

/** OWNER manages resources; VIEWER only reads (AEGIS DEMO, ADR-052); ADMIN/ANALYST are reserved for workspace sharing. */
export type MembershipRole = 'OWNER' | 'ADMIN' | 'ANALYST' | 'VIEWER';

export interface MembershipSnapshot {
  readonly userId: string;
  readonly workspaceId: string;
  readonly role: MembershipRole;
  readonly createdAt: Date;
}

/** Links a user to a workspace with a role. Identified by the (user, workspace) pair. */
export class Membership {
  private constructor(
    readonly userId: string,
    readonly workspaceId: string,
    readonly role: MembershipRole,
    readonly createdAt: Date,
  ) {}

  static grantOwner(user: User, workspace: Workspace, now: Date = new Date()): Membership {
    return new Membership(user.id, workspace.id, 'OWNER', now);
  }

  /** Read-only access, e.g. every account in the AEGIS DEMO workspace (ADR-052). */
  static grantViewer(user: User, workspace: Workspace, now: Date = new Date()): Membership {
    return new Membership(user.id, workspace.id, 'VIEWER', now);
  }

  static restore(snapshot: MembershipSnapshot): Membership {
    return new Membership(snapshot.userId, snapshot.workspaceId, snapshot.role, snapshot.createdAt);
  }

  /**
   * Create/update/delete workspace resources. Deny-by-default: only OWNER for
   * now; ADMIN/ANALYST/VIEWER get behavior when workspace sharing exists.
   */
  get canManageResources(): boolean {
    return this.role === 'OWNER';
  }

  toSnapshot(): MembershipSnapshot {
    return { userId: this.userId, workspaceId: this.workspaceId, role: this.role, createdAt: this.createdAt };
  }
}

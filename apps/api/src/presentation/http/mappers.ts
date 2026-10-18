import type { HostResponse, MeResponse, PaginatedResponse, UserResponse, WorkspaceSummary } from '@aegis/contracts';
import type { User } from '../../domain/user.js';
import type { AccountView } from '../../application/account-view.js';
import type { WorkspaceMembership } from '../../application/ports/repositories.js';
import type { Page } from '../../application/pagination.js';
import type { Host } from '../../domain/host.js';

/** Explicit allowlist of public user fields — the password hash can never slip through. */
export function toUserResponse(user: User): UserResponse {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    cpf: user.cpf,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export function toWorkspaceSummary({ workspace, membership }: WorkspaceMembership): WorkspaceSummary {
  return { id: workspace.id, name: workspace.name, kind: workspace.kind, role: membership.role };
}

export function toMeResponse(account: AccountView): MeResponse {
  return { user: toUserResponse(account.user), workspaces: account.workspaces.map(toWorkspaceSummary) };
}

export function toHostResponse(host: Host): HostResponse {
  const snapshot = host.toSnapshot();
  return {
    id: snapshot.id,
    workspaceId: snapshot.workspaceId,
    displayName: snapshot.displayName,
    description: snapshot.description,
    agentId: snapshot.agentId,
    hostname: snapshot.hostname,
    osName: snapshot.osName,
    osVersion: snapshot.osVersion,
    architecture: snapshot.architecture,
    connectionState: snapshot.connectionState,
    lastSeenAt: snapshot.lastSeenAt?.toISOString() ?? null,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
  };
}

/** The one place the generic pagination envelope is built. */
export function toPaginatedResponse<T, R>(page: Page<T>, map: (item: T) => R): PaginatedResponse<R> {
  return {
    items: page.items.map(map),
    pagination: {
      page: page.page,
      pageSize: page.pageSize,
      total: page.total,
      totalPages: Math.ceil(page.total / page.pageSize),
    },
  };
}

import type { MeResponse, UserResponse, WorkspaceSummary } from '@aegis/contracts';
import type { User } from '../../domain/user.js';
import type { AccountView } from '../../application/account-view.js';
import type { WorkspaceMembership } from '../../application/ports/repositories.js';

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

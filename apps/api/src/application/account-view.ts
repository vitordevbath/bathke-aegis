import type { User } from '../domain/user.js';
import type { WorkspaceMembership } from './ports/repositories.js';

/** What the application returns about an account: the user and the workspaces they belong to. */
export interface AccountView {
  readonly user: User;
  readonly workspaces: readonly WorkspaceMembership[];
}

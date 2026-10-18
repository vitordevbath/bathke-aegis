import type { User } from '../../domain/user.js';
import type { AccountView } from '../account-view.js';
import type { MembershipRepository } from '../ports/repositories.js';

export class GetCurrentUser {
  constructor(private readonly memberships: MembershipRepository) {}

  async execute(user: User): Promise<AccountView> {
    return { user, workspaces: await this.memberships.listForUser(user.id) };
  }
}

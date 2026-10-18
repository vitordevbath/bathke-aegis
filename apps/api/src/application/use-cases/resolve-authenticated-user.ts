import { AuthenticationError } from '@aegis/domain';
import type { User } from '../../domain/user.js';
import type { UserRepository } from '../ports/repositories.js';
import type { TokenService } from '../ports/token-service.js';

/**
 * Turns a bearer token into the current user. A cryptographically valid token
 * is not enough: the referenced user must still exist.
 */
export class ResolveAuthenticatedUser {
  constructor(
    private readonly tokens: TokenService,
    private readonly users: UserRepository,
  ) {}

  async execute(token: string): Promise<User> {
    const { userId } = await this.tokens.verify(token);
    const user = await this.users.findById(userId);
    if (!user) throw new AuthenticationError();
    return user;
  }
}

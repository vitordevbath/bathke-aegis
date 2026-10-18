import { randomUUID } from 'node:crypto';
import { AuthenticationError, Email } from '@aegis/domain';
import type { AccountView } from '../account-view.js';
import type { PasswordHasher } from '../ports/password-hasher.js';
import type { Repositories } from '../ports/repositories.js';
import type { IssuedToken, TokenService } from '../ports/token-service.js';

export const INVALID_CREDENTIALS_MESSAGE = 'Email ou senha inválidos.';

export interface AuthenticateUserInput {
  readonly email: string;
  readonly password: string;
}

export type Session = AccountView & IssuedToken;

/**
 * Login. Unknown email and wrong password produce the same error, and an
 * unknown email still pays for one Argon2 verification so response time does
 * not reveal which accounts exist.
 */
export class AuthenticateUser {
  private dummyHash: Promise<string> | undefined;

  constructor(
    private readonly repositories: Repositories,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
  ) {}

  async execute(input: AuthenticateUserInput): Promise<Session> {
    const user = Email.isValid(input.email) ? await this.repositories.users.findByEmail(Email.create(input.email)) : null;

    if (!user) {
      await this.hasher.verify(await this.getDummyHash(), input.password);
      throw new AuthenticationError(INVALID_CREDENTIALS_MESSAGE);
    }
    if (!(await this.hasher.verify(user.passwordHash, input.password))) {
      throw new AuthenticationError(INVALID_CREDENTIALS_MESSAGE);
    }

    const issued = await this.tokens.issue(user.id);
    const workspaces = await this.repositories.memberships.listForUser(user.id);
    return { ...issued, user, workspaces };
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hasher.hash(randomUUID());
    return this.dummyHash;
  }
}

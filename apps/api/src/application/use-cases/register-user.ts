import { ConflictError, Cpf, Email, PasswordPolicy } from '@aegis/domain';
import { User } from '../../domain/user.js';
import { Workspace } from '../../domain/workspace.js';
import { Membership } from '../../domain/membership.js';
import type { AccountView } from '../account-view.js';
import type { PasswordHasher } from '../ports/password-hasher.js';
import type { Repositories, UnitOfWork } from '../ports/repositories.js';

export interface RegisterUserInput {
  readonly name: string;
  readonly email: string;
  readonly cpf: string;
  readonly password: string;
}

export const EMAIL_TAKEN_MESSAGE = 'Este email já está cadastrado.';
export const CPF_TAKEN_MESSAGE = 'Este CPF já está cadastrado.';

/**
 * Creates a user, their personal workspace and the OWNER membership in a
 * single transaction. A user never exists without a workspace, and a personal
 * workspace never exists without its owner membership.
 */
export class RegisterUser {
  constructor(
    private readonly repositories: Repositories,
    private readonly unitOfWork: UnitOfWork,
    private readonly hasher: PasswordHasher,
  ) {}

  async execute(input: RegisterUserInput): Promise<AccountView> {
    const email = Email.create(input.email);
    const cpf = Cpf.create(input.cpf);
    PasswordPolicy.assert(input.password);

    // Friendly early checks; the unique constraints remain the final authority under races.
    if (await this.repositories.users.existsByEmail(email)) throw new ConflictError(EMAIL_TAKEN_MESSAGE, 'email');
    if (await this.repositories.users.existsByCpf(cpf)) throw new ConflictError(CPF_TAKEN_MESSAGE, 'cpf');

    const passwordHash = await this.hasher.hash(input.password);
    const user = User.register({ name: input.name, email, cpf, passwordHash });
    const workspace = Workspace.createPersonal(user);
    const membership = Membership.grantOwner(user, workspace);

    await this.unitOfWork.run(async ({ users, workspaces, memberships }) => {
      await users.insert(user);
      await workspaces.insert(workspace);
      await memberships.insert(membership);
    });

    return { user, workspaces: [{ workspace, membership }] };
  }
}

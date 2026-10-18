import { ConflictError, Cpf, PasswordPolicy, ValidationError } from '@aegis/domain';
import type { User } from '../../domain/user.js';
import type { AccountView } from '../account-view.js';
import type { PasswordHasher } from '../ports/password-hasher.js';
import type { Repositories } from '../ports/repositories.js';
import { CPF_TAKEN_MESSAGE } from './register-user.js';

export interface UpdateCurrentUserInput {
  readonly name: string;
  readonly cpf: string;
  readonly passwordChange?: { readonly currentPassword: string; readonly newPassword: string } | undefined;
}

export const WRONG_CURRENT_PASSWORD_MESSAGE = 'Senha atual incorreta.';

/**
 * Edits the authenticated user's own profile. The target is always the user
 * resolved from the token — there is no user id in the input — and the email
 * is not an editable field. Changing the password requires the current one.
 */
export class UpdateCurrentUser {
  constructor(
    private readonly repositories: Repositories,
    private readonly hasher: PasswordHasher,
  ) {}

  async execute(user: User, input: UpdateCurrentUserInput): Promise<AccountView> {
    const cpf = Cpf.create(input.cpf);
    if (cpf.value !== user.cpf && (await this.repositories.users.existsByCpf(cpf, user.id))) {
      throw new ConflictError(CPF_TAKEN_MESSAGE, 'cpf');
    }

    let newPasswordHash: string | undefined;
    if (input.passwordChange) {
      const { currentPassword, newPassword } = input.passwordChange;
      if (!(await this.hasher.verify(user.passwordHash, currentPassword))) {
        // 400 on the field, not 401: the session itself is valid.
        throw ValidationError.forField('currentPassword', WRONG_CURRENT_PASSWORD_MESSAGE);
      }
      PasswordPolicy.assert(newPassword, 'password');
      newPasswordHash = await this.hasher.hash(newPassword);
    }

    user.updateProfile({ name: input.name, cpf });
    if (newPasswordHash) user.changePasswordHash(newPasswordHash);
    await this.repositories.users.update(user);

    return { user, workspaces: await this.repositories.memberships.listForUser(user.id) };
  }
}

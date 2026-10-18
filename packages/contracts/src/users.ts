import { z } from 'zod';
import { PasswordPolicy } from '@aegis/domain';
import {
  CpfSchema,
  NameSchema,
  PASSWORD_MISMATCH_MESSAGE,
  UNKNOWN_FIELD_MESSAGE,
} from './fields.js';

export const WORKSPACE_KINDS = ['personal', 'demo', 'organization', 'lab'] as const;
export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number];

export const MEMBERSHIP_ROLES = ['OWNER', 'ADMIN', 'ANALYST', 'VIEWER'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

/** Public view of a user. Never includes the password hash. */
export interface UserResponse {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  /** 11 digits, no separators. */
  readonly cpf: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A workspace the user belongs to, with the user's role in it. */
export interface WorkspaceSummary {
  readonly id: string;
  readonly name: string;
  readonly kind: WorkspaceKind;
  readonly role: MembershipRole;
}

/** `200` body of `GET /users/me` and `PUT /users/me`. */
export interface MeResponse {
  readonly user: UserResponse;
  readonly workspaces: readonly WorkspaceSummary[];
}

export const EMAIL_IMMUTABLE_MESSAGE = 'O email não pode ser alterado.';

/**
 * Body of `PUT /users/me`. Identity comes from the token, never from the body:
 * `email`, `id` and `userId` are rejected. The password block is optional; when
 * any of its fields is filled, all three are required and the new password must
 * satisfy the policy and match its confirmation. Empty strings mean "unchanged".
 */
export const UpdateCurrentUserRequestSchema = z
  .object({
    name: NameSchema,
    cpf: CpfSchema,
    email: z.undefined({ invalid_type_error: EMAIL_IMMUTABLE_MESSAGE }).optional(),
    currentPassword: z.string().max(PasswordPolicy.MAX_LENGTH, 'Senha inválida.').optional(),
    password: z.string().optional(),
    passwordConfirmation: z.string().optional(),
  })
  .strict(UNKNOWN_FIELD_MESSAGE)
  .superRefine((data, ctx) => {
    if (!isChangingPassword(data)) return;
    if (!data.currentPassword) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['currentPassword'], message: 'Informe a senha atual.' });
    }
    if (!PasswordPolicy.isSatisfiedBy(data.password ?? '')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['password'], message: PasswordPolicy.MESSAGE });
    }
    if (data.password !== data.passwordConfirmation) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['passwordConfirmation'], message: PASSWORD_MISMATCH_MESSAGE });
    }
  })
  .transform((data) => ({
    name: data.name,
    cpf: data.cpf,
    passwordChange: isChangingPassword(data)
      ? { currentPassword: data.currentPassword ?? '', newPassword: data.password ?? '' }
      : undefined,
  }));

function isChangingPassword(data: { currentPassword?: string; password?: string; passwordConfirmation?: string }): boolean {
  return Boolean(data.currentPassword || data.password || data.passwordConfirmation);
}

export type UpdateCurrentUserRequest = z.input<typeof UpdateCurrentUserRequestSchema>;
export type UpdateCurrentUserCommand = z.output<typeof UpdateCurrentUserRequestSchema>;

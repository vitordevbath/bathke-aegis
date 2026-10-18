import { z } from 'zod';
import {
  CpfSchema,
  CurrentPasswordSchema,
  EmailSchema,
  NameSchema,
  NewPasswordSchema,
  PASSWORD_MISMATCH_MESSAGE,
  UNKNOWN_FIELD_MESSAGE,
} from './fields.js';
import type { MeResponse } from './users.js';

/** Body of `POST /auth/register`. `passwordConfirmation` is validated, never persisted. */
export const RegisterRequestSchema = z
  .object({
    name: NameSchema,
    email: EmailSchema,
    cpf: CpfSchema,
    password: NewPasswordSchema,
    passwordConfirmation: z.string({ required_error: 'Confirme a senha.' }),
  })
  .strict(UNKNOWN_FIELD_MESSAGE)
  .superRefine((data, ctx) => {
    if (data.password !== data.passwordConfirmation) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['passwordConfirmation'], message: PASSWORD_MISMATCH_MESSAGE });
    }
  });

export type RegisterRequest = z.input<typeof RegisterRequestSchema>;
export type RegisterCommand = z.output<typeof RegisterRequestSchema>;

/** Body of `POST /auth/login`. */
export const LoginRequestSchema = z
  .object({
    email: EmailSchema,
    password: CurrentPasswordSchema,
  })
  .strict(UNKNOWN_FIELD_MESSAGE);

export type LoginRequest = z.input<typeof LoginRequestSchema>;

/** `201` body of `POST /auth/register`. No token: the user signs in afterwards. */
export type RegisterResponse = MeResponse;

/** `200` body of `POST /auth/login`. */
export interface LoginResponse extends MeResponse {
  readonly token: string;
  readonly tokenType: 'Bearer';
  /** Token lifetime in seconds. */
  readonly expiresIn: number;
}

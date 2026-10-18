import { z } from 'zod';
import { Cpf, Email, PasswordPolicy } from '@aegis/domain';

/**
 * Field schemas shared by Aegis Web forms and Aegis API request validation.
 * Rules come from `@aegis/domain`; this module only adapts them to Zod.
 */

export const NameSchema = z
  .string({ required_error: 'Informe seu nome.' })
  .trim()
  .min(2, 'O nome deve ter ao menos 2 caracteres.')
  .max(120, 'O nome deve ter no máximo 120 caracteres.');

/** Trimmed, lower-cased, format-checked email. */
export const EmailSchema = z
  .string({ required_error: 'Informe seu email.' })
  .trim()
  .toLowerCase()
  .superRefine((value, ctx) => {
    if (value.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe seu email.' });
    else if (!Email.isValid(value)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe um email válido.' });
  });

/** Accepts `000.000.000-00` or 11 digits; outputs 11 digits. */
export const CpfSchema = z
  .string({ required_error: 'Informe seu CPF.' })
  .trim()
  .superRefine((value, ctx) => {
    if (value.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe seu CPF.' });
    else if (!Cpf.isValid(value)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe um CPF válido.' });
  })
  .transform((value) => Cpf.normalize(value));

/** A new password that must satisfy the strength policy. */
export const NewPasswordSchema = z
  .string({ required_error: 'Informe uma senha.' })
  .superRefine((value, ctx) => {
    if (!PasswordPolicy.isSatisfiedBy(value)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: PasswordPolicy.MESSAGE });
  });

/** An existing password typed by the user: required and bounded, never policy-checked. */
export const CurrentPasswordSchema = z
  .string({ required_error: 'Informe sua senha.' })
  .min(1, 'Informe sua senha.')
  .max(PasswordPolicy.MAX_LENGTH, 'Senha inválida.');

export const PASSWORD_MISMATCH_MESSAGE = 'As senhas não coincidem.';
export const UNKNOWN_FIELD_MESSAGE = 'Campo não permitido.';

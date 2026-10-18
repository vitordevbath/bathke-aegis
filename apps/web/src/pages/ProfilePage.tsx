import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  UpdateCurrentUserRequestSchema,
  type MeResponse,
  type UpdateCurrentUserCommand,
  type UpdateCurrentUserRequest,
} from '@aegis/contracts';
import { Cpf } from '@aegis/domain';
import { TextField } from '../components/TextField';
import { useAuth } from '../features/auth/AuthContext';
import { PasswordChecklist } from '../features/auth/PasswordChecklist';
import { applyApiError } from '../features/auth/form-errors';
import { apiRequest } from '../lib/api-client';

const FIELDS = ['name', 'cpf', 'currentPassword', 'password', 'passwordConfirmation'] as const;

type ProfileForm = UpdateCurrentUserRequest;

const formValuesFor = (account: MeResponse['user']): ProfileForm => ({
  name: account.name,
  cpf: Cpf.format(account.cpf),
  currentPassword: '',
  password: '',
  passwordConfirmation: '',
});

/**
 * Self-service profile. The email is shown but is not a form field, so it is
 * never part of the request; the API would reject it anyway.
 */
export function ProfilePage() {
  const { user, setAccount } = useAuth();
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    getValues,
    reset,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileForm, unknown, UpdateCurrentUserCommand>({
    resolver: zodResolver(UpdateCurrentUserRequestSchema),
    defaultValues: user ? formValuesFor(user) : undefined,
  });

  if (!user) return null;

  const onSubmit = handleSubmit(async () => {
    setFeedback(null);
    // Raw inputs (not the transformed command): the API re-validates and normalizes everything.
    const { name, cpf, currentPassword, password, passwordConfirmation } = getValues();
    try {
      const account = await apiRequest<MeResponse>('/users/me', {
        method: 'PUT',
        body: { name, cpf, currentPassword, password, passwordConfirmation },
      });
      setAccount(account);
      reset(formValuesFor(account.user));
      setFeedback({ kind: 'success', message: 'Perfil atualizado.' });
    } catch (error) {
      const message = applyApiError(error, setError, FIELDS, 'Não foi possível salvar agora. Tente novamente.');
      if (message) setFeedback({ kind: 'error', message });
    }
  });

  const cpfField = register('cpf');

  return (
    <main className="content content--narrow">
      <header className="page-header">
        <p className="eyebrow">Conta</p>
        <h1 className="title">Perfil</h1>
      </header>

      <form className="surface form form--wide" noValidate onSubmit={onSubmit}>
        <fieldset className="fieldset">
          <legend className="section-title">Dados pessoais</legend>
          <TextField label="Nome" autoComplete="name" error={errors.name?.message} {...register('name')} />
          <TextField
            label="Email"
            type="email"
            value={user.email}
            readOnly
            disabled
            hint={<small className="field__hint">O email não pode ser alterado.</small>}
          />
          <TextField
            label="CPF"
            inputMode="numeric"
            maxLength={14}
            error={errors.cpf?.message}
            {...cpfField}
            onChange={(event) => {
              event.target.value = Cpf.format(event.target.value);
              void cpfField.onChange(event);
            }}
          />
        </fieldset>

        <fieldset className="fieldset">
          <legend className="section-title">Alterar senha</legend>
          <p className="muted small">Deixe em branco para manter a senha atual.</p>
          <TextField
            label="Senha atual"
            type="password"
            autoComplete="current-password"
            error={errors.currentPassword?.message}
            {...register('currentPassword')}
          />
          <TextField
            label="Nova senha"
            type="password"
            autoComplete="new-password"
            error={errors.password?.message}
            hint={watch('password') ? <PasswordChecklist password={watch('password') ?? ''} /> : null}
            {...register('password')}
          />
          <TextField
            label="Confirmar nova senha"
            type="password"
            autoComplete="new-password"
            error={errors.passwordConfirmation?.message}
            {...register('passwordConfirmation')}
          />
        </fieldset>

        {feedback && (
          <p className={`notice notice--${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>
            {feedback.message}
          </p>
        )}
        <div className="form__actions">
          <button className="button button--primary" type="submit" disabled={isSubmitting || !isDirty}>
            {isSubmitting ? 'Salvando…' : 'Salvar alterações'}
          </button>
        </div>
      </form>
    </main>
  );
}

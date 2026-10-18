import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { RegisterRequestSchema, type RegisterCommand, type RegisterRequest, type RegisterResponse } from '@aegis/contracts';
import { Cpf } from '@aegis/domain';
import { AuthLayout } from '../components/AuthLayout';
import { TextField } from '../components/TextField';
import { PasswordChecklist } from '../features/auth/PasswordChecklist';
import { applyApiError } from '../lib/form-errors';
import { apiRequest } from '../lib/api-client';

const FIELDS = ['name', 'email', 'cpf', 'password', 'passwordConfirmation'] as const;

export function RegisterPage() {
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterRequest, unknown, RegisterCommand>({
    resolver: zodResolver(RegisterRequestSchema),
    defaultValues: { name: '', email: '', cpf: '', password: '', passwordConfirmation: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await apiRequest<RegisterResponse>('/auth/register', { method: 'POST', body: values, auth: false });
      // No automatic sign-in: the user confirms the new credentials on the login page.
      navigate('/login', { replace: true, state: { registered: true, email: values.email } });
    } catch (error) {
      setFormError(applyApiError(error, setError, FIELDS, 'Não foi possível criar a conta agora. Tente novamente.'));
    }
  });

  const cpfField = register('cpf');

  return (
    <AuthLayout
      title="Criar conta"
      subtitle="Seu workspace pessoal é criado junto com a conta."
      footer={
        <>
          Já tem conta? <Link to="/login">Entrar</Link>
        </>
      }
    >
      <form className="form" noValidate onSubmit={onSubmit}>
        <TextField label="Nome" autoComplete="name" error={errors.name?.message} {...register('name')} />
        <TextField label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <TextField
          label="CPF"
          inputMode="numeric"
          placeholder="000.000.000-00"
          maxLength={14}
          error={errors.cpf?.message}
          {...cpfField}
          onChange={(event) => {
            event.target.value = Cpf.format(event.target.value);
            void cpfField.onChange(event);
          }}
        />
        <TextField
          label="Senha"
          type="password"
          autoComplete="new-password"
          error={errors.password?.message}
          hint={<PasswordChecklist password={watch('password')} />}
          {...register('password')}
        />
        <TextField
          label="Confirmar senha"
          type="password"
          autoComplete="new-password"
          error={errors.passwordConfirmation?.message}
          {...register('passwordConfirmation')}
        />
        {formError && (
          <p className="notice notice--error" role="alert">
            {formError}
          </p>
        )}
        <button className="button button--primary button--block" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Criando conta…' : 'Criar conta'}
        </button>
      </form>
    </AuthLayout>
  );
}

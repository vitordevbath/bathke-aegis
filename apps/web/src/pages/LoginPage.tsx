import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoginRequestSchema, type LoginRequest } from '@aegis/contracts';
import { AuthLayout } from '../components/AuthLayout';
import { TextField } from '../components/TextField';
import { useAuth } from '../features/auth/AuthContext';
import { applyApiError } from '../features/auth/form-errors';
import { ApiError } from '../lib/api-client';

interface LoginLocationState {
  readonly registered?: boolean;
  readonly expired?: boolean;
  readonly email?: string;
}

export function LoginPage() {
  const { login } = useAuth();
  const state = (useLocation().state ?? {}) as LoginLocationState;
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequest>({
    resolver: zodResolver(LoginRequestSchema),
    defaultValues: { email: state.email ?? '', password: '' },
  });

  // On success the session changes and GuestRoute performs the redirect.
  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login(values);
    } catch (error) {
      setFormError(
        error instanceof ApiError && error.status === 401
          ? 'Email ou senha inválidos.'
          : applyApiError(error, setError, ['email', 'password'], 'Não foi possível entrar agora. Tente novamente.'),
      );
    }
  });

  const notice = state.registered
    ? 'Conta criada com sucesso. Entre com seu email e senha.'
    : state.expired
      ? 'Sua sessão expirou. Entre novamente.'
      : null;

  return (
    <AuthLayout
      title="Entrar"
      subtitle="Acesse seu workspace no Aegis."
      footer={
        <>
          Ainda não tem conta? <Link to="/cadastro">Criar conta</Link>
        </>
      }
    >
      <form className="form" noValidate onSubmit={onSubmit}>
        {notice && (
          <p className="notice notice--success" role="status">
            {notice}
          </p>
        )}
        <TextField label="Email" type="email" autoComplete="username" error={errors.email?.message} {...register('email')} />
        <TextField
          label="Senha"
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />
        {formError && (
          <p className="notice notice--error" role="alert">
            {formError}
          </p>
        )}
        <button className="button button--primary button--block" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </AuthLayout>
  );
}

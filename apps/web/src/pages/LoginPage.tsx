import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Brand } from '../components/Brand';

const LoginSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

type LoginForm = z.infer<typeof LoginSchema>;

/**
 * PLACEHOLDER: validates input client-side only. Authentication against
 * Aegis API (JWT) is implemented in BF 02.
 */
export function LoginPage() {
  const { register, handleSubmit, formState } = useForm<LoginForm>({ resolver: zodResolver(LoginSchema) });

  return (
    <main className="center-page">
      <Brand />
      <form className="surface form" noValidate onSubmit={handleSubmit(() => undefined)}>
        <h1 className="title title--sm">Sign in</h1>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="username" {...register('email')} />
          {formState.errors.email && <small className="field__error">{formState.errors.email.message}</small>}
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" {...register('password')} />
          {formState.errors.password && <small className="field__error">{formState.errors.password.message}</small>}
        </label>
        <button className="button button--primary" type="submit" disabled>
          Sign in
        </button>
        <p className="muted small">Authentication is not implemented yet (planned for BF 02).</p>
      </form>
    </main>
  );
}

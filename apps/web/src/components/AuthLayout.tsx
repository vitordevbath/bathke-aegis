import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Brand } from './Brand';

/** Centered card used by sign-in and sign-up. */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <main className="auth">
      <div className="auth__panel">
        <Link to="/" className="auth__brand" aria-label="Página inicial">
          <Brand />
        </Link>
        <section className="surface auth__card" aria-labelledby="auth-title">
          <header className="auth__header">
            <h1 id="auth-title" className="title title--sm">
              {title}
            </h1>
            <p className="muted">{subtitle}</p>
          </header>
          {children}
        </section>
        <p className="auth__footer muted">{footer}</p>
      </div>
    </main>
  );
}

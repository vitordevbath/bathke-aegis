import { useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Brand } from './Brand';
import { StudioMark } from './StudioMark';
import { SignalField } from '../features/landing/SignalField';
import '../styles/auth.css';

/**
 * Sign-in and sign-up: the form on the left, the public site's contour field on the right, so the
 * step between the site and the panel keeps one visual identity. Loaded lazily with its pages,
 * like the site, so WebGL never enters the panel bundle (ADR-015, ADR-050).
 */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  const still = useRef(0);

  return (
    <main className="auth2">
      <div className="auth2__form">
        <Link to="/" className="auth2__brand" aria-label="Página inicial">
          <Brand />
        </Link>
        <section className="auth2__card" aria-labelledby="auth-title">
          <header className="auth2__header">
            <h1 id="auth-title" className="auth2__title">
              {title}
            </h1>
            <p className="auth2__subtitle">{subtitle}</p>
          </header>
          {children}
          <p className="auth2__footer">{footer}</p>
        </section>
        <p className="auth2__legal">Use apenas em máquinas próprias ou explicitamente autorizadas.</p>
        <StudioMark floating />
      </div>
      <aside className="auth2__art" aria-hidden="true">
        <SignalField scroll={still} />
        <p className="auth2__quote">
          Pareie uma máquina em minutos.
          <span>Revogue o acesso quando quiser.</span>
        </p>
      </aside>
    </main>
  );
}

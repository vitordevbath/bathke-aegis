import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Brand } from '../../components/Brand';

export const LANDING_SECTIONS = [
  { id: 'como-funciona', label: 'Como funciona' },
  { id: 'privacidade', label: 'Privacidade' },
  { id: 'estado', label: 'Estado do projeto' },
] as const;

/**
 * Transparent over the hero, a frosted bar once the page scrolls. The section in view is marked
 * with `aria-current`, so the bar also tells where you are on the page.
 */
export function LandingNav({ authenticated }: { readonly authenticated: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setCurrent(entry.target.id);
          else setCurrent((value) => (value === entry.target.id ? null : value));
        }
      },
      { rootMargin: '-40% 0px -55% 0px' },
    );
    for (const section of LANDING_SECTIONS) {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <header className={`lp-nav${scrolled ? ' lp-nav--scrolled' : ''}`}>
      <Link to="/" className="lp-nav__brand" aria-label="AEGIS — início">
        <Brand />
      </Link>
      <nav className="lp-nav__links" aria-label="Seções">
        {LANDING_SECTIONS.map((section) => (
          <a key={section.id} href={`#${section.id}`} className="lp-nav__link" aria-current={current === section.id ? 'location' : undefined}>
            {section.label}
          </a>
        ))}
      </nav>
      <div className="lp-nav__actions">
        {authenticated ? (
          <Link to="/dashboard" className="lp-button lp-button--solid">
            Abrir o painel
          </Link>
        ) : (
          <>
            <Link to="/login" className="lp-nav__link">
              Entrar
            </Link>
            <Link to="/cadastro" className="lp-button lp-button--solid">
              Criar conta
            </Link>
          </>
        )}
      </div>
    </header>
  );
}

import { Link, NavLink, Outlet } from 'react-router-dom';
import { Brand } from './Brand';
import { useAuth } from '../features/auth/AuthContext';
import { WorkspaceSelector } from '../features/workspaces/WorkspaceSelector';

const DESTINATIONS = [
  { to: '/dashboard', label: 'Painel' },
  { to: '/hosts', label: 'Hosts' },
  { to: '/eventos', label: 'Eventos' },
  { to: '/regras', label: 'Regras' },
  { to: '/incidentes', label: 'Incidentes' },
  { to: '/investigacoes', label: 'Investigações' },
] as const;

/** Up to two initials, for the account button. */
export function initialsOf(name: string | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * Layout of the authenticated area: brand, the six work areas, workspace, account and sign-out.
 * The profile is reached from the account button rather than a seventh navigation item.
 * Route changes use the View Transitions API where the browser supports it (a short crossfade).
 */
export function AppShell() {
  const { user, logout } = useAuth();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar__start">
          <Link to="/dashboard" className="topbar__brand" aria-label="AEGIS — Painel" viewTransition>
            <Brand />
          </Link>
          <nav className="nav" aria-label="Principal">
            {DESTINATIONS.map((destination) => (
              <NavLink key={destination.to} to={destination.to} className="nav__link" viewTransition>
                {destination.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="topbar__end">
          <WorkspaceSelector />
          <NavLink to="/perfil" className="account" title={user?.name} aria-label={`Perfil de ${user?.name ?? 'usuário'}`} viewTransition>
            <span className="account__avatar" aria-hidden="true">
              {initialsOf(user?.name)}
            </span>
          </NavLink>
          <button type="button" className="button button--ghost" onClick={logout}>
            Sair
          </button>
        </div>
      </header>
      <Outlet />
    </div>
  );
}

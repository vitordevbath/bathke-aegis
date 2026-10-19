import { NavLink, Outlet } from 'react-router-dom';
import { Brand } from './Brand';
import { useAuth } from '../features/auth/AuthContext';
import { WorkspaceSelector } from '../features/workspaces/WorkspaceSelector';

/** Layout of the authenticated area: navigation, current user and sign-out. */
export function AppShell() {
  const { user, logout } = useAuth();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar__start">
          <Brand />
          <nav className="nav" aria-label="Principal">
            <NavLink to="/dashboard" className="nav__link">
              Painel
            </NavLink>
            <NavLink to="/hosts" className="nav__link">
              Hosts
            </NavLink>
            <NavLink to="/regras" className="nav__link">
              Regras
            </NavLink>
            <NavLink to="/incidentes" className="nav__link">
              Incidentes
            </NavLink>
            <NavLink to="/investigacoes" className="nav__link">
              Investigações
            </NavLink>
            <NavLink to="/perfil" className="nav__link">
              Perfil
            </NavLink>
          </nav>
        </div>
        <div className="topbar__end">
          <WorkspaceSelector />
          <span className="identity__name">{user?.name}</span>
          <button type="button" className="button button--ghost" onClick={logout}>
            Sair
          </button>
        </div>
      </header>
      <Outlet />
    </div>
  );
}

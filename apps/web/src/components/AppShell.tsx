import { NavLink, Outlet } from 'react-router-dom';
import { Brand } from './Brand';
import { useAuth } from '../features/auth/AuthContext';

/** Layout of the authenticated area: navigation, current user and sign-out. */
export function AppShell() {
  const { user, workspaces, logout } = useAuth();
  const workspace = workspaces[0];

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar__start">
          <Brand />
          <nav className="nav" aria-label="Principal">
            <NavLink to="/dashboard" className="nav__link">
              Painel
            </NavLink>
            <NavLink to="/perfil" className="nav__link">
              Perfil
            </NavLink>
          </nav>
        </div>
        <div className="topbar__end">
          <div className="identity">
            <span className="identity__name">{user?.name}</span>
            {workspace && <span className="identity__workspace">{workspace.name}</span>}
          </div>
          <button type="button" className="button button--ghost" onClick={logout}>
            Sair
          </button>
        </div>
      </header>
      <Outlet />
    </div>
  );
}

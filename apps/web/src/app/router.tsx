import type { ComponentType } from 'react';
import { Outlet, createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AuthProvider } from '../features/auth/AuthContext';
import { GuestRoute, ProtectedRoute } from '../features/auth/route-guards';
import { AppShell } from '../components/AppShell';
import { PageLoader } from '../components/PageLoader';
import { WorkspaceProvider } from '../features/workspaces/WorkspaceContext';
import { HomePage } from '../pages/HomePage';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import { DashboardPage } from '../pages/DashboardPage';
import { ProfilePage } from '../pages/ProfilePage';
import { NotFoundPage } from '../pages/NotFoundPage';

/** Code-splits CRUD screens: each resource's pages load on first visit. */
function page<M extends Record<string, ComponentType>>(load: () => Promise<M>, name: keyof M & string) {
  return async () => ({ Component: (await load())[name] });
}

/** Exported separately so tests can mount the same tree in a memory router. */
export const routes: RouteObject[] = [
  {
    // Shown while a lazily loaded route is fetched on first navigation.
    hydrateFallbackElement: <PageLoader />,
    element: (
      <AuthProvider>
        <Outlet />
      </AuthProvider>
    ),
    children: [
      { path: '/', element: <HomePage /> },
      {
        element: <GuestRoute />,
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/cadastro', element: <RegisterPage /> },
        ],
      },
      {
        element: <ProtectedRoute />,
        children: [
          {
            element: (
              <WorkspaceProvider>
                <AppShell />
              </WorkspaceProvider>
            ),
            children: [
              { path: '/dashboard', element: <DashboardPage /> },
              { path: '/perfil', element: <ProfilePage /> },
              // Create and edit are separate screens (rubric), sharing HostForm.
              { path: '/hosts', lazy: page(() => import('../pages/hosts/HostsPage'), 'HostsPage') },
              { path: '/hosts/novo', lazy: page(() => import('../pages/hosts/CreateHostPage'), 'CreateHostPage') },
              { path: '/hosts/:hostId', lazy: page(() => import('../pages/hosts/HostDetailPage'), 'HostDetailPage') },
              { path: '/hosts/:hostId/editar', lazy: page(() => import('../pages/hosts/EditHostPage'), 'EditHostPage') },
              { path: '/regras', lazy: page(() => import('../pages/rules/RulesPage'), 'RulesPage') },
              { path: '/regras/nova', lazy: page(() => import('../pages/rules/CreateRulePage'), 'CreateRulePage') },
              { path: '/regras/:ruleId', lazy: page(() => import('../pages/rules/RuleDetailPage'), 'RuleDetailPage') },
              { path: '/regras/:ruleId/editar', lazy: page(() => import('../pages/rules/EditRulePage'), 'EditRulePage') },
            ],
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);

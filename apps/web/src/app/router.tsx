import { Outlet, createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AuthProvider } from '../features/auth/AuthContext';
import { GuestRoute, ProtectedRoute } from '../features/auth/route-guards';
import { AppShell } from '../components/AppShell';
import { WorkspaceProvider } from '../features/workspaces/WorkspaceContext';
import { HomePage } from '../pages/HomePage';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import { DashboardPage } from '../pages/DashboardPage';
import { ProfilePage } from '../pages/ProfilePage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { HostsPage } from '../pages/hosts/HostsPage';
import { CreateHostPage } from '../pages/hosts/CreateHostPage';
import { HostDetailPage } from '../pages/hosts/HostDetailPage';
import { EditHostPage } from '../pages/hosts/EditHostPage';

/** Exported separately so tests can mount the same tree in a memory router. */
export const routes: RouteObject[] = [
  {
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
              { path: '/hosts', element: <HostsPage /> },
              { path: '/hosts/novo', element: <CreateHostPage /> },
              { path: '/hosts/:hostId', element: <HostDetailPage /> },
              { path: '/hosts/:hostId/editar', element: <EditHostPage /> },
            ],
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);

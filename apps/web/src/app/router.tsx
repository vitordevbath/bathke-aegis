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
            ],
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);

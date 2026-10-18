import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { PageLoader } from '../../components/PageLoader';

/** Authenticated area. Anonymous visitors go to `/login`, remembering where they wanted to go. */
export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <PageLoader />;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

/**
 * Login and sign-up. Signed-in users are sent to the page they originally
 * asked for (or the dashboard) — this is also the post-login redirect.
 */
export function GuestRoute() {
  const { status } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: unknown } | null)?.from;

  if (status === 'loading') return <PageLoader />;
  if (status === 'authenticated') return <Navigate to={safeRedirectPath(from)} replace />;
  return <Outlet />;
}

/** Only same-app absolute paths are accepted as post-login destinations. */
export function safeRedirectPath(candidate: unknown): string {
  return typeof candidate === 'string' && candidate.startsWith('/') && !candidate.startsWith('//') ? candidate : '/dashboard';
}

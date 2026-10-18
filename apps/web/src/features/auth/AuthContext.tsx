import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LoginRequest, LoginResponse, MeResponse, UserResponse, WorkspaceSummary } from '@aegis/contracts';
import { apiRequest, setUnauthorizedHandler } from '../../lib/api-client';
import { authStorage } from '../../lib/auth-storage';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  readonly status: AuthStatus;
  readonly user: UserResponse | null;
  readonly workspaces: readonly WorkspaceSummary[];
  login(credentials: LoginRequest): Promise<void>;
  logout(): void;
  /** Replaces the cached account after a profile update. */
  setAccount(account: MeResponse): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const ME_QUERY_KEY = ['users', 'me'] as const;

/**
 * Global session state. The token is read from storage once; `/users/me`
 * restores the user after a reload. A 401 on any authenticated call clears
 * the session and sends the user to `/login`.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [token, setToken] = useState<string | null>(() => authStorage.getToken());

  const me = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => apiRequest<MeResponse>('/users/me'),
    enabled: token !== null,
    retry: false,
    staleTime: 60_000,
  });

  const clearSession = useCallback(() => {
    authStorage.clearToken();
    setToken(null);
    queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
  }, [queryClient]);

  useEffect(
    () =>
      setUnauthorizedHandler(() => {
        clearSession();
        navigate('/login', { replace: true, state: { expired: true } });
      }),
    [clearSession, navigate],
  );

  const login = useCallback(
    async (credentials: LoginRequest) => {
      const session = await apiRequest<LoginResponse>('/auth/login', { method: 'POST', body: credentials, auth: false });
      authStorage.setToken(session.token);
      queryClient.setQueryData<MeResponse>(ME_QUERY_KEY, { user: session.user, workspaces: session.workspaces });
      setToken(session.token);
    },
    [queryClient],
  );

  const logout = useCallback(() => {
    clearSession();
    navigate('/login', { replace: true });
  }, [clearSession, navigate]);

  const setAccount = useCallback(
    (account: MeResponse) => queryClient.setQueryData<MeResponse>(ME_QUERY_KEY, account),
    [queryClient],
  );

  const status: AuthStatus = token === null || me.isError ? 'anonymous' : me.data ? 'authenticated' : 'loading';

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: status === 'authenticated' ? (me.data?.user ?? null) : null,
      workspaces: status === 'authenticated' ? (me.data?.workspaces ?? []) : [],
      login,
      logout,
      setAccount,
    }),
    [status, me.data, login, logout, setAccount],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAuthStatus, getGetAuthStatusQueryKey, logout, type Account, type AuthStatus } from '@workspace/api-client-react';

// The signed-in portal user. The login itself is an HttpOnly cookie set by
// the relay, so this page never sees or stores the session token.

type AuthValue = {
  user: Account;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth needs a signed-in user');
  return value;
}

export const raLabel = (raId: string) => `RA-${raId}`;

export function statusOf(reason: unknown) {
  return typeof reason === 'object' && reason !== null && 'status' in reason ? (reason as { status: number }).status : undefined;
}

// The relay's own error text when it sent one, otherwise the fallback.
export function errorText(reason: unknown, fallback: string) {
  if (typeof reason === 'object' && reason !== null && 'data' in reason) {
    const data = (reason as { data: unknown }).data;
    if (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string') {
      return (data as { error: string }).error;
    }
  }
  return statusOf(reason) === undefined ? 'Could not reach the relay. Check your connection and try again.' : fallback;
}

export function useAuthStatus() {
  return useQuery<AuthStatus>({
    queryKey: getGetAuthStatusQueryKey(),
    queryFn: () => getAuthStatus(),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: 2,
  });
}

export function AuthProvider({ user, children }: { user: Account; children: ReactNode }) {
  const client = useQueryClient();
  const refresh = useCallback(async () => {
    await client.invalidateQueries({ queryKey: getGetAuthStatusQueryKey() });
  }, [client]);
  const signOut = useCallback(async () => {
    try { await logout(); } catch { /* the cookie is cleared or already gone */ }
    client.clear();
    await client.invalidateQueries({ queryKey: getGetAuthStatusQueryKey() });
  }, [client]);
  return <AuthContext.Provider value={{ user, refresh, signOut }}>{children}</AuthContext.Provider>;
}

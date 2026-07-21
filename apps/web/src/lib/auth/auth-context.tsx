'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loginRequest } from './api-client';

export interface AuthUser {
  id: string;
  email: string;
  rol: string;
  sindicatoId: string | null;
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const STORAGE_KEY = 'quivo.session';

/**
 * Bypass de desarrollo: simula una sesión sin backend real de auth (QUI-219 pendiente).
 * Nunca activo en producción — solo si NODE_ENV !== "production" Y la env var está en "true".
 */
const DEV_BYPASS_USER: AuthUser = {
  id: 'dev-bypass',
  email: 'dev@quivo.local',
  rol: 'admin_quivo',
  sindicatoId: null,
};

function isDevBypassEnabled(): boolean {
  return (
    process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === 'true'
  );
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (isDevBypassEnabled()) {
      setState({ user: DEV_BYPASS_USER, token: 'dev-bypass-token', loading: false, error: null });
      return;
    }

    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { user: AuthUser; token: string };
      setState({ user: parsed.user, token: parsed.token, loading: false, error: null });
    } else {
      setState((s) => ({ ...s, loading: false }));
    }
  }, []);

  const login = async (email: string, password: string): Promise<void> => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const response = await loginRequest(email, password);
      const user: AuthUser = response.user;
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ user, token: response.accessToken }),
      );
      setState({ user, token: response.accessToken, loading: false, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido al iniciar sesión';
      setState((s) => ({ ...s, loading: false, error: message }));
      throw err;
    }
  };

  const logout = (): void => {
    window.localStorage.removeItem(STORAGE_KEY);
    setState({ user: null, token: null, loading: false, error: null });
  };

  const value = useMemo<AuthContextValue>(() => ({ ...state, login, logout }), [state]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  }
  return ctx;
}

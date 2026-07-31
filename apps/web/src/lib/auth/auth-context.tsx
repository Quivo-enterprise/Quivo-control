'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { loginRequest, logoutRequest, refreshRequest } from './api-client';
import { getJwtExpiryMs } from './jwt';

export interface AuthUser {
  id: string;
  email: string;
  rol: string;
  sindicatoId: string | null;
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  refreshToken: string | null;
  loading: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /** `true` solo bajo el bypass de desarrollo — habilita el selector de rol de demo. */
  isDevBypass: boolean;
  /** Cambia el usuario simulado (solo tiene efecto bajo el bypass de desarrollo). */
  switchDevBypassRole: (rol: string) => void;
}

const STORAGE_KEY = 'quivo.session';
/** Margen antes de `exp` para disparar el refresh, evitando quedar sin sesión a mitad de una acción. */
const REFRESH_MARGIN_MS = 30_000;

/**
 * Bypass de desarrollo: simula una sesión sin backend real de auth (QUI-219 pendiente).
 * Nunca activo en producción — solo si NODE_ENV !== "production" Y la env var está en "true".
 * Dos usuarios simulados (no solo uno) para poder probar en vivo el guard por rol
 * (RNF-16: admin_sindicato no ve Sindicatos ni puede entrar por URL).
 */
const DEV_BYPASS_ROLE_KEY = 'quivo.dev-bypass-role';
const DEV_BYPASS_USERS: Record<string, AuthUser> = {
  admin_quivo: {
    id: 'dev-bypass-quivo',
    email: 'dev@quivo.local',
    rol: 'admin_quivo',
    sindicatoId: null,
  },
  admin_sindicato: {
    id: 'dev-bypass-sindicato',
    email: 'dev@sindicato1demayo.local',
    rol: 'admin_sindicato',
    sindicatoId: 's-1',
  },
};
const DEFAULT_DEV_BYPASS_ROLE = 'admin_quivo';

function isDevBypassEnabled(): boolean {
  return (
    process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === 'true'
  );
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface StoredSession {
  user: AuthUser | null;
  token: string | null;
  refreshToken: string | null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    refreshToken: null,
    loading: true,
    error: null,
  });

  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef = useRef<StoredSession>({ user: null, token: null, refreshToken: null });
  const scheduleRefreshRef = useRef<(token: string, refreshTokenValue: string) => void>(() => {});

  const clearScheduledRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = null;
    }
  }, []);

  const clearSession = useCallback(() => {
    clearScheduledRefresh();
    sessionRef.current = { user: null, token: null, refreshToken: null };
    window.localStorage.removeItem(STORAGE_KEY);
    setState({ user: null, token: null, refreshToken: null, loading: false, error: null });
  }, [clearScheduledRefresh]);

  const persistSession = useCallback(
    (user: AuthUser, token: string, refreshTokenValue: string) => {
      sessionRef.current = { user, token, refreshToken: refreshTokenValue };
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ user, token, refreshToken: refreshTokenValue }),
      );
      setState({ user, token, refreshToken: refreshTokenValue, loading: false, error: null });
    },
    [],
  );

  const performRefresh = useCallback(
    async (refreshTokenValue: string) => {
      try {
        const response = await refreshRequest(refreshTokenValue);
        const user = sessionRef.current.user;
        if (!user) {
          clearSession();
          return;
        }
        persistSession(user, response.accessToken, response.refreshToken);
        scheduleRefreshRef.current(response.accessToken, response.refreshToken);
      } catch {
        // El refresh token expiró o la API lo rechazó: no hay forma de renovar, cerrar sesión.
        clearSession();
      }
    },
    [clearSession, persistSession],
  );

  const scheduleRefresh = useCallback(
    (token: string, refreshTokenValue: string) => {
      clearScheduledRefresh();
      const expiryMs = getJwtExpiryMs(token);
      if (expiryMs === null) {
        return; // token opaco (ej. bypass de desarrollo) — no se puede programar
      }
      const delay = Math.max(expiryMs - Date.now() - REFRESH_MARGIN_MS, 0);
      refreshTimeoutRef.current = setTimeout(() => {
        void performRefresh(refreshTokenValue);
      }, delay);
    },
    [clearScheduledRefresh, performRefresh],
  );

  useEffect(() => {
    scheduleRefreshRef.current = scheduleRefresh;
  }, [scheduleRefresh]);

  useEffect(() => {
    if (isDevBypassEnabled()) {
      const storedRole = window.localStorage.getItem(DEV_BYPASS_ROLE_KEY) ?? DEFAULT_DEV_BYPASS_ROLE;
      const bypassUser =
        DEV_BYPASS_USERS[storedRole] ?? (DEV_BYPASS_USERS[DEFAULT_DEV_BYPASS_ROLE] as AuthUser);
      sessionRef.current = { user: bypassUser, token: 'dev-bypass-token', refreshToken: null };
      setState({
        user: bypassUser,
        token: 'dev-bypass-token',
        refreshToken: null,
        loading: false,
        error: null,
      });
      return;
    }

    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { user: AuthUser; token: string; refreshToken?: string };
      const refreshTokenValue = parsed.refreshToken ?? null;
      sessionRef.current = { user: parsed.user, token: parsed.token, refreshToken: refreshTokenValue };
      setState({
        user: parsed.user,
        token: parsed.token,
        refreshToken: refreshTokenValue,
        loading: false,
        error: null,
      });
      if (refreshTokenValue) {
        scheduleRefresh(parsed.token, refreshTokenValue);
      }
    } else {
      setState((s) => ({ ...s, loading: false }));
    }

    return () => clearScheduledRefresh();
  }, [scheduleRefresh, clearScheduledRefresh]);

  const login = async (email: string, password: string): Promise<void> => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const response = await loginRequest(email, password);
      persistSession(response.user, response.accessToken, response.refreshToken);
      scheduleRefresh(response.accessToken, response.refreshToken);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido al iniciar sesión';
      setState((s) => ({ ...s, loading: false, error: message }));
      throw err;
    }
  };

  const logout = (): void => {
    // QUI-251: revocar la sesión server-side es best-effort — no bloquea el cierre de
    // sesión local si la API no responde (offline, token ya vencido, etc.), pero cuando
    // sí funciona, el `refreshToken` deja de servir aunque alguien lo haya copiado antes.
    const { refreshToken } = sessionRef.current;
    if (refreshToken) {
      void logoutRequest(refreshToken).catch(() => {
        // Nada que hacer si falla — el cierre de sesión local igual continúa.
      });
    }
    clearSession();
  };

  const isDevBypass = isDevBypassEnabled();

  const switchDevBypassRole = (rol: string): void => {
    if (!isDevBypass) {
      return;
    }
    const bypassUser = DEV_BYPASS_USERS[rol];
    if (!bypassUser) {
      return;
    }
    window.localStorage.setItem(DEV_BYPASS_ROLE_KEY, rol);
    sessionRef.current = { user: bypassUser, token: 'dev-bypass-token', refreshToken: null };
    setState((s) => ({ ...s, user: bypassUser }));
  };

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, logout, isDevBypass, switchDevBypassRole }),
    [state, isDevBypass],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  }
  return ctx;
}

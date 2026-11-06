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
import { loginRequest, logoutRequest, RefreshHttpError, refreshRequest } from './api-client';
import { getJwtExpiryMs } from './jwt';
import { decidirTrasFalloRefresh, retryDelayMs } from './refresh-policy';

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

/** Access token vencido o dentro del margen de refresh (los opacos no se pueden evaluar). */
function necesitaRefresh(token: string): boolean {
  const expiryMs = getJwtExpiryMs(token);
  return expiryMs !== null && expiryMs - Date.now() <= REFRESH_MARGIN_MS;
}

function leerSesionGuardada(): StoredSession | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

/** Serializa el check-and-refresh entre pestañas del mismo origen; sin Web Locks corre directo
 * (la relectura de `localStorage` dentro de la sección reduce, pero no elimina, la carrera). */
async function conLockEntrePestanias(fn: () => Promise<void>): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    await navigator.locks.request('quivo.auth.refresh', fn);
    return;
  }
  await fn();
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
  const scheduleRefreshRef = useRef<(token: string) => void>(() => {});
  const performRefreshRef = useRef<() => Promise<void>>(async () => {});
  const refrescandoRef = useRef(false);
  /** Reintentos consecutivos fallidos por red/5xx; >0 significa que hay un reintento pendiente. */
  const retryAttemptRef = useRef(0);

  const clearScheduledRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = null;
    }
  }, []);

  const clearSession = useCallback(() => {
    clearScheduledRefresh();
    sessionRef.current = { user: null, token: null, refreshToken: null };
    retryAttemptRef.current = 0;
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

  const performRefresh = useCallback(async () => {
    if (refrescandoRef.current) {
      return;
    }
    refrescandoRef.current = true;
    try {
      await conLockEntrePestanias(async () => {
        // Se relee el storage ya dentro del lock: otra pestaña pudo rotar la sesión mientras
        // esperábamos, y mandar el refresh token viejo es lo que provocaba los 401 en cascada.
        const stored = leerSesionGuardada();
        if (
          !sessionRef.current.refreshToken ||
          !stored?.user ||
          !stored.token ||
          !stored.refreshToken
        ) {
          return; // sin sesión local, o cerrada en otra pestaña (el listener de `storage` lo replica)
        }
        if (!necesitaRefresh(stored.token)) {
          persistSession(stored.user, stored.token, stored.refreshToken);
          scheduleRefreshRef.current(stored.token);
          return;
        }
        try {
          const response = await refreshRequest(stored.refreshToken);
          if (!sessionRef.current.user) {
            return; // se cerró sesión mientras el request estaba en vuelo: no resucitarla
          }
          retryAttemptRef.current = 0;
          persistSession(stored.user, response.accessToken, response.refreshToken);
          scheduleRefreshRef.current(response.accessToken);
        } catch (error) {
          if (!sessionRef.current.user) {
            return;
          }
          const status = error instanceof RefreshHttpError ? error.status : null;
          if (decidirTrasFalloRefresh(status) === 'logout') {
            // 401 real: la API rechazó el refresh token, no hay forma de renovar.
            clearSession();
            return;
          }
          // Red caída, 5xx u otro fallo transitorio: se conserva la sesión y se reintenta.
          clearScheduledRefresh();
          refreshTimeoutRef.current = setTimeout(
            () => void performRefreshRef.current(),
            retryDelayMs(retryAttemptRef.current++),
          );
        }
      });
    } finally {
      refrescandoRef.current = false;
    }
  }, [clearScheduledRefresh, clearSession, persistSession]);

  const scheduleRefresh = useCallback(
    (token: string) => {
      clearScheduledRefresh();
      const expiryMs = getJwtExpiryMs(token);
      if (expiryMs === null) {
        return; // token opaco (ej. bypass de desarrollo) — no se puede programar
      }
      const delay = Math.max(expiryMs - Date.now() - REFRESH_MARGIN_MS, 0);
      refreshTimeoutRef.current = setTimeout(() => {
        void performRefreshRef.current();
      }, delay);
    },
    [clearScheduledRefresh],
  );

  useEffect(() => {
    performRefreshRef.current = performRefresh;
  }, [performRefresh]);

  useEffect(() => {
    scheduleRefreshRef.current = scheduleRefresh;
  }, [scheduleRefresh]);

  useEffect(() => {
    if (isDevBypassEnabled()) {
      const storedRole =
        window.localStorage.getItem(DEV_BYPASS_ROLE_KEY) ?? DEFAULT_DEV_BYPASS_ROLE;
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
      sessionRef.current = {
        user: parsed.user,
        token: parsed.token,
        refreshToken: refreshTokenValue,
      };
      setState({
        user: parsed.user,
        token: parsed.token,
        refreshToken: refreshTokenValue,
        loading: false,
        error: null,
      });
      if (refreshTokenValue) {
        scheduleRefresh(parsed.token);
      }
    } else {
      setState((s) => ({ ...s, loading: false }));
    }

    return () => clearScheduledRefresh();
  }, [scheduleRefresh, clearScheduledRefresh]);

  /**
   * QUI-359 (hallazgo de security review, regresión introducida por la rotación de
   * refresh token): `sessionRef` vive en memoria *por pestaña* — sin este listener, una
   * pestaña en segundo plano (que el browser puede estrangular y nunca disparar su propio
   * refresh) se quedaba con el `refreshToken` previo a que OTRA pestaña rotara la sesión.
   * Si el usuario cerraba sesión desde esa pestaña rezagada, mandaba ese token viejo —
   * que ya no matchea ninguna fila en `session` (auth.service.ts, `refresh()` lo rotó) — y
   * la sesión vigente (con el token nuevo) quedaba sin revocar pese al logout explícito, un
   * bypass silencioso del logout server-side. Escuchar `storage` mantiene `sessionRef`
   * (memoria) alineado con `localStorage` (que sí recibe cada rotación vía `persistSession`)
   * entre pestañas del mismo origen, sin depender de que el timer de refresh de esta pestaña
   * llegue a dispararse.
   */
  useEffect(() => {
    function handleStorage(event: StorageEvent): void {
      if (event.key !== STORAGE_KEY) {
        return;
      }

      if (event.newValue === null) {
        // Se cerró sesión (o se limpió el storage) en otra pestaña — replicarlo acá. Sin
        // esto, esta pestaña seguía mostrando una sesión "activa" en memoria cuyo
        // refreshToken ya fue revocado del lado servidor.
        clearScheduledRefresh();
        sessionRef.current = { user: null, token: null, refreshToken: null };
        setState({ user: null, token: null, refreshToken: null, loading: false, error: null });
        return;
      }

      try {
        const parsed = JSON.parse(event.newValue) as {
          user: AuthUser;
          token: string;
          refreshToken?: string;
        };
        const refreshTokenValue = parsed.refreshToken ?? null;
        sessionRef.current = {
          user: parsed.user,
          token: parsed.token,
          refreshToken: refreshTokenValue,
        };
        setState({
          user: parsed.user,
          token: parsed.token,
          refreshToken: refreshTokenValue,
          loading: false,
          error: null,
        });
        if (refreshTokenValue) {
          // Reprograma el auto-refresh de esta pestaña contra el token vigente — si se
          // dejara el timer viejo (armado sobre el token previo a la rotación), su próximo
          // disparo fallaría igual por el mismo motivo (token desactualizado).
          scheduleRefreshRef.current(parsed.token);
        } else {
          clearScheduledRefresh();
        }
      } catch {
        // Valor corrupto en localStorage (no debería pasar — solo esta misma app escribe
        // esta key) — no propagar un estado inconsistente a esta pestaña.
      }
    }

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [clearScheduledRefresh]);

  // Los timers se congelan con el teléfono dormido o la pestaña en segundo plano: al volver
  // (visible/focus) se refresca ya si el access token venció o está por vencer, y al volver la
  // red (`online`) se reintenta de inmediato si había un reintento pendiente.
  useEffect(() => {
    function refrescarAhora(forzar: boolean): void {
      const { token, refreshToken } = sessionRef.current;
      if (!token || !refreshToken || (!forzar && !necesitaRefresh(token))) {
        return;
      }
      clearScheduledRefresh();
      void performRefreshRef.current();
    }
    const alVolverVisible = () => {
      if (document.visibilityState === 'visible') {
        refrescarAhora(false);
      }
    };
    const alEnfocar = () => refrescarAhora(false);
    const alVolverLaRed = () => refrescarAhora(retryAttemptRef.current > 0);

    document.addEventListener('visibilitychange', alVolverVisible);
    window.addEventListener('focus', alEnfocar);
    window.addEventListener('online', alVolverLaRed);
    return () => {
      document.removeEventListener('visibilitychange', alVolverVisible);
      window.removeEventListener('focus', alEnfocar);
      window.removeEventListener('online', alVolverLaRed);
    };
  }, [clearScheduledRefresh]);

  const login = async (email: string, password: string): Promise<void> => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const response = await loginRequest(email, password);
      persistSession(response.user, response.accessToken, response.refreshToken);
      scheduleRefresh(response.accessToken);
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

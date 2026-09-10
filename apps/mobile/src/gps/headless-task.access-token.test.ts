import { describe, expect, it, vi, beforeEach } from 'vitest';

// Entrega 3 (`docs/plan-correccion-post-piloto-2026-09-09.md`): cubre el punto de extensión
// que la Entrega 2 dejó documentado en `obtenerAccessTokenHeadless` — ahora SÍ intenta un
// refresh, protegido por el circuit breaker compartido con el camino de foreground. Mismo
// motivo de mocks que `headless-task.test.ts`: `expo-sqlite`/`expo-crypto`/`expo-secure-store`
// (vía `sesion-movil-store`, `db/outbox`, `db/paquete-dia`) y `@sentry/react-native` no corren
// bajo vitest/Node.
vi.mock('react-native-background-geolocation', () => ({
  default: { getState: vi.fn(), stop: vi.fn() },
}));

vi.mock('@sentry/react-native', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

vi.mock('../db/outbox', () => ({
  abrirOutbox: vi.fn(),
  encolarEvento: vi.fn(),
  obtenerEventosPorTipo: vi.fn(),
}));

vi.mock('../db/paquete-dia', () => ({
  abrirPaqueteDiaDb: vi.fn(),
  obtenerPaqueteDiaLocal: vi.fn(),
}));

vi.mock('../features/operacion/drenaje-oportunista', () => ({
  intentarDrenarOportunista: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../shared/security/sesion-movil-store', () => ({
  actualizarSesionMovil: vi.fn(),
  cargarSesionMovil: vi.fn(),
  obtenerDeviceIdMovil: vi.fn(),
}));

vi.mock('../shared/api/auth-movil-api', async () => {
  const actual =
    await vi.importActual<typeof import('../shared/api/auth-movil-api')>(
      '../shared/api/auth-movil-api',
    );
  return { ...actual, authMovilApi: { refresh: vi.fn() } };
});

import { authMovilApi, AuthMovilApiError } from '../shared/api/auth-movil-api';
import { reiniciarCircuitoRefresh } from '../shared/api/refresh-circuit-breaker';
import {
  actualizarSesionMovil,
  cargarSesionMovil,
  type SesionMovilGuardada,
} from '../shared/security/sesion-movil-store';
import { obtenerAccessTokenHeadless } from './headless-task';

const refreshMock = authMovilApi.refresh as unknown as ReturnType<typeof vi.fn>;
const cargarSesionMovilMock = cargarSesionMovil as unknown as ReturnType<typeof vi.fn>;
const actualizarSesionMovilMock = actualizarSesionMovil as unknown as ReturnType<typeof vi.fn>;

function sesion(overrides: Partial<SesionMovilGuardada> = {}): SesionMovilGuardada {
  return {
    status: 'autenticado',
    accessToken: 'access-vieja',
    accessTokenExpiresAt: new Date(0).toISOString(),
    refreshToken: 'refresh-1',
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    contexto: {} as SesionMovilGuardada['contexto'],
    ...overrides,
  } as SesionMovilGuardada;
}

describe('obtenerAccessTokenHeadless', () => {
  beforeEach(() => {
    refreshMock.mockReset();
    cargarSesionMovilMock.mockReset();
    actualizarSesionMovilMock.mockReset();
    reiniciarCircuitoRefresh();
  });

  it('sin sesión guardada devuelve null sin intentar nada', async () => {
    cargarSesionMovilMock.mockResolvedValue(null);
    await expect(obtenerAccessTokenHeadless()).resolves.toBeNull();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('con access token todavía vigente lo devuelve sin refrescar', async () => {
    const vigente = sesion({ accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString() });
    cargarSesionMovilMock.mockResolvedValue(vigente);
    await expect(obtenerAccessTokenHeadless()).resolves.toBe('access-vieja');
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('con access token vencido, refresca (protegido por el circuit breaker) y persiste la sesión rotada', async () => {
    const vencida = sesion();
    cargarSesionMovilMock.mockResolvedValue(vencida);
    refreshMock.mockResolvedValueOnce({
      accessToken: 'access-nueva',
      refreshToken: 'refresh-2',
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const rotada = { ...vencida, accessToken: 'access-nueva', refreshToken: 'refresh-2' };
    actualizarSesionMovilMock.mockResolvedValue(rotada);

    await expect(obtenerAccessTokenHeadless()).resolves.toBe('access-nueva');
    expect(refreshMock).toHaveBeenCalledWith('refresh-1');
    expect(actualizarSesionMovilMock).toHaveBeenCalledWith(vencida, expect.objectContaining({ accessToken: 'access-nueva' }));
  });

  it('si el refresh falla (401), devuelve null en silencio — falla de TRANSPORTE, nunca de captura', async () => {
    const vencida = sesion();
    cargarSesionMovilMock.mockResolvedValue(vencida);
    refreshMock.mockRejectedValueOnce(new AuthMovilApiError('http', 'Sesión inválida', 401));

    await expect(obtenerAccessTokenHeadless()).resolves.toBeNull();
    expect(actualizarSesionMovilMock).not.toHaveBeenCalled();
  });

  it('con el circuito ya abierto (fallos previos, p. ej. del camino de foreground), corta sin tocar la red', async () => {
    const vencida = sesion();
    cargarSesionMovilMock.mockResolvedValue(vencida);
    refreshMock.mockRejectedValue(new AuthMovilApiError('http', 'Sesión inválida', 401));

    // 5 fallos reales para abrir el circuito (mismo umbral que el módulo del breaker).
    for (let i = 0; i < 5; i++) {
      await obtenerAccessTokenHeadless();
    }
    const llamadasTrasAbrir = refreshMock.mock.calls.length;
    expect(llamadasTrasAbrir).toBeGreaterThan(0);

    refreshMock.mockClear();
    await expect(obtenerAccessTokenHeadless()).resolves.toBeNull();
    // El circuito está abierto y el backoff no venció (mismo `Date.now()` real entre
    // llamadas, muy por debajo del backoff de 30s): ningún intento adicional debe tocar la red.
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

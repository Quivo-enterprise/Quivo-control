import { describe, expect, it, vi, beforeEach } from 'vitest';

// Hallazgo ALTO (piloto día 1, ver docs/plan-v2-app-y-mapa-en-vivo.md §2.4): los refresh
// tokens rotan del lado del servidor, así que dos llamadas concurrentes a `refrescar()` con
// el MISMO refresh token (p. ej. `obtenerAccessToken` disparado por `useSyncStatus` mientras
// `refrescarConReintentos` todavía está reintentando el 401 inicial) hacían que la segunda
// rotación aterrizara sobre un token ya canjeado y recibiera un 401 real sobre una sesión
// válida. Este test cubre el fix de single-flight en `refrescar()`: llamadas concurrentes con
// el mismo `refreshToken` deben compartir una única llamada de red, no disparar rotaciones en
// paralelo.
//
// Se mockean `authMovilApi` y `sesion-movil-store` (en vez de las dependencias nativas que
// traen — `expo-secure-store`, `expo-crypto`) porque esas SÍ requieren infraestructura nativa;
// `refrescar()` solo orquesta llamadas a esos dos módulos y es pura lógica de coordinación.
vi.mock('../../shared/api/auth-movil-api', () => ({
  authMovilApi: { refresh: vi.fn() },
  AuthMovilApiError: class AuthMovilApiError extends Error {
    constructor(
      public readonly kind: string,
      message: string,
      public readonly status?: number,
    ) {
      super(message);
    }
  },
}));

vi.mock('../../shared/security/sesion-movil-store', () => ({
  actualizarSesionMovil: vi.fn(),
  borrarSesionMovil: vi.fn(),
  cargarSesionMovil: vi.fn(),
  guardarSesionMovil: vi.fn(),
  obtenerDeviceIdMovil: vi.fn(),
}));

vi.mock('@sentry/react-native', () => ({
  captureException: vi.fn(),
}));

import { AuthMovilApiError, authMovilApi } from '../../shared/api/auth-movil-api';
import { obtenerEstadoCircuitoRefresh, reiniciarCircuitoRefresh } from '../../shared/api/refresh-circuit-breaker';
import {
  actualizarSesionMovil,
  cargarSesionMovil,
  type SesionMovilGuardada,
} from '../../shared/security/sesion-movil-store';
import { refrescar } from './use-auth-movil';

const refreshMock = authMovilApi.refresh as unknown as ReturnType<typeof vi.fn>;
const actualizarSesionMovilMock = actualizarSesionMovil as unknown as ReturnType<typeof vi.fn>;
const cargarSesionMovilMock = cargarSesionMovil as unknown as ReturnType<typeof vi.fn>;

function sesion(refreshToken: string): SesionMovilGuardada {
  return {
    status: 'autenticado',
    accessToken: 'access-vieja',
    accessTokenExpiresAt: new Date(0).toISOString(),
    refreshToken,
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    contexto: {} as SesionMovilGuardada['contexto'],
  } as SesionMovilGuardada;
}

describe('refrescar (single-flight)', () => {
  beforeEach(() => {
    refreshMock.mockReset();
    actualizarSesionMovilMock.mockReset();
    cargarSesionMovilMock.mockReset();
    // El circuit breaker es estado a nivel de módulo (real, no mockeado acá) — sin este
    // reset, un 401 contado en un test anterior podía filtrarse al siguiente.
    reiniciarCircuitoRefresh();
  });

  it('comparte una única llamada de red entre refrescos concurrentes con el mismo refresh token', async () => {
    let resolverRefresh!: (tokens: { accessToken: string; refreshToken: string; accessTokenExpiresAt: string; refreshTokenExpiresAt: string }) => void;
    refreshMock.mockReturnValue(
      new Promise((resolve) => {
        resolverRefresh = resolve;
      }),
    );
    const guardada = sesion('refresh-1');
    const rotada = { ...guardada, accessToken: 'access-nueva', refreshToken: 'refresh-2' };
    actualizarSesionMovilMock.mockResolvedValue(rotada);

    // Dos llamadas "concurrentes" (simulando `obtenerAccessToken` y `reconciliarSesion`
    // disparando el refresh al mismo tiempo) antes de que la red responda.
    const p1 = refrescar(guardada);
    const p2 = refrescar(guardada);

    expect(refreshMock).toHaveBeenCalledTimes(1);

    resolverRefresh({
      accessToken: 'access-nueva',
      refreshToken: 'refresh-2',
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(rotada);
    expect(r2).toBe(rotada);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(actualizarSesionMovilMock).toHaveBeenCalledTimes(1);
  });

  it('no cachea un rechazo: una llamada posterior dispara un intento de red nuevo', async () => {
    const guardada = sesion('refresh-1');
    refreshMock.mockRejectedValueOnce(new Error('401'));

    await expect(refrescar(guardada)).rejects.toThrow('401');
    expect(refreshMock).toHaveBeenCalledTimes(1);

    const rotada = { ...guardada, accessToken: 'access-nueva', refreshToken: 'refresh-2' };
    refreshMock.mockResolvedValueOnce({
      accessToken: 'access-nueva',
      refreshToken: 'refresh-2',
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    actualizarSesionMovilMock.mockResolvedValueOnce(rotada);

    const resultado = await refrescar(guardada);
    expect(resultado).toBe(rotada);
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });

  it('no comparte la llamada de red entre refresh tokens distintos', async () => {
    refreshMock.mockImplementation(async (token: string) => ({
      accessToken: `access-${token}`,
      refreshToken: `${token}-rotado`,
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    }));
    actualizarSesionMovilMock.mockImplementation(async (guardadaActual, tokens) => ({
      ...guardadaActual,
      ...tokens,
    }));

    const [r1, r2] = await Promise.all([
      refrescar(sesion('refresh-a')),
      refrescar(sesion('refresh-b')),
    ]);

    expect(refreshMock).toHaveBeenCalledTimes(2);
    expect(r1.refreshToken).toBe('refresh-a-rotado');
    expect(r2.refreshToken).toBe('refresh-b-rotado');
  });
});

describe('refrescar — Hallazgo 3 (code review, MEDIO): carrera de refresh headless/foreground', () => {
  beforeEach(() => {
    refreshMock.mockReset();
    actualizarSesionMovilMock.mockReset();
    cargarSesionMovilMock.mockReset();
    reiniciarCircuitoRefresh();
  });

  /** Tokens de refresh nuevos que devuelve el mock de `authMovilApi.refresh` en un éxito. */
  function tokensRefrescados(refreshTokenNuevo: string) {
    return {
      accessToken: `access-${refreshTokenNuevo}`,
      refreshToken: refreshTokenNuevo,
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
  }

  it('T0 en memoria y T1 en SecureStore: un solo 401, relee disco, reintenta con T1, y el circuito no suma fallo', async () => {
    const t0 = sesion('T0'); // lo que tiene `estado.sesion`/`guardada` en este contexto JS
    const enDisco = sesion('T1'); // lo que otro contexto (headless) ya rotó y persistió

    cargarSesionMovilMock.mockResolvedValue(enDisco);
    refreshMock.mockImplementation(async (token: string) => {
      if (token === 'T0') {
        // T0 ya fue canjeado server-side por el otro contexto — 401 real.
        throw new AuthMovilApiError('http', 'Refresh token inválido', 401);
      }
      return tokensRefrescados('T2');
    });
    const rotada = { ...enDisco, ...tokensRefrescados('T2') };
    actualizarSesionMovilMock.mockResolvedValue(rotada);

    const resultado = await refrescar(t0);

    expect(resultado).toBe(rotada);
    // UN solo 401 real (con T0) — el reintento (con T1, releído de disco) tiene éxito.
    expect(refreshMock).toHaveBeenCalledTimes(2);
    expect(refreshMock).toHaveBeenNthCalledWith(1, 'T0');
    expect(refreshMock).toHaveBeenNthCalledWith(2, 'T1');
    // El reintento persiste sobre la sesión de DISCO (T1), no sobre la vieja (T0) — si
    // persistiera sobre `t0`, el `contexto`/resto de campos de la rotación de headless (que
    // pudo traer más que solo los tokens) se perdería.
    expect(actualizarSesionMovilMock).toHaveBeenCalledWith(enDisco, expect.objectContaining({ refreshToken: 'T2' }));
    // El circuito termina COMO SI nada hubiera fallado: el 401 real sumó un fallo transitorio,
    // pero el éxito final (`circuitoTrasExito`) lo resetea del todo — nunca llega a abrirse.
    const estado = obtenerEstadoCircuitoRefresh();
    expect(estado.estado).toBe('cerrado');
    expect(estado.fallosConsecutivos).toBe(0);
  });

  it('si el token en disco es el MISMO que ya falló, el 401 es real — no reintenta en loop', async () => {
    const t0 = sesion('T0');
    cargarSesionMovilMock.mockResolvedValue(sesion('T0')); // disco NO tiene un token distinto
    refreshMock.mockRejectedValue(new AuthMovilApiError('http', 'Sesión revocada', 401));

    await expect(refrescar(t0)).rejects.toThrow('Sesión revocada');
    // Un solo intento de red — sin el token en disco distinto, no hay evidencia de carrera y
    // reintentar con el MISMO token que ya falló no cambiaría nada (loop inútil).
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('sin sesión en disco (logout concurrente), el 401 se propaga sin reintentar', async () => {
    const t0 = sesion('T0');
    cargarSesionMovilMock.mockResolvedValue(null);
    refreshMock.mockRejectedValue(new AuthMovilApiError('http', 'Sesión revocada', 401));

    await expect(refrescar(t0)).rejects.toThrow('Sesión revocada');
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('un error de RED (no 401) no dispara la relectura de disco — sigue siendo offline legítimo', async () => {
    const t0 = sesion('T0');
    refreshMock.mockRejectedValue(new AuthMovilApiError('network', 'Sin conexión'));

    await expect(refrescar(t0)).rejects.toThrow('Sin conexión');
    expect(cargarSesionMovilMock).not.toHaveBeenCalled();
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});

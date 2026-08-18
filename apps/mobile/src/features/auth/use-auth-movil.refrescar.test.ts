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

import { authMovilApi } from '../../shared/api/auth-movil-api';
import { actualizarSesionMovil, type SesionMovilGuardada } from '../../shared/security/sesion-movil-store';
import { refrescar } from './use-auth-movil';

const refreshMock = authMovilApi.refresh as unknown as ReturnType<typeof vi.fn>;
const actualizarSesionMovilMock = actualizarSesionMovil as unknown as ReturnType<typeof vi.fn>;

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

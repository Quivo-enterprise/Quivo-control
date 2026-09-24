import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Punto 3 (`/codex-debug verify-fix`, decisión del CTO): si `ejecutarLogout` no pudo revocar
 * server-side por falta de red, persiste la intención (`guardarRevocacionPendiente`) en vez de
 * dejar la sesión abierta del lado del servidor para siempre. `intentarRevocacionesPendientes`
 * es quien reintenta esa intención — se llama desde `restaurarSesion` ("próximo arranque con
 * red") y desde `intentarDrenarOportunista` (`drenaje-oportunista.ts`, "próximo ciclo de
 * drenado").
 */
vi.mock('../../shared/api/auth-movil-api', () => ({
  authMovilApi: { refresh: vi.fn(), logout: vi.fn() },
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
  borrarRevocacionPendiente: vi.fn().mockResolvedValue(undefined),
  borrarSesionMovil: vi.fn(),
  cargarSesionMovil: vi.fn(),
  guardarRevocacionPendiente: vi.fn().mockResolvedValue(undefined),
  guardarSesionMovil: vi.fn(),
  leerRevocacionPendiente: vi.fn(),
  obtenerDeviceIdMovil: vi.fn(),
}));

vi.mock('../../db/outbox', () => ({
  abrirOutbox: vi.fn().mockResolvedValue({}),
  adquirirLease: vi.fn().mockResolvedValue(true),
  liberarLeaseConCooldown: vi.fn().mockResolvedValue(undefined),
  renovarLease: vi.fn().mockResolvedValue(true),
  ID_LEASE_REFRESH_SESION: 'refresh-sesion',
  TTL_LEASE_REFRESH_SESION_MS: 20_000,
}));

vi.mock('@sentry/react-native', () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

import { AuthMovilApiError, authMovilApi } from '../../shared/api/auth-movil-api';
import {
  borrarRevocacionPendiente,
  guardarRevocacionPendiente,
  leerRevocacionPendiente,
} from '../../shared/security/sesion-movil-store';
import {
  intentarRevocacionesPendientes,
  TOPE_INTENTOS_REVOCACION_PENDIENTE_NO_RED,
} from './use-auth-movil';

const logoutMock = authMovilApi.logout as unknown as ReturnType<typeof vi.fn>;
const leerRevocacionPendienteMock = leerRevocacionPendiente as unknown as ReturnType<typeof vi.fn>;
const guardarRevocacionPendienteMock = guardarRevocacionPendiente as unknown as ReturnType<
  typeof vi.fn
>;
const borrarRevocacionPendienteMock = borrarRevocacionPendiente as unknown as ReturnType<
  typeof vi.fn
>;

describe('intentarRevocacionesPendientes — punto 3 (verify-fix)', () => {
  beforeEach(() => {
    logoutMock.mockReset();
    leerRevocacionPendienteMock.mockReset();
    guardarRevocacionPendienteMock.mockReset().mockResolvedValue(undefined);
    borrarRevocacionPendienteMock.mockReset().mockResolvedValue(undefined);
  });

  it('sin ninguna revocación pendiente, no llama a authMovilApi.logout', async () => {
    leerRevocacionPendienteMock.mockResolvedValue(null);

    await intentarRevocacionesPendientes();

    expect(logoutMock).not.toHaveBeenCalled();
  });

  it('con una pendiente y red disponible, revoca y borra la pendiente al confirmar', async () => {
    leerRevocacionPendienteMock.mockResolvedValue({
      refreshToken: 'T-pendiente',
      deviceId: 'device-1',
      intentos: 0,
    });
    logoutMock.mockResolvedValue(undefined);

    await intentarRevocacionesPendientes();

    expect(logoutMock).toHaveBeenCalledWith('T-pendiente', 'device-1');
    expect(borrarRevocacionPendienteMock).toHaveBeenCalledTimes(1);
    expect(guardarRevocacionPendienteMock).not.toHaveBeenCalled();
  });

  it('un fallo de RED deja la pendiente intacta (no cuenta contra el tope, se reintenta en el próximo ciclo)', async () => {
    leerRevocacionPendienteMock.mockResolvedValue({
      refreshToken: 'T-pendiente',
      deviceId: 'device-1',
      intentos: 0,
    });
    logoutMock.mockRejectedValue(new AuthMovilApiError('network', 'sin conexión'));

    await intentarRevocacionesPendientes();

    expect(guardarRevocacionPendienteMock).not.toHaveBeenCalled();
    expect(borrarRevocacionPendienteMock).not.toHaveBeenCalled();
  });

  it('un fallo NO-red suma un intento y persiste la pendiente actualizada', async () => {
    leerRevocacionPendienteMock.mockResolvedValue({
      refreshToken: 'T-pendiente',
      deviceId: 'device-1',
      intentos: 1,
    });
    logoutMock.mockRejectedValue(new AuthMovilApiError('http', 'error del servidor', 500));

    await intentarRevocacionesPendientes();

    expect(guardarRevocacionPendienteMock).toHaveBeenCalledWith({
      refreshToken: 'T-pendiente',
      deviceId: 'device-1',
      intentos: 2,
    });
    expect(borrarRevocacionPendienteMock).not.toHaveBeenCalled();
  });

  it(`al llegar a ${TOPE_INTENTOS_REVOCACION_PENDIENTE_NO_RED} intentos NO-red, descarta la pendiente en vez de seguir reintentando para siempre`, async () => {
    leerRevocacionPendienteMock.mockResolvedValue({
      refreshToken: 'T-pendiente',
      deviceId: 'device-1',
      intentos: TOPE_INTENTOS_REVOCACION_PENDIENTE_NO_RED - 1,
    });
    logoutMock.mockRejectedValue(new AuthMovilApiError('http', 'error del servidor', 500));

    await intentarRevocacionesPendientes();

    expect(borrarRevocacionPendienteMock).toHaveBeenCalledTimes(1);
    expect(guardarRevocacionPendienteMock).not.toHaveBeenCalled();
  });

  it('nunca rechaza, ni siquiera si leerRevocacionPendiente falla', async () => {
    leerRevocacionPendienteMock.mockRejectedValue(new Error('SecureStore no disponible'));

    await expect(intentarRevocacionesPendientes()).resolves.toBeUndefined();
  });
});

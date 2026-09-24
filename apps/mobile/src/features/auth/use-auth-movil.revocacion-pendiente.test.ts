import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Punto 3 (`/codex-debug verify-fix`, decisión del CTO): si `ejecutarLogout` no pudo revocar
 * server-side por falta de red, persiste la intención (`guardarRevocacionPendiente`) en vez de
 * dejar la sesión abierta del lado del servidor para siempre. `intentarRevocacionesPendientes`
 * es quien reintenta esa intención — se llama desde `restaurarSesion` ("próximo arranque con
 * red") y desde `intentarDrenarOportunista` (`drenaje-oportunista.ts`, "próximo ciclo de
 * drenado").
 *
 * Punto 4 (verify-fix ronda 6): ahora puede haber VARIAS intenciones pendientes a la vez
 * (`listarRevocacionesPendientes`, indexadas por id) — cada una se procesa y se borra de forma
 * independiente (`borrarRevocacionPendientePorId`).
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
  borrarLogoutSolicitado: vi.fn().mockResolvedValue(undefined),
  borrarRevocacionPendientePorId: vi.fn().mockResolvedValue(undefined),
  borrarSesionMovil: vi.fn(),
  cargarSesionMovil: vi.fn(),
  guardarRevocacionPendiente: vi.fn().mockResolvedValue('id-nuevo'),
  guardarSesionMovil: vi.fn(),
  hayLogoutSolicitado: vi.fn().mockResolvedValue(false),
  listarRevocacionesPendientes: vi.fn(),
  marcarLogoutSolicitado: vi.fn().mockResolvedValue(undefined),
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
  borrarLogoutSolicitado,
  borrarRevocacionPendientePorId,
  cargarSesionMovil,
  guardarRevocacionPendiente,
  hayLogoutSolicitado,
  listarRevocacionesPendientes,
  marcarLogoutSolicitado,
  obtenerDeviceIdMovil,
} from '../../shared/security/sesion-movil-store';
import {
  intentarRevocacionesPendientes,
  TOPE_INTENTOS_REVOCACION_PENDIENTE_NO_RED,
} from './use-auth-movil';

const logoutMock = authMovilApi.logout as unknown as ReturnType<typeof vi.fn>;
const listarRevocacionesPendientesMock = listarRevocacionesPendientes as unknown as ReturnType<
  typeof vi.fn
>;
const guardarRevocacionPendienteMock = guardarRevocacionPendiente as unknown as ReturnType<
  typeof vi.fn
>;
const borrarRevocacionPendientePorIdMock = borrarRevocacionPendientePorId as unknown as ReturnType<
  typeof vi.fn
>;
const hayLogoutSolicitadoMock = hayLogoutSolicitado as unknown as ReturnType<typeof vi.fn>;
const marcarLogoutSolicitadoMock = marcarLogoutSolicitado as unknown as ReturnType<typeof vi.fn>;
const borrarLogoutSolicitadoMock = borrarLogoutSolicitado as unknown as ReturnType<typeof vi.fn>;
const cargarSesionMovilMock = cargarSesionMovil as unknown as ReturnType<typeof vi.fn>;
const obtenerDeviceIdMovilMock = obtenerDeviceIdMovil as unknown as ReturnType<typeof vi.fn>;

describe('intentarRevocacionesPendientes — punto 3 (verify-fix)', () => {
  beforeEach(() => {
    logoutMock.mockReset();
    listarRevocacionesPendientesMock.mockReset().mockResolvedValue([]);
    guardarRevocacionPendienteMock.mockReset().mockResolvedValue('id-nuevo');
    borrarRevocacionPendientePorIdMock.mockReset().mockResolvedValue(undefined);
    hayLogoutSolicitadoMock.mockReset().mockResolvedValue(false);
    marcarLogoutSolicitadoMock.mockReset().mockResolvedValue(undefined);
    borrarLogoutSolicitadoMock.mockReset().mockResolvedValue(undefined);
    cargarSesionMovilMock.mockReset();
    obtenerDeviceIdMovilMock.mockReset().mockResolvedValue('device-1');
  });

  it('sin ninguna revocación pendiente ni logout solicitado, no llama a authMovilApi.logout', async () => {
    await intentarRevocacionesPendientes();

    expect(logoutMock).not.toHaveBeenCalled();
  });

  it('con una pendiente y red disponible, revoca y borra SOLO esa entrada (por id) al confirmar', async () => {
    listarRevocacionesPendientesMock.mockResolvedValue([
      { id: 'id-1', refreshToken: 'T-pendiente', deviceId: 'device-1', intentos: 0 },
    ]);
    logoutMock.mockResolvedValue(undefined);

    await intentarRevocacionesPendientes();

    expect(logoutMock).toHaveBeenCalledWith('T-pendiente', 'device-1');
    expect(borrarRevocacionPendientePorIdMock).toHaveBeenCalledWith('id-1');
    expect(guardarRevocacionPendienteMock).not.toHaveBeenCalled();
  });

  it('un fallo de RED deja la pendiente intacta (no cuenta contra el tope, se reintenta en el próximo ciclo)', async () => {
    listarRevocacionesPendientesMock.mockResolvedValue([
      { id: 'id-1', refreshToken: 'T-pendiente', deviceId: 'device-1', intentos: 0 },
    ]);
    logoutMock.mockRejectedValue(new AuthMovilApiError('network', 'sin conexión'));

    await intentarRevocacionesPendientes();

    expect(guardarRevocacionPendienteMock).not.toHaveBeenCalled();
    expect(borrarRevocacionPendientePorIdMock).not.toHaveBeenCalled();
  });

  it('un fallo NO-red suma un intento y persiste la pendiente actualizada', async () => {
    listarRevocacionesPendientesMock.mockResolvedValue([
      { id: 'id-1', refreshToken: 'T-pendiente', deviceId: 'device-1', intentos: 1 },
    ]);
    logoutMock.mockRejectedValue(new AuthMovilApiError('http', 'error del servidor', 500));

    await intentarRevocacionesPendientes();

    expect(guardarRevocacionPendienteMock).toHaveBeenCalledWith({
      id: 'id-1',
      refreshToken: 'T-pendiente',
      deviceId: 'device-1',
      intentos: 2,
    });
    expect(borrarRevocacionPendientePorIdMock).not.toHaveBeenCalled();
  });

  it(`al llegar a ${TOPE_INTENTOS_REVOCACION_PENDIENTE_NO_RED} intentos NO-red, descarta esa entrada en vez de seguir reintentando para siempre`, async () => {
    listarRevocacionesPendientesMock.mockResolvedValue([
      {
        id: 'id-1',
        refreshToken: 'T-pendiente',
        deviceId: 'device-1',
        intentos: TOPE_INTENTOS_REVOCACION_PENDIENTE_NO_RED - 1,
      },
    ]);
    logoutMock.mockRejectedValue(new AuthMovilApiError('http', 'error del servidor', 500));

    await intentarRevocacionesPendientes();

    expect(borrarRevocacionPendientePorIdMock).toHaveBeenCalledWith('id-1');
    expect(guardarRevocacionPendienteMock).not.toHaveBeenCalled();
  });

  it('nunca rechaza, ni siquiera si listarRevocacionesPendientes falla', async () => {
    listarRevocacionesPendientesMock.mockRejectedValue(new Error('SecureStore no disponible'));

    await expect(intentarRevocacionesPendientes()).resolves.toBeUndefined();
  });

  /**
   * Punto 4 (verify-fix ronda 6): dos intenciones EN VUELO a la vez no deben pisarse — A
   * termina (se borra por su propio id) mientras B, guardada mientras A todavía estaba
   * pendiente, sobrevive intacta.
   */
  it('punto 4: con A y B pendientes a la vez, procesar y borrar A no afecta a B', async () => {
    listarRevocacionesPendientesMock.mockResolvedValue([
      { id: 'id-a', refreshToken: 'T-a', deviceId: 'device-1', intentos: 0 },
      { id: 'id-b', refreshToken: 'T-b', deviceId: 'device-1', intentos: 0 },
    ]);
    logoutMock.mockImplementation(async (token: string) => {
      if (token === 'T-a') return undefined; // A se revoca con éxito
      throw new AuthMovilApiError('network', 'sin conexión'); // B sigue sin red
    });

    await intentarRevocacionesPendientes();

    expect(borrarRevocacionPendientePorIdMock).toHaveBeenCalledWith('id-a');
    expect(borrarRevocacionPendientePorIdMock).not.toHaveBeenCalledWith('id-b');
    expect(guardarRevocacionPendienteMock).not.toHaveBeenCalled(); // B: fallo de red, no suma intento
  });

  /**
   * Gap 4 (Codex, ronda 6): además de las revocaciones con token ya conocido, reintenta acá el
   * `ejecutarLogout` completo cuando quedó "solicitado" sin haber conseguido el lease la vez
   * anterior (ver `marcarLogoutSolicitado`).
   */
  describe('gap 4: retomar un logout que quedó "solicitado" (nunca consiguió el lease)', () => {
    it('sin logout solicitado, no llama a ejecutarLogout (ni a cargarSesionMovil)', async () => {
      hayLogoutSolicitadoMock.mockResolvedValue(false);

      await intentarRevocacionesPendientes();

      expect(cargarSesionMovilMock).not.toHaveBeenCalled();
    });

    it('con logout solicitado y la sesión todavía intacta en disco, retoma ejecutarLogout completo y borra la marca al completar', async () => {
      hayLogoutSolicitadoMock.mockResolvedValue(true);
      cargarSesionMovilMock.mockResolvedValue({
        status: 'autenticado',
        accessToken: 'access-T-retomado',
        accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        refreshToken: 'T-retomado',
        refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        contexto: {},
      });
      logoutMock.mockResolvedValue(undefined);

      await intentarRevocacionesPendientes();

      expect(obtenerDeviceIdMovilMock).toHaveBeenCalledTimes(1);
      expect(logoutMock).toHaveBeenCalledWith('T-retomado', 'device-1');
      expect(borrarLogoutSolicitadoMock).toHaveBeenCalledTimes(1);
    });

    it('nunca rechaza si hayLogoutSolicitado falla', async () => {
      hayLogoutSolicitadoMock.mockRejectedValue(new Error('SecureStore no disponible'));

      await expect(intentarRevocacionesPendientes()).resolves.toBeUndefined();
    });
  });
});

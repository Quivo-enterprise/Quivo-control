import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Punto 3 (`/codex-debug verify-fix`, decisión del CTO): `logout()` mandaba
 * `estado.sesion?.refreshToken` (React, en memoria) al servidor. Si el headless task rotó DOS
 * veces (T0→T1→T2) mientras foreground seguía mostrando T0 (estado desactualizado — el caso
 * real: la app en background no repinta `estado.sesion` en cada tick headless), el servidor no
 * reconocía T0 (ni como vigente ni como el único hash "anterior" que guarda
 * `refreshTokenHashAnterior`) y el logout terminaba en el camino no-op silencioso, dejando la
 * sesión ABIERTA del lado del servidor pese a que el chofer "cerró sesión" en el teléfono.
 *
 * `ejecutarLogout` (extraída de `logout()` del hook, mismo patrón que `refrescar`/
 * `ejecutarRefresh`, para poder testearla sin el arnés de React que este paquete no tiene) releé
 * el refresh token PERSISTIDO bajo el lease `refresh-sesion` — el MISMO que serializa
 * `ejecutarRefresh` — en vez de confiar en ningún argumento de memoria.
 *
 * Ronda 2 (`/codex-debug verify-fix` sobre `75c1189`, decisión del CTO): el diseño anterior
 * degradaba al `refreshTokenMemoria` (React) si no conseguía el lease a tiempo — exactamente el
 * mismo bug bajo contención. Ahora `ejecutarLogout` YA NO recibe ningún token de memoria: espera
 * el lease con poll hasta `TTL_LEASE_REFRESH_SESION_MS + MARGEN_ESPERA_LEASE_LOGOUT_MS` (el
 * lease vence solo, así que esa espera siempre termina consiguiéndolo) y SIEMPRE revoca con lo
 * que lea de disco.
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
  borrarSesionMovil: vi.fn().mockResolvedValue(undefined),
  cargarSesionMovil: vi.fn(),
  guardarRevocacionPendiente: vi.fn().mockResolvedValue('id-revocacion'),
  guardarSesionMovil: vi.fn(),
  hayLogoutSolicitado: vi.fn().mockResolvedValue(false),
  listarRevocacionesPendientes: vi.fn().mockResolvedValue([]),
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

import { authMovilApi } from '../../shared/api/auth-movil-api';
import {
  borrarLogoutSolicitado,
  borrarRevocacionPendientePorId,
  borrarSesionMovil,
  cargarSesionMovil,
  guardarRevocacionPendiente,
  marcarLogoutSolicitado,
  type SesionMovilGuardada,
} from '../../shared/security/sesion-movil-store';
import { adquirirLease } from '../../db/outbox';
import { ejecutarLogout, refrescar, SesionCerradaEnRefreshError } from './use-auth-movil';

const logoutMock = authMovilApi.logout as unknown as ReturnType<typeof vi.fn>;
const refreshMock = authMovilApi.refresh as unknown as ReturnType<typeof vi.fn>;
const cargarSesionMovilMock = cargarSesionMovil as unknown as ReturnType<typeof vi.fn>;
const borrarSesionMovilMock = borrarSesionMovil as unknown as ReturnType<typeof vi.fn>;
const guardarRevocacionPendienteMock = guardarRevocacionPendiente as unknown as ReturnType<
  typeof vi.fn
>;
const borrarRevocacionPendientePorIdMock = borrarRevocacionPendientePorId as unknown as ReturnType<
  typeof vi.fn
>;
const marcarLogoutSolicitadoMock = marcarLogoutSolicitado as unknown as ReturnType<typeof vi.fn>;
const borrarLogoutSolicitadoMock = borrarLogoutSolicitado as unknown as ReturnType<typeof vi.fn>;
const adquirirLeaseMock = adquirirLease as unknown as ReturnType<typeof vi.fn>;

function sesion(refreshToken: string): SesionMovilGuardada {
  return {
    status: 'autenticado',
    accessToken: `access-${refreshToken}`,
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    refreshToken,
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    contexto: {} as SesionMovilGuardada['contexto'],
  } as SesionMovilGuardada;
}

describe('ejecutarLogout — punto 3 (verify-fix): coordina con ejecutarRefresh por el MISMO lease refresh-sesion', () => {
  beforeEach(() => {
    logoutMock.mockReset().mockResolvedValue(undefined);
    refreshMock.mockReset();
    cargarSesionMovilMock.mockReset();
    borrarSesionMovilMock.mockReset().mockResolvedValue(undefined);
    guardarRevocacionPendienteMock.mockReset().mockResolvedValue('id-revocacion');
    borrarRevocacionPendientePorIdMock.mockReset().mockResolvedValue(undefined);
    marcarLogoutSolicitadoMock.mockReset().mockResolvedValue(undefined);
    borrarLogoutSolicitadoMock.mockReset().mockResolvedValue(undefined);
    adquirirLeaseMock.mockReset().mockResolvedValue(true);
  });

  it('con dos rotaciones headless (T0→T1→T2) y estado React desactualizado (T0), revoca con el token PERSISTIDO (T2), nunca con el de memoria', async () => {
    const t2EnDisco = sesion('T2');
    cargarSesionMovilMock.mockResolvedValue(t2EnDisco);

    await ejecutarLogout('device-1');

    expect(logoutMock).toHaveBeenCalledTimes(1);
    expect(logoutMock).toHaveBeenCalledWith('T2', 'device-1');
    expect(logoutMock).not.toHaveBeenCalledWith('T0', expect.anything());
  });

  it('orden (verify-fix ronda 6, decisión del CTO): persiste la intención de revocación, borra la sesión local, y RECIÉN DESPUÉS intenta revocar en la red', async () => {
    cargarSesionMovilMock.mockResolvedValue(sesion('T2'));

    const resultado = await ejecutarLogout('device-1');

    expect(resultado).toBe('completado');
    // Si el proceso muriera entre el borrado local y que el POST de red confirme, la
    // intención (persistida PRIMERO) sobrevive — `intentarRevocacionesPendientes` la retoma.
    const ordenGuardarIntencion = guardarRevocacionPendienteMock.mock.invocationCallOrder[0];
    const ordenBorrarLocal = borrarSesionMovilMock.mock.invocationCallOrder[0];
    const ordenRevocarRed = logoutMock.mock.invocationCallOrder[0];
    expect(ordenGuardarIntencion).toBeDefined();
    expect(ordenBorrarLocal).toBeDefined();
    expect(ordenRevocarRed).toBeDefined();
    expect(ordenGuardarIntencion as number).toBeLessThan(ordenBorrarLocal as number);
    expect(ordenBorrarLocal as number).toBeLessThan(ordenRevocarRed as number);
  });

  it('logout con el lease OCUPADO al principio (React en T0, disco en T2): espera a conseguirlo y revoca con T2, nunca degrada a memoria', async () => {
    // Ronda 2 del hallazgo: el diseño anterior degradaba a un token de memoria si el lease
    // estaba ocupado — reproducía el mismo bug bajo contención. Ahora `ejecutarLogout` ya no
    // recibe NINGÚN token de memoria: solo espera el lease y relee disco.
    vi.useFakeTimers();
    try {
      // Ocupado en los primeros intentos (otro contexto sosteniendo el lease — p. ej. un
      // `ejecutarRefresh` headless en vuelo), libre recién al tercero.
      adquirirLeaseMock
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      cargarSesionMovilMock.mockResolvedValue(sesion('T2'));

      const promesa = ejecutarLogout('device-1');
      // El poll corre cada 150 ms (`INTERVALO_POLL_LEASE_REFRESH_MS`) — un par de segundos de
      // sobra para que los tres intentos se resuelvan.
      await vi.advanceTimersByTimeAsync(2_000);
      await promesa;

      expect(adquirirLeaseMock).toHaveBeenCalledTimes(3);
      expect(logoutMock).toHaveBeenCalledTimes(1);
      expect(logoutMock).toHaveBeenCalledWith('T2', 'device-1');
      expect(borrarSesionMovilMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lease ocupado durante una contención larga (bien dentro de TTL + margen): igual espera y consigue el lease, revocando con lo que haya en disco', async () => {
    vi.useFakeTimers();
    try {
      // Se libera recién en el intento 100 (~15 s de poll a 150 ms) — mucho más que una
      // contención breve, pero todavía dentro de TTL + margen (25 s en total).
      let llamada = 0;
      adquirirLeaseMock.mockImplementation(async () => {
        llamada += 1;
        return llamada >= 100;
      });
      cargarSesionMovilMock.mockResolvedValue(sesion('T-final'));

      const promesa = ejecutarLogout('device-1');
      await vi.advanceTimersByTimeAsync(25_000);
      await promesa;

      expect(logoutMock).toHaveBeenCalledWith('T-final', 'device-1');
      expect(borrarSesionMovilMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sin refreshToken en disco (nunca hubo sesión), no llama a authMovilApi.logout pero sí limpia el almacenamiento local', async () => {
    cargarSesionMovilMock.mockResolvedValue(null);

    await ejecutarLogout('device-1');

    expect(logoutMock).not.toHaveBeenCalled();
    expect(borrarSesionMovilMock).toHaveBeenCalledTimes(1);
  });

  it('un fallo de red al revocar no impide la limpieza local — la intención ya quedó persistida ANTES del intento, no hace falta guardarla de nuevo', async () => {
    cargarSesionMovilMock.mockResolvedValue(sesion('T2'));
    logoutMock.mockRejectedValue(new Error('offline'));

    await expect(ejecutarLogout('device-1')).resolves.toBe('completado');
    expect(borrarSesionMovilMock).toHaveBeenCalledTimes(1);
    expect(guardarRevocacionPendienteMock).toHaveBeenCalledTimes(1);
    expect(guardarRevocacionPendienteMock).toHaveBeenCalledWith({
      refreshToken: 'T2',
      deviceId: 'device-1',
      intentos: 0,
    });
    // La red falló: la intención (ya persistida) NO se borra — queda para
    // `intentarRevocacionesPendientes`.
    expect(borrarRevocacionPendientePorIdMock).not.toHaveBeenCalled();
  });

  it('punto 4 (ronda 6): al confirmar la revocación en el servidor, borra SOLO la entrada propia (por id) — nunca un borrado global', async () => {
    cargarSesionMovilMock.mockResolvedValue(sesion('T2'));
    guardarRevocacionPendienteMock.mockResolvedValue('id-t2');

    await ejecutarLogout('device-1');

    expect(guardarRevocacionPendienteMock).toHaveBeenCalledTimes(1);
    expect(borrarRevocacionPendientePorIdMock).toHaveBeenCalledWith('id-t2');
  });

  it('gap 4 (Codex, ronda 6): si el lease no se consigue ni con margen, NO lee/revoca/borra nada — marca la intención durable y devuelve "pendiente"', async () => {
    vi.useFakeTimers();
    try {
      adquirirLeaseMock.mockResolvedValue(false); // nunca se libera
      const promesa = ejecutarLogout('device-1');
      await vi.advanceTimersByTimeAsync(26_000); // TTL (20s) + margen (5s) de sobra

      await expect(promesa).resolves.toBe('pendiente');
      expect(cargarSesionMovilMock).not.toHaveBeenCalled();
      expect(logoutMock).not.toHaveBeenCalled();
      expect(borrarSesionMovilMock).not.toHaveBeenCalled();
      expect(guardarRevocacionPendienteMock).not.toHaveBeenCalled();
      expect(marcarLogoutSolicitadoMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  }, 10_000);

  it('gap 5 (Codex, ronda 6): si cargarSesionMovil falla repetidamente bajo el lease, propaga el error SIN borrar ni revocar nada', async () => {
    const error = new Error('SecureStore no disponible');
    cargarSesionMovilMock.mockRejectedValue(error);

    await expect(ejecutarLogout('device-1')).rejects.toBe(error);
    expect(cargarSesionMovilMock).toHaveBeenCalledTimes(3); // los 3 reintentos, todos fallaron
    expect(logoutMock).not.toHaveBeenCalled();
    expect(borrarSesionMovilMock).not.toHaveBeenCalled();
    expect(guardarRevocacionPendienteMock).not.toHaveBeenCalled();
  });

  it('gap 5: si cargarSesionMovil falla dos veces pero la 3ra lectura funciona, el logout completa normalmente', async () => {
    cargarSesionMovilMock
      .mockRejectedValueOnce(new Error('falla 1'))
      .mockRejectedValueOnce(new Error('falla 2'))
      .mockResolvedValueOnce(sesion('T2'));

    const resultado = await ejecutarLogout('device-1');

    expect(resultado).toBe('completado');
    expect(cargarSesionMovilMock).toHaveBeenCalledTimes(3);
    expect(logoutMock).toHaveBeenCalledWith('T2', 'device-1');
    expect(borrarSesionMovilMock).toHaveBeenCalledTimes(1);
  });

  it('un refresh que estaba esperando el MISMO lease y lo adquiere DESPUÉS del logout encuentra la sesión cerrada y aborta sin tocar la red ni persistir', async () => {
    // Estado posterior al logout: `borrarSesionMovil()` ya corrió, así que
    // `cargarSesionMovil()` (compartida por `ejecutarLogout` y `ejecutarRefresh`) resuelve
    // `null` para cualquiera que la llame después.
    cargarSesionMovilMock.mockResolvedValue(null);
    const guardadaVieja = sesion('T0-viejo-en-react');

    await expect(refrescar(guardadaVieja)).rejects.toBeInstanceOf(SesionCerradaEnRefreshError);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

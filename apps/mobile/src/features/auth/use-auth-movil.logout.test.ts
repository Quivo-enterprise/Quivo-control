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
  borrarRevocacionPendiente: vi.fn().mockResolvedValue(undefined),
  borrarSesionMovil: vi.fn().mockResolvedValue(undefined),
  cargarSesionMovil: vi.fn(),
  guardarRevocacionPendiente: vi.fn().mockResolvedValue(undefined),
  guardarSesionMovil: vi.fn(),
  leerRevocacionPendiente: vi.fn().mockResolvedValue(null),
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
  borrarRevocacionPendiente,
  borrarSesionMovil,
  cargarSesionMovil,
  guardarRevocacionPendiente,
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
const borrarRevocacionPendienteMock = borrarRevocacionPendiente as unknown as ReturnType<
  typeof vi.fn
>;
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
    guardarRevocacionPendienteMock.mockReset().mockResolvedValue(undefined);
    borrarRevocacionPendienteMock.mockReset().mockResolvedValue(undefined);
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

  it('marca la sesión como cerrada (borrarSesionMovil) tras revocar, ANTES de que la función retorne', async () => {
    cargarSesionMovilMock.mockResolvedValue(sesion('T2'));

    await ejecutarLogout('device-1');

    expect(borrarSesionMovilMock).toHaveBeenCalledTimes(1);
    // Orden: revocar server-side primero, borrar local después — si el borrado local
    // corriera antes y el POST de logout fallara, quedaría un estado local "deslogueado" con
    // la sesión todavía activa en el servidor.
    const ordenLogout = logoutMock.mock.invocationCallOrder[0];
    const ordenBorrar = borrarSesionMovilMock.mock.invocationCallOrder[0];
    expect(ordenLogout).toBeDefined();
    expect(ordenBorrar).toBeDefined();
    expect(ordenLogout as number).toBeLessThan(ordenBorrar as number);
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

  it('un fallo de red al revocar no impide la limpieza local, y persiste una revocación pendiente para reintentar', async () => {
    cargarSesionMovilMock.mockResolvedValue(sesion('T2'));
    logoutMock.mockRejectedValue(new Error('offline'));

    await expect(ejecutarLogout('device-1')).resolves.toBeUndefined();
    expect(borrarSesionMovilMock).toHaveBeenCalledTimes(1);
    expect(guardarRevocacionPendienteMock).toHaveBeenCalledWith({
      refreshToken: 'T2',
      deviceId: 'device-1',
      intentos: 0,
    });
  });

  it('una revocación exitosa borra cualquier revocación pendiente que hubiera quedado de un logout offline anterior', async () => {
    cargarSesionMovilMock.mockResolvedValue(sesion('T2'));

    await ejecutarLogout('device-1');

    expect(borrarRevocacionPendienteMock).toHaveBeenCalledTimes(1);
    expect(guardarRevocacionPendienteMock).not.toHaveBeenCalled();
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

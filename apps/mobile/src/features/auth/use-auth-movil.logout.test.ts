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
 * `ejecutarRefresh` — en vez de confiar en el argumento de memoria.
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
  borrarSesionMovil: vi.fn().mockResolvedValue(undefined),
  cargarSesionMovil: vi.fn(),
  guardarSesionMovil: vi.fn(),
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
  borrarSesionMovil,
  cargarSesionMovil,
  type SesionMovilGuardada,
} from '../../shared/security/sesion-movil-store';
import { adquirirLease } from '../../db/outbox';
import { ejecutarLogout, refrescar, SesionCerradaEnRefreshError } from './use-auth-movil';

const logoutMock = authMovilApi.logout as unknown as ReturnType<typeof vi.fn>;
const refreshMock = authMovilApi.refresh as unknown as ReturnType<typeof vi.fn>;
const cargarSesionMovilMock = cargarSesionMovil as unknown as ReturnType<typeof vi.fn>;
const borrarSesionMovilMock = borrarSesionMovil as unknown as ReturnType<typeof vi.fn>;
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
    adquirirLeaseMock.mockReset().mockResolvedValue(true);
  });

  it('con dos rotaciones headless (T0→T1→T2) y estado React desactualizado (T0), revoca con el token PERSISTIDO (T2), nunca con el de memoria', async () => {
    const t2EnDisco = sesion('T2');
    cargarSesionMovilMock.mockResolvedValue(t2EnDisco);

    await ejecutarLogout('T0', 'device-1');

    expect(logoutMock).toHaveBeenCalledTimes(1);
    expect(logoutMock).toHaveBeenCalledWith('T2', 'device-1');
    expect(logoutMock).not.toHaveBeenCalledWith('T0', expect.anything());
  });

  it('marca la sesión como cerrada (borrarSesionMovil) tras revocar, ANTES de que la función retorne', async () => {
    cargarSesionMovilMock.mockResolvedValue(sesion('T2'));

    await ejecutarLogout('T0', 'device-1');

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

  it('si no consigue el lease a tiempo (contención), degrada al token de memoria — best-effort, nunca peor que antes del fix', async () => {
    // `adquirirLeaseRefreshConEspera` (compartida con `ejecutarRefresh`) hace polling real con
    // `setTimeout` hasta agotar `TTL_LEASE_REFRESH_SESION_MS` (20 s) — timers falsos para no
    // hacer esperar 20 s reales a este test.
    vi.useFakeTimers();
    try {
      adquirirLeaseMock.mockResolvedValue(false);

      const promesa = ejecutarLogout('T0-memoria', 'device-1');
      // Margen sobre el TTL (20 s): el poll cada 150 ms no divide exacto al TTL, así que un
      // avance de EXACTAMENTE 20_000 puede dejar el último timer pendiente justo pasado el
      // borde sin dispararse — de sobra para cruzarlo con margen.
      await vi.advanceTimersByTimeAsync(30_000);
      await promesa;

      expect(cargarSesionMovilMock).not.toHaveBeenCalled();
      expect(logoutMock).toHaveBeenCalledWith('T0-memoria', 'device-1');
      expect(borrarSesionMovilMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sin refreshToken de memoria NI en disco (nunca hubo sesión), no llama a authMovilApi.logout pero sí limpia el almacenamiento local', async () => {
    cargarSesionMovilMock.mockResolvedValue(null);

    await ejecutarLogout(undefined, 'device-1');

    expect(logoutMock).not.toHaveBeenCalled();
    expect(borrarSesionMovilMock).toHaveBeenCalledTimes(1);
  });

  it('un fallo de red al revocar no impide la limpieza local (best-effort, igual que antes del fix)', async () => {
    cargarSesionMovilMock.mockResolvedValue(sesion('T2'));
    logoutMock.mockRejectedValue(new Error('offline'));

    await expect(ejecutarLogout('T0', 'device-1')).resolves.toBeUndefined();
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

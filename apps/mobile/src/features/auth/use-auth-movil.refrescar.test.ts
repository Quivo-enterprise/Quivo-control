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

// G1 (hallazgo de `/codex-debug verify-fix`): `refrescar()`/`ejecutarRefresh` ahora corren
// bajo el lease SQLite `refresh-sesion` (`db/outbox.ts`) — se mockea igual que
// `sesion-movil-store` (dependencia nativa vía `expo-sqlite`) y siempre "concede" el lease de
// inmediato, para no alterar el comportamiento/timing de los tests de ESTE archivo (que
// ejercitan un solo contexto JS a la vez — la contención real entre dos contextos se cubre
// en `use-auth-movil.refresh-lease.test.ts`).
vi.mock('../../db/outbox', () => ({
  abrirOutbox: vi.fn().mockResolvedValue({}),
  adquirirLease: vi.fn().mockResolvedValue(true),
  liberarLeaseConCooldown: vi.fn().mockResolvedValue(undefined),
  ID_LEASE_REFRESH_SESION: 'refresh-sesion',
  TTL_LEASE_REFRESH_SESION_MS: 15_000,
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

/** Tokens de refresh nuevos que devuelve el mock de `authMovilApi.refresh` en un éxito. */
function tokensRefrescados(refreshTokenNuevo: string) {
  return {
    accessToken: `access-${refreshTokenNuevo}`,
    refreshToken: refreshTokenNuevo,
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  };
}

describe('refrescar (single-flight)', () => {
  beforeEach(() => {
    refreshMock.mockReset();
    actualizarSesionMovilMock.mockReset();
    // G3/R4: `refrescar()` ahora relee disco ANTES de cualquier intento de red (ver
    // `reconciliarConDisco`, `use-auth-movil.ts`) — por defecto, sin sesión distinta en disco,
    // para no alterar el comportamiento de los tests de esta primera sección (que no ejercitan
    // la reconciliación en sí, ver la sección de abajo).
    cargarSesionMovilMock.mockReset().mockResolvedValue(null);
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

    // G3/R4: `refrescar()` ahora reconcilia contra disco (un `await` extra) ANTES de llegar al
    // single-flight/la red — `vi.waitFor` espera esa reconciliación en vez de asumir que
    // `refreshMock` ya fue invocado de forma síncrona.
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));

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

/**
 * G3/R4 (hallazgo de `/codex-debug verify-fix` sobre `ea3d84e`, ALTO): el diseño ANTERIOR
 * reconciliaba DESPUÉS de un 401 (intentaba con T0, capturaba el fallo, RECIÉN ahí releía
 * disco y reintentaba con T1 llamando DIRECTO a `intentarRefrescarConCircuito`, salteando el
 * single-flight de `refrescar()`). Eso tenía dos huecos:
 * - G3: el intento con T0 SIEMPRE contaba como fallo 401 real contra el circuit breaker — con
 *   4 fallos previos, ESE intento era el 5to y abría el circuito ANTES de poder reintentar con
 *   T1, bloqueando el reintento con `CircuitoRefreshAbiertoError`.
 * - R4: el reintento con T1 llamaba `intentarRefrescarConCircuito` directo, sin pasar por el
 *   single-flight — dos llamadas concurrentes (una con T0 viejo, otra ya con T1) podían
 *   disparar dos rotaciones en paralelo.
 *
 * El fix reconcilia ANTES de intentar (`reconciliarConDisco`, `use-auth-movil.ts`) — ver esa
 * función para el detalle. Este describe cubre el comportamiento nuevo.
 */
describe('refrescar — G3/R4 (verify-fix): reconciliar ANTES de enviar, nunca fuera del single-flight', () => {
  beforeEach(() => {
    refreshMock.mockReset();
    actualizarSesionMovilMock.mockReset();
    cargarSesionMovilMock.mockReset();
    reiniciarCircuitoRefresh();
  });

  it('T0 en memoria y T1 en SecureStore: reconcilia ANTES de la red — T0 NUNCA se envía, refresca directo con T1', async () => {
    const t0 = sesion('T0'); // lo que tiene `estado.sesion`/`guardada` en este contexto JS
    const enDisco = sesion('T1'); // lo que otro contexto (headless) ya rotó y persistió

    cargarSesionMovilMock.mockResolvedValue(enDisco);
    refreshMock.mockImplementation(async (token: string) => {
      if (token === 'T0') {
        throw new Error('no debería enviarse T0 nunca — la reconciliación va ANTES de la red');
      }
      return tokensRefrescados('T2');
    });
    const rotada = { ...enDisco, ...tokensRefrescados('T2') };
    actualizarSesionMovilMock.mockResolvedValue(rotada);

    const resultado = await refrescar(t0);

    expect(resultado).toBe(rotada);
    // UN solo intento de red — directo con T1, nunca con T0.
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledWith('T1');
    // Persiste sobre la sesión de DISCO (T1), no sobre la vieja (T0) — si persistiera sobre
    // `t0`, el `contexto`/resto de campos de la rotación de headless (que pudo traer más que
    // solo los tokens) se perdería.
    expect(actualizarSesionMovilMock).toHaveBeenCalledWith(enDisco, expect.objectContaining({ refreshToken: 'T2' }));
    // El circuito nunca llega a tocarse por T0 — cierra directo con el único éxito real.
    const estado = obtenerEstadoCircuitoRefresh();
    expect(estado.estado).toBe('cerrado');
    expect(estado.fallosConsecutivos).toBe(0);
  });

  it('G3: con 4 fallos previos en el circuito, reconciliar ANTES evita que T0 sea el 5to fallo que abriría el circuito y bloquearía el reintento con T1', async () => {
    // 4 fallos 401 reales previos (uno menos que UMBRAL_FALLOS_ABRIR_CIRCUITO = 5) contra un
    // token descartable, sin sesión distinta en disco — el circuito queda cerrado pero al
    // borde.
    const descartable = sesion('token-agotado');
    cargarSesionMovilMock.mockResolvedValue(null);
    refreshMock.mockRejectedValue(new AuthMovilApiError('http', 'Sesión revocada', 401));
    for (let intento = 0; intento < 4; intento++) {
      await expect(refrescar(descartable)).rejects.toThrow('Sesión revocada');
    }
    expect(obtenerEstadoCircuitoRefresh()).toMatchObject({ estado: 'cerrado', fallosConsecutivos: 4 });

    // Ahora: T0 en memoria, T1 en disco (otro contexto lo rotó mientras tanto). Con el diseño
    // VIEJO, el 401 de T0 sería el 5to fallo — abriría el circuito ANTES de poder reintentar
    // con T1, y el reintento hubiera quedado bloqueado por el circuito que su propio intento
    // acababa de abrir.
    const t0 = sesion('T0');
    const enDisco = sesion('T1');
    cargarSesionMovilMock.mockResolvedValue(enDisco);
    refreshMock.mockImplementation(async (token: string) => {
      if (token === 'T0') {
        throw new Error('no debería enviarse T0 — sería el 5to fallo y abriría el circuito en falso');
      }
      return tokensRefrescados('T2');
    });
    const rotada = { ...enDisco, ...tokensRefrescados('T2') };
    actualizarSesionMovilMock.mockResolvedValue(rotada);

    const resultado = await refrescar(t0);

    expect(resultado).toBe(rotada);
    expect(refreshMock).not.toHaveBeenCalledWith('T0');
    expect(refreshMock).toHaveBeenLastCalledWith('T1');
    // El circuito NUNCA se abre — el éxito con T1 lo cierra del todo (nunca pasó por el 5to
    // fallo que el diseño viejo hubiera contado).
    const estado = obtenerEstadoCircuitoRefresh();
    expect(estado.estado).toBe('cerrado');
    expect(estado.fallosConsecutivos).toBe(0);
  });

  it('R4: dos llamadas concurrentes con T0 (viejo) en memoria reconcilian a T1 (disco) y comparten UNA sola request — nunca dos rotaciones en paralelo', async () => {
    const enDisco = sesion('T1');
    cargarSesionMovilMock.mockResolvedValue(enDisco);
    let resolverRefresh!: (tokens: ReturnType<typeof tokensRefrescados>) => void;
    refreshMock.mockImplementation((token: string) => {
      if (token === 'T0') {
        throw new Error('no debería enviarse T0 — dos llamadas concurrentes deben reconciliar y compartir UNA request con T1');
      }
      return new Promise((resolve) => {
        resolverRefresh = resolve;
      });
    });
    const rotada = { ...enDisco, ...tokensRefrescados('T2') };
    actualizarSesionMovilMock.mockResolvedValue(rotada);

    const p1 = refrescar(sesion('T0'));
    const p2 = refrescar(sesion('T0'));

    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(refreshMock).toHaveBeenCalledWith('T1');

    resolverRefresh(tokensRefrescados('T2'));
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBe(rotada);
    expect(r2).toBe(rotada);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('si el token en disco es el MISMO que en memoria, el 401 es real — un solo intento, sin reintento', async () => {
    const t0 = sesion('T0');
    cargarSesionMovilMock.mockResolvedValue(sesion('T0')); // disco NO tiene un token distinto
    refreshMock.mockRejectedValue(new AuthMovilApiError('http', 'Sesión revocada', 401));

    await expect(refrescar(t0)).rejects.toThrow('Sesión revocada');
    // Sin token distinto en disco, la reconciliación no cambia nada — un solo intento con T0,
    // y el 401 es de verdad (no hay evidencia de carrera que justifique un valor distinto).
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('sin sesión en disco (logout concurrente), el 401 se propaga sin reintentar', async () => {
    const t0 = sesion('T0');
    cargarSesionMovilMock.mockResolvedValue(null);
    refreshMock.mockRejectedValue(new AuthMovilApiError('http', 'Sesión revocada', 401));

    await expect(refrescar(t0)).rejects.toThrow('Sesión revocada');
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('un error de RED (no 401) no dispara un segundo intento — sigue siendo offline legítimo', async () => {
    const t0 = sesion('T0');
    // La reconciliación (lectura de disco) corre SIEMPRE, ANTES de la red — a diferencia del
    // diseño viejo, que solo releía disco DESPUÉS de un 401. Sin token distinto en disco, eso
    // no cambia el resultado: un error de red sigue sin disparar ningún reintento.
    cargarSesionMovilMock.mockResolvedValue(null);
    refreshMock.mockRejectedValue(new AuthMovilApiError('network', 'Sin conexión'));

    await expect(refrescar(t0)).rejects.toThrow('Sin conexión');
    // G1 (hallazgo de `/codex-debug verify-fix`): DOS lecturas de disco, no una — la de
    // `refrescar()` (rápida, fuera del lease) y la de `ejecutarRefresh` bajo el lease
    // `refresh-sesion` (la comprobación AUTORITATIVA, ver su docblock en `use-auth-movil.ts`).
    // Sin token distinto en ninguna de las dos, el resultado no cambia: un solo intento de red.
    expect(cargarSesionMovilMock).toHaveBeenCalledTimes(2);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});

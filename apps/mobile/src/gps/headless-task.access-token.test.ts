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

// G1 (hallazgo de `/codex-debug verify-fix`): `refrescar()` (`use-auth-movil.ts`, llamado
// desde `obtenerAccessTokenHeadless`) ahora corre bajo el lease SQLite `refresh-sesion` —
// `adquirirLease`/`liberarLeaseConCooldown` se mockean concediendo el lease de inmediato, sin
// alterar el comportamiento/timing de estos tests (un solo contexto simulado a la vez).
vi.mock('../db/outbox', () => ({
  abrirOutbox: vi.fn().mockResolvedValue({}),
  encolarEvento: vi.fn(),
  encolarEventoYLimpiarVisita: vi.fn(),
  guardarVisitaPendiente: vi.fn().mockResolvedValue(undefined),
  eliminarVisitaPendiente: vi.fn().mockResolvedValue(undefined),
  obtenerVisitasPendientes: vi.fn().mockResolvedValue([]),
  obtenerEventosPorTipo: vi.fn(),
  adquirirLease: vi.fn().mockResolvedValue(true),
  liberarLeaseConCooldown: vi.fn().mockResolvedValue(undefined),
  // G1 ronda 4: `ejecutarRefresh` renueva (compare-and-set) el lease antes de persistir.
  renovarLease: vi.fn().mockResolvedValue(true),
  ID_LEASE_REFRESH_SESION: 'refresh-sesion',
  TTL_LEASE_REFRESH_SESION_MS: 20_000,
}));

vi.mock('../db/paquete-dia', () => ({
  abrirPaqueteDiaDb: vi.fn(),
  obtenerPaqueteDiaLocal: vi.fn(),
}));

vi.mock('../features/operacion/drenaje-oportunista', () => ({
  intentarDrenarOportunista: vi.fn().mockResolvedValue(undefined),
}));

// REDISEÑO (anuncio de puntos de control): `anuncio-punto-control.ts` importa
// `expo-notifications`/`expo-speech`, que arrastran el paquete `expo` (su `async-require`
// referencia el global `__DEV__` de React Native, indefinido bajo vitest/Node) — se mockea
// entero para que `import './headless-task'` no lo evalúe de verdad. Este archivo solo
// ejercita `obtenerAccessTokenHeadless`, que no toca este módulo.
vi.mock('../features/operacion/anuncio-punto-control', () => ({
  anunciarDeteccionesDelTick: vi.fn().mockResolvedValue(undefined),
  anunciarLlegadaPuntoControl: vi.fn().mockResolvedValue(undefined),
  reintentarAnunciosLlegadaPendientes: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../shared/security/sesion-movil-store', () => ({
  actualizarSesionMovil: vi.fn(),
  cargarSesionMovil: vi.fn(),
  hayLogoutSolicitado: vi.fn().mockResolvedValue(false),
  // Rescope SESION_NO_VIGENTE (reemplaza `borrarSesionMovil`, que `headless-task.ts` ya no
  // importa): el nuevo diseño marca un flag durable en vez de borrar la sesión — ver el
  // docblock de `obtenerAccessTokenHeadless`.
  haySesionNoVigenteParaToken: vi.fn().mockResolvedValue(false),
  marcarSesionNoVigenteHeadless: vi.fn().mockResolvedValue(undefined),
  obtenerDeviceIdMovil: vi.fn(),
}));

vi.mock('../shared/api/auth-movil-api', async () => {
  const actual = await vi.importActual<typeof import('../shared/api/auth-movil-api')>(
    '../shared/api/auth-movil-api',
  );
  return { ...actual, authMovilApi: { refresh: vi.fn() } };
});

import { authMovilApi, AuthMovilApiError } from '../shared/api/auth-movil-api';
import {
  obtenerEstadoCircuitoRefresh,
  reiniciarCircuitoRefresh,
} from '../shared/api/refresh-circuit-breaker';
import {
  actualizarSesionMovil,
  cargarSesionMovil,
  haySesionNoVigenteParaToken,
  marcarSesionNoVigenteHeadless,
  type SesionMovilGuardada,
} from '../shared/security/sesion-movil-store';
import { obtenerAccessTokenHeadless } from './headless-task';

const refreshMock = authMovilApi.refresh as unknown as ReturnType<typeof vi.fn>;
const cargarSesionMovilMock = cargarSesionMovil as unknown as ReturnType<typeof vi.fn>;
const actualizarSesionMovilMock = actualizarSesionMovil as unknown as ReturnType<typeof vi.fn>;
const haySesionNoVigenteParaTokenMock = haySesionNoVigenteParaToken as unknown as ReturnType<
  typeof vi.fn
>;
const marcarSesionNoVigenteHeadlessMock = marcarSesionNoVigenteHeadless as unknown as ReturnType<
  typeof vi.fn
>;

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
    haySesionNoVigenteParaTokenMock.mockReset().mockResolvedValue(false);
    marcarSesionNoVigenteHeadlessMock.mockReset().mockResolvedValue(undefined);
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
    expect(actualizarSesionMovilMock).toHaveBeenCalledWith(
      vencida,
      expect.objectContaining({ accessToken: 'access-nueva' }),
    );
  });

  it('si el refresh falla (401), devuelve null en silencio — falla de TRANSPORTE, nunca de captura', async () => {
    const vencida = sesion();
    cargarSesionMovilMock.mockResolvedValue(vencida);
    refreshMock.mockRejectedValueOnce(new AuthMovilApiError('http', 'Sesión inválida', 401));

    await expect(obtenerAccessTokenHeadless()).resolves.toBeNull();
    expect(actualizarSesionMovilMock).not.toHaveBeenCalled();
  });

  it('hallazgo 4: N llamadas concurrentes con token vencido comparten UN solo refresh a la API (single-flight de refrescar())', async () => {
    // Escenario del hallazgo: con fixes headless a ~1/s y el access token vencido, ANTES cada
    // tick llamaba `intentarRefrescarConCircuito` directo (sin dedupe) — N ticks concurrentes
    // disparaban N refreshes reales. El servidor rota el refresh token de forma atómica: 1
    // gana, N-1 reciben 401 real, y con 5 o más el circuito se abría EN FALSO. El fix reusa
    // `refrescar()` (`use-auth-movil.ts`), que es single-flight por `refreshToken`.
    const vencida = sesion();
    cargarSesionMovilMock.mockResolvedValue(vencida);

    let resolverRefresh!: (valor: unknown) => void;
    refreshMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolverRefresh = resolve;
        }),
    );
    const rotada = { ...vencida, accessToken: 'access-nueva', refreshToken: 'refresh-2' };
    actualizarSesionMovilMock.mockResolvedValue(rotada);

    // 3 llamadas concurrentes, sin await entre ellas — el escenario real es N ticks casi
    // simultáneos del mismo (o de un token) contexto JS.
    const llamadas = [
      obtenerAccessTokenHeadless(),
      obtenerAccessTokenHeadless(),
      obtenerAccessTokenHeadless(),
    ];

    // Deja que las tres lleguen hasta el punto de espera del refresh antes de resolverlo.
    // G3/R4 (`use-auth-movil.ts`): `refrescar()` ahora reconcilia contra disco (un `await`
    // extra, `cargarSesionMovil()` de nuevo) ANTES de tocar la red — `vi.waitFor` espera esa
    // reconciliación en vez de asumir una cantidad fija de microtask ticks.
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1)); // no 3 — ver el docblock del fix.

    resolverRefresh({
      accessToken: 'access-nueva',
      refreshToken: 'refresh-2',
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    const resultados = await Promise.all(llamadas);
    expect(resultados).toEqual(['access-nueva', 'access-nueva', 'access-nueva']);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    // El circuito no se abre por esta concurrencia (no hubo NINGÚN 401 real, solo un éxito
    // compartido).
    expect(obtenerEstadoCircuitoRefresh().estado).toBe('cerrado');
  });

  /**
   * Rescope SESION_NO_VIGENTE (decisión del CTO, code review de `fix/sesion-no-vigente` —
   * REEMPLAZA el test viejo que esperaba `borrarSesionMovil()`): borrar la sesión acá hacía que
   * `obtenerContextoUbicacionPersistido` la tratara como "sin sesión" y llamara
   * `detenerTrackingNativo()` — IRREVERSIBLE, apaga la captura GPS del resto del turno. Ahora
   * se marca un flag durable (`marcarSesionNoVigenteHeadless`) y la sesión queda INTACTA
   * (`cargarSesionMovil`/`actualizarSesionMovil` nunca se llaman para borrar nada acá).
   */
  it('SESION_NO_VIGENTE: NO borra la sesión — marca el flag durable, mantiene el contexto y no abre el circuito', async () => {
    const vencida = sesion();
    cargarSesionMovilMock.mockResolvedValue(vencida);
    refreshMock.mockRejectedValueOnce(
      new AuthMovilApiError(
        'http',
        'Sesión móvil inválida o expirada',
        401,
        undefined,
        'SESION_NO_VIGENTE',
      ),
    );

    await expect(obtenerAccessTokenHeadless()).resolves.toBeNull();
    expect(marcarSesionNoVigenteHeadlessMock).toHaveBeenCalledWith('refresh-1');
    expect(actualizarSesionMovilMock).not.toHaveBeenCalled();
    // Evidencia definitiva, no ambigua: no cuenta contra el circuito de refresh.
    expect(obtenerEstadoCircuitoRefresh().estado).toBe('cerrado');
  });

  /**
   * Cierra el hallazgo "el borrado fallido reintentaba cada ~10 s sin backoff": con el flag ya
   * puesto (simulando el tick SIGUIENTE al de arriba), el próximo tick corta de entrada, ANTES
   * de tocar `accessTokenExpiresAt` o la red — cero llamadas a `refresh`.
   */
  it('con el flag SESION_NO_VIGENTE ya puesto para este token, el siguiente tick no llama a refresh (sin ráfaga)', async () => {
    const vencida = sesion();
    cargarSesionMovilMock.mockResolvedValue(vencida);
    haySesionNoVigenteParaTokenMock.mockResolvedValue(true);

    await expect(obtenerAccessTokenHeadless()).resolves.toBeNull();
    expect(haySesionNoVigenteParaTokenMock).toHaveBeenCalledWith('refresh-1');
    expect(refreshMock).not.toHaveBeenCalled();
  });

  /**
   * B (rescope): si, para cuando se relee el token bajo el lease `refresh-sesion`, el disco ya
   * tiene un refresh token DISTINTO (un login nuevo ganó la carrera mientras el rechazo viajaba
   * de vuelta), el error se descarta — nunca se marca el flag sobre una sesión que ya no es la
   * rechazada. La secuencia de `cargarSesionMovilMock` cubre las 4 lecturas del camino real: (1)
   * el `cargarSesionMovil()` inicial de `obtenerAccessTokenHeadless`, (2) la reconciliación de
   * `refrescar()`, (3) la lectura autoritativa bajo lease de `ejecutarRefresh` — las tres ven
   * TODAVÍA `refresh-1` para que el intento de red real ocurra y sea rechazado — y (4) la
   * relectura de `confirmarTokenRechazadoVigente`, que ya ve el token NUEVO del login.
   */
  it('token-mismatch: si el disco ya tiene un token distinto (login nuevo) al confirmar, descarta el rechazo sin marcar el flag', async () => {
    const vencida = sesion();
    const trasLoginNuevo = sesion({ refreshToken: 'refresh-de-otro-login' });
    cargarSesionMovilMock
      .mockResolvedValueOnce(vencida) // (1)
      .mockResolvedValueOnce(vencida) // (2)
      .mockResolvedValueOnce(vencida) // (3)
      .mockResolvedValueOnce(trasLoginNuevo); // (4)
    refreshMock.mockRejectedValueOnce(
      new AuthMovilApiError(
        'http',
        'Sesión móvil inválida o expirada',
        401,
        undefined,
        'SESION_NO_VIGENTE',
      ),
    );

    await expect(obtenerAccessTokenHeadless()).resolves.toBeNull();
    expect(marcarSesionNoVigenteHeadlessMock).not.toHaveBeenCalled();
  });

  it('un 401 SIN codigo (genérico) NO marca el flag de SESION_NO_VIGENTE — sigue el camino viejo de "no revalidada"', async () => {
    const vencida = sesion();
    cargarSesionMovilMock.mockResolvedValue(vencida);
    refreshMock.mockRejectedValueOnce(new AuthMovilApiError('http', 'Sesión inválida', 401));

    await expect(obtenerAccessTokenHeadless()).resolves.toBeNull();
    expect(marcarSesionNoVigenteHeadlessMock).not.toHaveBeenCalled();
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

import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';

// Hallazgo 3 (MEDIO, code review sobre el hallazgo 1 de `docs/plan-v2-app-y-mapa-en-vivo.md`
// §2.4): `obtenerContextoUbicacionPersistido` (`headless-task.ts`) puede quedar corriendo el
// tracker toda la noche si el paquete del día guardado en SQLite es de OTRA asignación (la
// fila sobrevive al logout) — `interpretarFilaPaqueteDia` lo rechaza y `paqueteLocal` queda
// `null`, y con la lógica vieja eso saltaba ENTERA la rama de vencimiento (ni descarte
// inmediato del punto ni, tras la gracia, el `stop()` del plugin nativo). Este archivo cubre
// que el vencimiento ahora se evalúa contra `sesion.contexto.asignacion.venceAt` — la sesión
// activa, siempre disponible — y no contra el paquete local, que puede faltar.
//
// Se mockean `../db/outbox`, `../db/paquete-dia`, `../shared/security/sesion-movil-store`,
// `@sentry/react-native`, `react-native-background-geolocation` y (Entrega 2)
// `../features/operacion/drenaje-oportunista` porque todos traen, directa o
// transitivamente (`use-auth-movil.ts` → `db/outbox` para el lease `refresh-sesion`),
// dependencias nativas (`expo-sqlite`, `expo-crypto`, `expo-secure-store`) que rompen bajo
// vitest/Node — mismo motivo documentado en `db/paquete-dia-local.ts` y en
// `use-auth-movil.refrescar.test.ts`. `obtenerContextoUbicacionPersistido` solo orquesta
// llamadas a esos módulos; el mock de `drenaje-oportunista` es puramente para que
// `import './headless-task'` (que ahora importa `refrescar` de `use-auth-movil.ts` para
// `obtenerAccessTokenHeadless`) no arrastre esa cadena al evaluar el módulo.
vi.mock('react-native-background-geolocation', () => ({
  default: {
    getState: vi.fn(),
    stop: vi.fn(),
  },
}));

vi.mock('@sentry/react-native', () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

// FIX POST-REVISIÓN (bug 5): `registrarPuntoGpsInterno` ahora también llama a
// `encolarEventoYLimpiarVisita` (confirmaciones, transaccional con `visitas_pendientes`),
// `guardarVisitaPendiente`/`eliminarVisitaPendiente` (housekeeping best-effort por tick) y
// `obtenerVisitasPendientes` (siembra) — se mockean igual que el resto de `../db/outbox`.
// `encolarEventoYLimpiarVisita` delega en el mismo mock que `encolarEvento` para que los tests
// existentes, que solo configuran `encolarEventoMock`, sigan viendo el mismo `eventId` resuelto
// también en el camino de confirmación (que antes de este fix pasaba por `encolarEvento`
// directo).
vi.mock('../db/outbox', () => {
  const encolarEvento = vi.fn();
  return {
    abrirOutbox: vi.fn(),
    encolarEvento,
    encolarEventoYLimpiarVisita: vi.fn((db: unknown, evento: unknown) => encolarEvento(db, evento)),
    guardarVisitaPendiente: vi.fn().mockResolvedValue(undefined),
    eliminarVisitaPendiente: vi.fn().mockResolvedValue(undefined),
    obtenerVisitasPendientes: vi.fn().mockResolvedValue([]),
    obtenerEventosPorTipo: vi.fn(),
    // G1 (hallazgo de `/codex-debug verify-fix`): importar `headless-task.ts` evalúa
    // transitivamente `use-auth-movil.ts` (vía `refrescar`, `obtenerAccessTokenHeadless`), que
    // ahora importa `db/outbox` para el lease `refresh-sesion` — se completan los exports
    // aunque este archivo no ejercite ese camino (el drenado mismo va mockeado, ver abajo),
    // para que el import del módulo no falle.
    adquirirLease: vi.fn().mockResolvedValue(true),
    liberarLeaseConCooldown: vi.fn().mockResolvedValue(undefined),
    ID_LEASE_REFRESH_SESION: 'refresh-sesion',
    TTL_LEASE_REFRESH_SESION_MS: 15_000,
  };
});

vi.mock('../db/paquete-dia', () => ({
  abrirPaqueteDiaDb: vi.fn(),
  obtenerPaqueteDiaLocal: vi.fn(),
}));

vi.mock('../shared/security/sesion-movil-store', () => ({
  cargarSesionMovil: vi.fn(),
  hayLogoutSolicitado: vi.fn().mockResolvedValue(false),
  obtenerDeviceIdMovil: vi.fn(),
}));

// Entrega 2 (drenado oportunista del outbox en background): `tareaHeadlessUbicacion` llama a
// `intentarDrenarOportunista` como ÚLTIMA línea, para 'location' Y 'heartbeat' — se mockea
// entero (nunca rechaza, igual que el real) para que los tests de ESTE archivo (enfocados en
// la escritura de evidencia/anuncios) no dependan de red ni de `obtenerAccessTokenHeadless`.
vi.mock('../features/operacion/drenaje-oportunista', () => ({
  intentarDrenarOportunista: vi.fn().mockResolvedValue(undefined),
}));

// Progreso de la vuelta (RF-GPS-054): su almacén toca SQLite real — se mockea; su lógica se prueba en
// `progreso-vuelta*.test.ts`.
vi.mock('../features/operacion/progreso-vuelta-store', () => ({
  registrarPasoEnVuelta: vi.fn().mockResolvedValue(undefined),
  // Fase del circuito (ida/regreso): sin filtro por defecto, todos los PC se detectan.
  puntosDeLaFaseActual: vi.fn(async (_db: unknown, _sesionId: string, puntosControl: unknown[]) => puntosControl),
}));

// ENTREGA 7 (plan post-piloto 2026-09-09, "anuncio desde headless"): `anunciarDeteccionesDelTick`
// dispara `expo-notifications`/`expo-speech`/`Vibration`, que a su vez importan `react-native`
// (rompe bajo vitest/Node, ver `anuncio-punto-control.test.ts`) — se mockea el módulo entero
// para que este archivo pueda seguir enfocado en la ORQUESTACIÓN (¿se llama?, ¿con qué?), no en
// el contenido del anuncio, que ya cubre su propio test.
vi.mock('../features/operacion/anuncio-punto-control', () => ({
  anunciarDeteccionesDelTick: vi.fn().mockResolvedValue(undefined),
  // REDISEÑO: el handler de heartbeat (`manejarHeartbeatHeadless`) ejecuta las decisiones YA
  // tomadas (`anunciosLlegada`) llamando `anunciarLlegadaPuntoControl` directo — mockeado igual,
  // sin contenido. `reintentarAnunciosLlegadaPendientes` corre dentro de `conTimeout`, en cada
  // turno de la cola (`ejecutarEnColaRegistroGps`).
  anunciarLlegadaPuntoControl: vi.fn().mockResolvedValue(undefined),
  reintentarAnunciosLlegadaPendientes: vi.fn().mockResolvedValue(undefined),
}));

import BackgroundGeolocation, { type HeadlessEvent, type Location } from 'react-native-background-geolocation';
import * as Sentry from '@sentry/react-native';
import { derivarEventIdDeterministico, type PuntoControlPaquete } from '@quivo/shared';
import { abrirPaqueteDiaDb, obtenerPaqueteDiaLocal, type PaqueteDiaLocal } from '../db/paquete-dia';
import {
  abrirOutbox,
  encolarEvento,
  guardarVisitaPendiente,
  obtenerEventosPorTipo,
  obtenerVisitasPendientes,
} from '../db/outbox';
import {
  cargarSesionMovil,
  hayLogoutSolicitado,
  obtenerDeviceIdMovil,
  type SesionMovilGuardada,
} from '../shared/security/sesion-movil-store';
import {
  anunciarDeteccionesDelTick,
  anunciarLlegadaPuntoControl,
  reintentarAnunciosLlegadaPendientes,
} from '../features/operacion/anuncio-punto-control';
import { intentarDrenarOportunista } from '../features/operacion/drenaje-oportunista';
import { puntosDeLaFaseActual } from '../features/operacion/progreso-vuelta-store';
import {
  obtenerContextoUbicacionPersistido,
  registrarPuntoGps,
  tareaHeadlessUbicacion,
} from './headless-task';

const cargarSesionMovilMock = cargarSesionMovil as unknown as ReturnType<typeof vi.fn>;
const hayLogoutSolicitadoMock = hayLogoutSolicitado as unknown as ReturnType<typeof vi.fn>;
const intentarDrenarOportunistaMock = intentarDrenarOportunista as unknown as ReturnType<typeof vi.fn>;
const obtenerDeviceIdMovilMock = obtenerDeviceIdMovil as unknown as ReturnType<typeof vi.fn>;
const abrirPaqueteDiaDbMock = abrirPaqueteDiaDb as unknown as ReturnType<typeof vi.fn>;
const obtenerPaqueteDiaLocalMock = obtenerPaqueteDiaLocal as unknown as ReturnType<typeof vi.fn>;
const getStateMock = BackgroundGeolocation.getState as unknown as ReturnType<typeof vi.fn>;
const stopMock = BackgroundGeolocation.stop as unknown as ReturnType<typeof vi.fn>;
const abrirOutboxMock = abrirOutbox as unknown as ReturnType<typeof vi.fn>;
const encolarEventoMock = encolarEvento as unknown as ReturnType<typeof vi.fn>;
const obtenerEventosPorTipoMock = obtenerEventosPorTipo as unknown as ReturnType<typeof vi.fn>;
const obtenerVisitasPendientesMock = obtenerVisitasPendientes as unknown as ReturnType<typeof vi.fn>;
const guardarVisitaPendienteMock = guardarVisitaPendiente as unknown as ReturnType<typeof vi.fn>;
const anunciarDeteccionesDelTickMock = anunciarDeteccionesDelTick as unknown as ReturnType<
  typeof vi.fn
>;
const anunciarLlegadaPuntoControlMock = anunciarLlegadaPuntoControl as unknown as ReturnType<
  typeof vi.fn
>;
const reintentarAnunciosLlegadaPendientesMock =
  reintentarAnunciosLlegadaPendientes as unknown as ReturnType<typeof vi.fn>;
const captureExceptionMock = Sentry.captureException as unknown as ReturnType<typeof vi.fn>;

/** Sesión mínima "autenticado" — sólo lo que lee `obtenerContextoUbicacionPersistido`. El
 * resto del contrato de `SesionMovilGuardada` (vehículo, conductor, sindicato, etc.) no le
 * importa a este código, así que se castea en vez de rellenarlo entero. */
function sesion(venceAtIso: string, asignacionId = 'asignacion-1'): SesionMovilGuardada {
  return {
    status: 'autenticado',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    contexto: {
      sesionId: 'sesion-1',
      asignacion: { id: asignacionId, fecha: '2026-08-18', horario: 'manana', venceAt: venceAtIso },
    },
  } as unknown as SesionMovilGuardada;
}

function paqueteLocalDe(venceAtIso: string): PaqueteDiaLocal {
  return {
    paquete: {
      asignacion: { id: 'asignacion-1', venceAt: venceAtIso },
      puntosControl: [{ id: 'pc-1' }],
    },
    vencido: new Date(venceAtIso).getTime() <= Date.now(),
    descargadoEn: new Date().toISOString(),
  } as unknown as PaqueteDiaLocal;
}

describe('obtenerContextoUbicacionPersistido — hallazgo 3 (vencimiento evaluado contra la sesión)', () => {
  beforeEach(() => {
    cargarSesionMovilMock.mockReset();
    hayLogoutSolicitadoMock.mockReset().mockResolvedValue(false);
    obtenerDeviceIdMovilMock.mockReset().mockResolvedValue('device-1');
    abrirPaqueteDiaDbMock.mockReset().mockResolvedValue({});
    obtenerPaqueteDiaLocalMock.mockReset();
    getStateMock.mockReset().mockResolvedValue({ enabled: true });
    stopMock.mockReset().mockResolvedValue(undefined);
  });

  it('detiene el tracking nativo tras el margen de gracia cuando la sesión venció, aunque el paquete local no matchee (identidad, hallazgo 1)', async () => {
    // 3h vencida: supera el margen de gracia de 2h (`GRACIA_STOP_TRAS_VENCIMIENTO_MS`).
    const venceAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    cargarSesionMovilMock.mockResolvedValue(sesion(venceAt));
    // `obtenerPaqueteDiaLocal` devuelve `null` — la fila de SQLite es de OTRA asignación
    // (rechazada por `interpretarFilaPaqueteDia`, hallazgo 1). Antes del fix, esto saltaba
    // toda la rama de vencimiento y el `stop()` nunca se disparaba.
    obtenerPaqueteDiaLocalMock.mockResolvedValue(null);

    const contexto = await obtenerContextoUbicacionPersistido();

    expect(contexto).toBeNull();
    expect(stopMock).toHaveBeenCalledTimes(1);
  });

  it('NO detiene el tracking todavía si el vencimiento de la sesión está dentro del margen de gracia', async () => {
    // 5 minutos vencida: dentro del margen de gracia de 2h.
    const venceAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    cargarSesionMovilMock.mockResolvedValue(sesion(venceAt));
    obtenerPaqueteDiaLocalMock.mockResolvedValue(null);

    const contexto = await obtenerContextoUbicacionPersistido();

    expect(contexto).toBeNull();
    expect(stopMock).not.toHaveBeenCalled();
  });

  it('sigue registrando el punto (sin puntos de control) cuando la sesión NO venció, aunque el paquete local no matchee', async () => {
    const venceAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    cargarSesionMovilMock.mockResolvedValue(sesion(venceAt));
    obtenerPaqueteDiaLocalMock.mockResolvedValue(null);
    obtenerDeviceIdMovilMock.mockResolvedValue('device-xyz');

    const contexto = await obtenerContextoUbicacionPersistido();

    expect(contexto).toEqual({ deviceId: 'device-xyz', sesionId: 'sesion-1', puntosControl: [] });
    expect(stopMock).not.toHaveBeenCalled();
  });

  it('usa los puntos de control del paquete local cuando SÍ matchea la asignación de la sesión y no está vencido', async () => {
    const venceAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    cargarSesionMovilMock.mockResolvedValue(sesion(venceAt));
    obtenerPaqueteDiaLocalMock.mockResolvedValue(paqueteLocalDe(venceAt));

    const contexto = await obtenerContextoUbicacionPersistido();

    expect(contexto).not.toBeNull();
    expect(contexto?.puntosControl).toEqual([{ id: 'pc-1' }]);
    expect(stopMock).not.toHaveBeenCalled();
  });
});

describe('obtenerContextoUbicacionPersistido — fix drenado en background (punto 2, marca de logout pendiente)', () => {
  beforeEach(() => {
    cargarSesionMovilMock.mockReset();
    hayLogoutSolicitadoMock.mockReset();
    obtenerDeviceIdMovilMock.mockReset().mockResolvedValue('device-1');
    abrirPaqueteDiaDbMock.mockReset().mockResolvedValue({});
    obtenerPaqueteDiaLocalMock.mockReset();
    getStateMock.mockReset().mockResolvedValue({ enabled: true });
    stopMock.mockReset().mockResolvedValue(undefined);
  });

  it('con la marca de logout pendiente presente, detiene el tracking y descarta el punto aunque la sesión en disco siga vigente', async () => {
    const venceAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    cargarSesionMovilMock.mockResolvedValue(sesion(venceAt));
    hayLogoutSolicitadoMock.mockResolvedValue(true);

    const contexto = await obtenerContextoUbicacionPersistido();

    expect(contexto).toBeNull();
    expect(stopMock).toHaveBeenCalledTimes(1);
    // No debe llegar a evaluar el paquete del día: se corta antes.
    expect(obtenerPaqueteDiaLocalMock).not.toHaveBeenCalled();
  });

  it('si la LECTURA de la marca falla, descarta el punto de este tick pero NO detiene el tracker (punto 2)', async () => {
    const venceAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    cargarSesionMovilMock.mockResolvedValue(sesion(venceAt));
    hayLogoutSolicitadoMock.mockRejectedValue(new Error('SecureStore no disponible'));

    const contexto = await obtenerContextoUbicacionPersistido();

    expect(contexto).toBeNull();
    // Un error transitorio de Keystore no es evidencia de logout: fail-closed sobre la
    // atribución del punto (se descarta), NO sobre el tracker (irreversible: desactiva
    // `startOnBoot`). El próximo tick reintenta la lectura.
    expect(stopMock).not.toHaveBeenCalled();
    expect(obtenerPaqueteDiaLocalMock).not.toHaveBeenCalled();
  });

  it('sin marca de logout pendiente, sigue registrando el punto como antes', async () => {
    const venceAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    cargarSesionMovilMock.mockResolvedValue(sesion(venceAt));
    hayLogoutSolicitadoMock.mockResolvedValue(false);
    obtenerPaqueteDiaLocalMock.mockResolvedValue(null);

    const contexto = await obtenerContextoUbicacionPersistido();

    expect(contexto).not.toBeNull();
    expect(stopMock).not.toHaveBeenCalled();
  });
});

/**
 * ENTREGA 7 (plan post-piloto 2026-09-09, "anuncio desde headless" — "probablemente el arreglo
 * más importante del plan"): cubre que `tareaHeadlessUbicacion` efectivamente llama a
 * `anunciarDeteccionesDelTick` con lo que devuelve `registrarPuntoGps` — la razón de ser de
 * esta entrega es exactamente esta línea de wiring, la que faltaba y dejaba "sin sonido" a un
 * chofer con la pantalla apagada (reporte de Rosa).
 *
 * A propósito NO se mockea `construirEventosDeUbicacion` (`./location-task`, la máquina de
 * detección real) ni `../db/outbox` más allá de `encolarEvento`/`obtenerEventosPorTipo`: usar
 * un punto de control y una ubicación reales (mismo patrón que `location-task.test.ts`) prueba
 * el camino END TO END — desde el fix GPS hasta la llamada al anuncio — en vez de solo que "la
 * función mockeada se invocó con lo que el propio mock le dio".
 */
describe('tareaHeadlessUbicacion — llama a anunciarDeteccionesDelTick (Entrega 7)', () => {
  function location(lat: number, lng: number, timestamp: string): Location {
    return {
      timestamp,
      recorded_at: timestamp,
      age: 0,
      odometer: 0,
      odometer_error: 0,
      is_moving: true,
      uuid: `loc-${timestamp}`,
      coords: { latitude: lat, longitude: lng, accuracy: 5, speed: 0 },
      battery: { level: 0.8, is_charging: false },
      activity: { type: 'in_vehicle', confidence: 90 },
    } as unknown as Location;
  }

  function eventoLocation(loc: Location): HeadlessEvent {
    return { name: 'location', params: loc } as unknown as HeadlessEvent;
  }

  function puntoControlReal(id: string, coord: [number, number]): PuntoControlPaquete {
    return {
      id,
      orden: 5,
      coord: { type: 'Point', coordinates: coord },
      radioToleranciaM: 30,
      obligatorio: true,
    };
  }

  beforeEach(() => {
    cargarSesionMovilMock.mockReset();
    obtenerDeviceIdMovilMock.mockReset().mockResolvedValue('device-headless-1');
    abrirPaqueteDiaDbMock.mockReset().mockResolvedValue({});
    obtenerPaqueteDiaLocalMock.mockReset();
    getStateMock.mockReset().mockResolvedValue({ enabled: true });
    stopMock.mockReset().mockResolvedValue(undefined);
    abrirOutboxMock.mockReset().mockResolvedValue({});
    encolarEventoMock.mockReset().mockResolvedValue({ eventId: 'evt-1', insertado: true });
    obtenerEventosPorTipoMock.mockReset().mockResolvedValue([]);
    anunciarDeteccionesDelTickMock.mockClear();
    intentarDrenarOportunistaMock.mockClear();
  });

  it('primer fix (entrada, distancia 0): avisa aproximación, todavía NO confirma', async () => {
    const sesionId = 'sesion-headless-1';
    const pc = puntoControlReal('pc-headless-1', [-63.18, -17.78]);
    const venceAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    cargarSesionMovilMock.mockResolvedValue({
      status: 'autenticado',
      contexto: { sesionId, asignacion: { id: 'asignacion-headless-1', venceAt } },
    } as unknown as SesionMovilGuardada);
    obtenerPaqueteDiaLocalMock.mockResolvedValue({
      paquete: { asignacion: { id: 'asignacion-headless-1', venceAt }, puntosControl: [pc] },
      vencido: false,
      descargadoEn: new Date().toISOString(),
    } as unknown as PaqueteDiaLocal);

    await tareaHeadlessUbicacion(
      eventoLocation(location(-17.78, -63.18, '2026-09-10T12:00:00.000Z')),
    );

    expect(anunciarDeteccionesDelTickMock).toHaveBeenCalledTimes(1);
    const [, opciones, resultado] = anunciarDeteccionesDelTickMock.mock.calls[0]!;
    expect(opciones).toEqual({ sesionId, puntosControl: [pc] });
    expect(resultado.deteccionAproximacion).toMatchObject({
      puntoControlId: 'pc-headless-1',
      fase: 'aproximacion',
    });
    // REDISEÑO (decidirAnuncio, decidir-anuncio.ts): distancia 0 <= 40 m (RADIO_CONFIRMACION_M)
    // — la decisión de anuncio de "llegaste" ("proximidad") ya sale en el MISMO tick de la
    // entrada, sin esperar a que la evidencia confirme (que recién llega en un fix posterior,
    // cuando la distancia crece) — YA NO es un campo `deteccionConfirmacionProximidad`, es una
    // entrada del array `anunciosLlegada`.
    expect(resultado.anunciosLlegada).toEqual([
      { puntoControlId: 'pc-headless-1', pasada: 1, motivo: 'proximidad', distanciaM: 0, radioToleranciaM: 30 },
    ]);
    // Entrega 2 (drenado oportunista): corre como ÚLTIMA línea de `tareaHeadlessUbicacion`,
    // sin importar qué anuncio se haya decidido este tick — ver el docblock del hallazgo 1 en
    // `headless-task.tarea.test.ts` para la cobertura completa de este camino.
    expect(intentarDrenarOportunistaMock).toHaveBeenCalledTimes(1);
  });

  it('segundo fix (se aleja ~33 m, distancia CRECE respecto del mínimo): confirma la pasada 1', async () => {
    const sesionId = 'sesion-headless-2';
    const pc = puntoControlReal('pc-headless-2', [-63.18, -17.78]);
    const venceAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    cargarSesionMovilMock.mockResolvedValue({
      status: 'autenticado',
      contexto: { sesionId, asignacion: { id: 'asignacion-headless-2', venceAt } },
    } as unknown as SesionMovilGuardada);
    obtenerPaqueteDiaLocalMock.mockResolvedValue({
      paquete: { asignacion: { id: 'asignacion-headless-2', venceAt }, puntosControl: [pc] },
      vencido: false,
      descargadoEn: new Date().toISOString(),
    } as unknown as PaqueteDiaLocal);

    // Tick 1: entra exactamente sobre el punto — arranca el mínimo local, no confirma todavía.
    await tareaHeadlessUbicacion(
      eventoLocation(location(-17.78, -63.18, '2026-09-10T12:00:00.000Z')),
    );
    // Tick 2: se aleja ~33 m (sigue dentro del radio de re-armado, 30 * 1.5 = 45 m) — la
    // distancia CRECE respecto del mínimo (0) ⇒ confirma con pasada 1.
    await tareaHeadlessUbicacion(
      eventoLocation(location(-17.7797, -63.18, '2026-09-10T12:00:10.000Z')),
    );

    // REDISEÑO: la EVIDENCIA (confirmación de pasada 1) ya no viaja en el `resultado` que recibe
    // `anunciarDeteccionesDelTick` — la evidencia nunca dispara ningún canal. Se verifica
    // directo contra el outbox (`encolarEventoMock`, que `encolarEventoYLimpiarVisita` delega).
    expect(anunciarDeteccionesDelTickMock).toHaveBeenCalledTimes(2);
    const confirmacion = encolarEventoMock.mock.calls
      .map(([, evento]) => evento)
      .find((evento) => evento?.tipo === 'cumplimiento_punto_control');
    expect(confirmacion).toMatchObject({
      tipo: 'cumplimiento_punto_control',
      payload: expect.objectContaining({ puntoControlId: 'pc-headless-2', pasada: 1 }),
    });
    // El punto entró a distancia 0 (<=40 m) — el anuncio de "llegaste" (proximidad) ya salió en
    // el PRIMER tick, así que el segundo (la confirmación de evidencia) no repite nada.
    const [, , resultadoPrimerTick] = anunciarDeteccionesDelTickMock.mock.calls[0]!;
    const [, , resultadoSegundoTick] = anunciarDeteccionesDelTickMock.mock.calls[1]!;
    expect(resultadoPrimerTick.anunciosLlegada).toEqual([
      { puntoControlId: 'pc-headless-2', pasada: 1, motivo: 'proximidad', distanciaM: 0, radioToleranciaM: 30 },
    ]);
    expect(resultadoSegundoTick.anunciosLlegada).toEqual([]);
  });

  it('sin turno vigente (sin sesión): descarta el punto ANTES de intentar anunciar nada', async () => {
    cargarSesionMovilMock.mockResolvedValue(null);

    await tareaHeadlessUbicacion(
      eventoLocation(location(-17.78, -63.18, '2026-09-10T12:00:00.000Z')),
    );

    expect(anunciarDeteccionesDelTickMock).not.toHaveBeenCalled();
  });

  it('FIX POST-REVISIÓN (Codex verify-fix, punto 5): semilla fallida NO se marca hidratada — este tick procesa SOLO gps_point, y el SIGUIENTE tick reintenta la siembra y procesa cumplimientos normalmente', async () => {
    const sesionId = 'sesion-headless-semilla-fallida';
    const pc = puntoControlReal('pc-headless-semilla', [-63.18, -17.78]);
    const venceAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    cargarSesionMovilMock.mockResolvedValue({
      status: 'autenticado',
      contexto: { sesionId, asignacion: { id: 'asignacion-headless-semilla', venceAt } },
    } as unknown as SesionMovilGuardada);
    obtenerPaqueteDiaLocalMock.mockResolvedValue({
      paquete: { asignacion: { id: 'asignacion-headless-semilla', venceAt }, puntosControl: [pc] },
      vencido: false,
      descargadoEn: new Date().toISOString(),
    } as unknown as PaqueteDiaLocal);
    // Tick 1: la lectura del outbox para sembrar el Map de cumplimientos falla (SQLite ocupada).
    obtenerEventosPorTipoMock.mockRejectedValueOnce(new Error('sqlite ocupada'));

    await tareaHeadlessUbicacion(
      eventoLocation(location(-17.78, -63.18, '2026-09-10T12:00:00.000Z')),
    );

    // Sin semilla hidratada: el tick NO procesó ninguna detección de cumplimiento (ni siquiera
    // el aviso de aproximación, que también depende de tener `puntosControl` en el contexto) —
    // solo se persistió el `gps_point` (verificado más abajo por `encolarEventoMock`). El fallo
    // de la siembra queda reportado a Sentry.
    expect(anunciarDeteccionesDelTickMock).toHaveBeenCalledTimes(1);
    const [, , resultadoTick1] = anunciarDeteccionesDelTickMock.mock.calls[0]!;
    expect(resultadoTick1.deteccionAproximacion).toBeNull();
    expect(resultadoTick1.anunciosLlegada).toEqual([]);
    expect(encolarEventoMock).toHaveBeenCalledTimes(1); // solo el gps_point del tick 1
    expect(encolarEventoMock.mock.calls[0]?.[1]).toMatchObject({ tipo: 'gps_point' });
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ paso: 'sembrar-cumplimientos' }) }),
    );

    // Tick 2: la lectura ya no falla — reintenta la siembra (punto 5: "se reintenta en cada
    // tick") y, al hidratar, procesa cumplimientos con normalidad (aviso de aproximación sobre
    // el mismo punto, distancia 0).
    await tareaHeadlessUbicacion(
      eventoLocation(location(-17.78, -63.18, '2026-09-10T12:00:10.000Z')),
    );

    expect(anunciarDeteccionesDelTickMock).toHaveBeenCalledTimes(2);
    const [, opcionesTick2, resultadoTick2] = anunciarDeteccionesDelTickMock.mock.calls[1]!;
    expect(opcionesTick2).toEqual({ sesionId, puntosControl: [pc] });
    expect(resultadoTick2.deteccionAproximacion).toMatchObject({
      puntoControlId: 'pc-headless-semilla',
      fase: 'aproximacion',
    });
  });

  it('un fallo del anuncio (best-effort) NO impide que el evento de este test se considere resuelto sin throw', async () => {
    const sesionId = 'sesion-headless-3';
    const pc = puntoControlReal('pc-headless-3', [-63.18, -17.78]);
    const venceAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    cargarSesionMovilMock.mockResolvedValue({
      status: 'autenticado',
      contexto: { sesionId, asignacion: { id: 'asignacion-headless-3', venceAt } },
    } as unknown as SesionMovilGuardada);
    obtenerPaqueteDiaLocalMock.mockResolvedValue({
      paquete: { asignacion: { id: 'asignacion-headless-3', venceAt }, puntosControl: [pc] },
      vencido: false,
      descargadoEn: new Date().toISOString(),
    } as unknown as PaqueteDiaLocal);
    anunciarDeteccionesDelTickMock.mockRejectedValueOnce(new Error('notificación no disponible'));

    await expect(
      tareaHeadlessUbicacion(eventoLocation(location(-17.78, -63.18, '2026-09-10T12:00:00.000Z'))),
    ).resolves.toBeUndefined();
  });

  it('REDISEÑO: fix dentro de RADIO_CONFIRMACION_M (40 m) → EXACTAMENTE una decisión de anuncio, aunque lleguen fixes duplicados/concurrentes para la MISMA visita', async () => {
    const sesionId = 'sesion-headless-concurrencia';
    const pc = puntoControlReal('pc-headless-concurrencia', [-63.18, -17.78]);
    const venceAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    cargarSesionMovilMock.mockResolvedValue({
      status: 'autenticado',
      contexto: { sesionId, asignacion: { id: 'asignacion-concurrencia', venceAt } },
    } as unknown as SesionMovilGuardada);
    obtenerPaqueteDiaLocalMock.mockResolvedValue({
      paquete: { asignacion: { id: 'asignacion-concurrencia', venceAt }, puntosControl: [pc] },
      vencido: false,
      descargadoEn: new Date().toISOString(),
    } as unknown as PaqueteDiaLocal);

    // Dos fixes "duplicados" (misma posición, distancia 0 <= RADIO_CONFIRMACION_M) DISPARADOS
    // EN PARALELO, sin esperar al primero — `colaRegistroGps` (C2/R1) los serializa: el segundo
    // ve el estado que dejó el primero (`anuncioHecho: true`), así que `evaluarAnunciosDeFixes`
    // no vuelve a decidir nada para la MISMA visita.
    const tick1 = tareaHeadlessUbicacion(
      eventoLocation(location(-17.78, -63.18, '2026-09-10T12:00:00.000Z')),
    );
    const tick2 = tareaHeadlessUbicacion(
      eventoLocation(location(-17.78, -63.18, '2026-09-10T12:00:00.100Z')),
    );
    await Promise.all([tick1, tick2]);

    expect(anunciarDeteccionesDelTickMock).toHaveBeenCalledTimes(2);
    const anunciosDeAmbosTicks = anunciarDeteccionesDelTickMock.mock.calls.flatMap(
      ([, , resultado]) => resultado.anunciosLlegada,
    );
    expect(anunciosDeAmbosTicks).toHaveLength(1); // EXACTAMENTE una decisión, no dos
    expect(anunciosDeAmbosTicks[0]).toMatchObject({
      puntoControlId: 'pc-headless-concurrencia',
      pasada: 1,
      motivo: 'proximidad',
    });
  });
});

/**
 * FIX POST-REVISIÓN (bug 2, "un vehículo detenido nunca confirma"): `tareaHeadlessUbicacion`
 * enruta el evento `heartbeat` del SDK a `manejarHeartbeatHeadless` — antes de este fix,
 * `heartbeat` se recibía y se ignoraba por completo (ver el comentario de cabecera de
 * `tareaHeadlessUbicacion`, `headless-task.ts`), así que un vehículo DETENIDO dentro del radio
 * de un punto de control (sin fixes nuevos — `distanceFilter: 15`, sin desplazamiento no hay
 * `onLocation`) nunca disparaba ninguna confirmación. El caso real: el ÚLTIMO punto de control
 * de la ruta, en la terminal, donde el chofer se estaciona y apaga el motor.
 *
 * Usa timers falsos (`vi.useFakeTimers`) porque `confirmarVisitasVencidas` compara
 * `Date.now()` contra el `tsFixMs` del candidato — sin controlar el reloj, este test dependería
 * de cuánto tarda en correr la máquina real (flaky por construcción).
 */
describe('tareaHeadlessUbicacion — heartbeat (FIX POST-REVISIÓN, bug 2)', () => {
  function location(lat: number, lng: number, timestamp: string): Location {
    return {
      timestamp,
      recorded_at: timestamp,
      age: 0,
      odometer: 0,
      odometer_error: 0,
      is_moving: true,
      uuid: `loc-${timestamp}`,
      coords: { latitude: lat, longitude: lng, accuracy: 5, speed: 0 },
      battery: { level: 0.8, is_charging: false },
      activity: { type: 'in_vehicle', confidence: 90 },
    } as unknown as Location;
  }

  function eventoLocation(loc: Location): HeadlessEvent {
    return { name: 'location', params: loc } as unknown as HeadlessEvent;
  }

  function eventoHeartbeat(): HeadlessEvent {
    // `HeartbeatEvent` real trae `location`/`taskId` — el handler no los lee (deliberadamente
    // no escribe ningún `gps_point` nuevo, ver el comentario de `manejarHeartbeatHeadless`), así
    // que un evento vacío alcanza para probar el enrutamiento y la confirmación forzada.
    return { name: 'heartbeat', params: {} } as unknown as HeadlessEvent;
  }

  function puntoControlReal(id: string, coord: [number, number]): PuntoControlPaquete {
    return {
      id,
      orden: 5,
      coord: { type: 'Point', coordinates: coord },
      radioToleranciaM: 30,
      obligatorio: true,
    };
  }

  function sesionYPaqueteDe(sesionId: string, asignacionId: string, pc: PuntoControlPaquete): void {
    const venceAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    cargarSesionMovilMock.mockResolvedValue({
      status: 'autenticado',
      contexto: { sesionId, asignacion: { id: asignacionId, venceAt } },
    } as unknown as SesionMovilGuardada);
    obtenerPaqueteDiaLocalMock.mockResolvedValue({
      paquete: { asignacion: { id: asignacionId, venceAt }, puntosControl: [pc] },
      vencido: false,
      descargadoEn: new Date().toISOString(),
    } as unknown as PaqueteDiaLocal);
  }

  beforeEach(() => {
    cargarSesionMovilMock.mockReset();
    obtenerDeviceIdMovilMock.mockReset().mockResolvedValue('device-heartbeat-1');
    abrirPaqueteDiaDbMock.mockReset().mockResolvedValue({});
    obtenerPaqueteDiaLocalMock.mockReset();
    getStateMock.mockReset().mockResolvedValue({ enabled: true });
    stopMock.mockReset().mockResolvedValue(undefined);
    abrirOutboxMock.mockReset().mockResolvedValue({});
    encolarEventoMock.mockReset().mockResolvedValue({ eventId: 'evt-hb', insertado: true });
    obtenerEventosPorTipoMock.mockReset().mockResolvedValue([]);
    obtenerVisitasPendientesMock.mockReset().mockResolvedValue([]);
    anunciarDeteccionesDelTickMock.mockClear();
    anunciarLlegadaPuntoControlMock.mockReset().mockResolvedValue(undefined);
    reintentarAnunciosLlegadaPendientesMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    // H8/best-practice: SIEMPRE volver a timers reales, incluso si un test de este bloque
    // falla a mitad de camino — un `useFakeTimers` que se filtra al resto de la suite congela
    // el reloj de tests no relacionados.
    vi.useRealTimers();
  });

  it('vehículo detenido dentro del radio (sin más fixes): un heartbeat ANTES de UMBRAL_ANTIGUEDAD_CANDIDATO_MS no confirma nada', async () => {
    const sesionId = 'sesion-heartbeat-1';
    const pc = puntoControlReal('pc-heartbeat-1', [-63.18, -17.78]);
    sesionYPaqueteDe(sesionId, 'asignacion-heartbeat-1', pc);

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T12:00:00.000Z'));
    // Entra al radio — arranca el mínimo local, sin confirmar (el vehículo se detiene acá).
    await tareaHeadlessUbicacion(eventoLocation(location(-17.78, -63.18, '2026-09-10T12:00:00.000Z')));
    const llamadasEncolarAntes = encolarEventoMock.mock.calls.length;

    // Pasan 89 s — todavía NO cumple UMBRAL_ANTIGUEDAD_CANDIDATO_MS (90 s).
    vi.setSystemTime(new Date('2026-09-10T12:01:29.000Z'));
    await tareaHeadlessUbicacion(eventoHeartbeat());

    expect(encolarEventoMock.mock.calls.length).toBe(llamadasEncolarAntes);
    expect(anunciarLlegadaPuntoControlMock).not.toHaveBeenCalled();
  });

  it('REDISEÑO (punto 2 del brief — "evaluarAnunciosProximidadVencidos solo se llama desde tests"): vehículo detenido SIN bajar nunca de RADIO_CONFIRMACION_M — un heartbeat AL CUMPLIRSE UMBRAL_ANUNCIO_PROXIMIDAD_MS ejecuta el fallback-tiempo del ANUNCIO, separado de la confirmación de EVIDENCIA por heartbeat (mismo umbral, 90 s, dos mecanismos distintos)', async () => {
    const sesionId = 'sesion-heartbeat-2';
    // Radio de detección grande (100 m) para poder entrar CUMPLIENDO (80 m) sin bajar nunca de
    // RADIO_CONFIRMACION_M (40 m) — así la decisión de "proximidad" NUNCA dispara en la entrada,
    // y lo único que puede anunciar "llegaste" es el fallback de TIEMPO del heartbeat.
    const pc: PuntoControlPaquete = {
      id: 'pc-heartbeat-2',
      orden: 5,
      coord: { type: 'Point', coordinates: [-63.18, -17.78] },
      radioToleranciaM: 100,
      obligatorio: true,
    };
    sesionYPaqueteDe(sesionId, 'asignacion-heartbeat-2', pc);

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T12:00:00.000Z'));
    // Entra a ~80 m (cumple el radio de 100, pero > RADIO_CONFIRMACION_M=40).
    const latitudA80m = -17.78 - 80 / 111_320;
    await tareaHeadlessUbicacion(eventoLocation(location(latitudA80m, -63.18, '2026-09-10T12:00:00.000Z')));
    const llamadasEncolarAntes = encolarEventoMock.mock.calls.length;
    expect(anunciarLlegadaPuntoControlMock).not.toHaveBeenCalled(); // 80 m > 40 m: sin proximidad

    // Pasan 91 s sin ningún fix nuevo — el heartbeat sigue llegando igual (vehículo detenido).
    vi.setSystemTime(new Date('2026-09-10T12:01:31.000Z'));
    await tareaHeadlessUbicacion(eventoHeartbeat());

    // EVIDENCIA: confirmó por heartbeat con el candidato ya observado — nunca una posición
    // inventada.
    expect(encolarEventoMock.mock.calls.length).toBe(llamadasEncolarAntes + 1);
    const [, eventoEncolado] = encolarEventoMock.mock.calls[encolarEventoMock.mock.calls.length - 1]!;
    expect(eventoEncolado).toMatchObject({
      tipo: 'cumplimiento_punto_control',
      eventId: derivarEventIdDeterministico([sesionId, 'pc-heartbeat-2', '1']),
      payload: expect.objectContaining({ puntoControlId: 'pc-heartbeat-2', pasada: 1 }),
    });
    // ANUNCIO: el fallback de TIEMPO ejecuta en el MISMO heartbeat, pero por un camino
    // COMPLETAMENTE separado (`evaluarAnuncioDeHeartbeat`, nunca lee `emitir`/la evidencia de
    // arriba) — motivo 'fallback-tiempo', nunca 'proximidad' (el vehículo nunca bajó de 40 m).
    expect(anunciarLlegadaPuntoControlMock).toHaveBeenCalledTimes(1);
    expect(anunciarLlegadaPuntoControlMock).toHaveBeenCalledWith(
      expect.anything(),
      'pc-heartbeat-2',
      1,
      'fallback-tiempo',
      expect.objectContaining({ sesionId }),
    );
  });

  it('sin sesión activa: el heartbeat es un no-op silencioso, no lanza ni encola nada', async () => {
    cargarSesionMovilMock.mockResolvedValue(null);

    await expect(tareaHeadlessUbicacion(eventoHeartbeat())).resolves.toBeUndefined();
    expect(encolarEventoMock).not.toHaveBeenCalled();
    expect(anunciarLlegadaPuntoControlMock).not.toHaveBeenCalled();
  });

  it('sin ninguna visita en curso (ningún punto de control cerca): el heartbeat no encola ni anuncia nada', async () => {
    const sesionId = 'sesion-heartbeat-3';
    const pc = puntoControlReal('pc-heartbeat-3', [-63.18, -17.78]);
    sesionYPaqueteDe(sesionId, 'asignacion-heartbeat-3', pc);
    // Nunca hubo un fix `location` — no hay ninguna visita `dentro: true` para este punto.

    await tareaHeadlessUbicacion(eventoHeartbeat());

    expect(encolarEventoMock).not.toHaveBeenCalled();
    expect(anunciarLlegadaPuntoControlMock).not.toHaveBeenCalled();
  });
});

/**
 * FIX POST-REVISIÓN (G2, "la persistencia del candidato va después de la memoria" — gap
 * reportado por Codex, verify-fix ronda 3): para las transiciones SIN evento propio (entrada,
 * re-armado, avance de mínimo — ver el docblock de `registrarPuntoGpsInterno`), la fila de
 * `visitas_pendientes` se escribe (`guardarVisitaPendiente`/`eliminarVisitaPendiente`) ANTES de
 * aplicar esa transición a `estados` (memoria); si la escritura falla, la transición NO se
 * aplica — el próximo fix reprocesa esa clave desde el estado ANTERIOR (reintenta la escritura)
 * en vez de quedar con memoria adelantada que SQLite nunca respaldó. El fallo se reporta a
 * Sentry (nunca se traga en silencio) pero NO aborta el resto del tick: el `gps_point` y el
 * anuncio de aproximación de ESTE MISMO tick igual salen.
 */
describe('registrarPuntoGpsInterno — G2 (persistir visita pendiente ANTES de la memoria)', () => {
  function location(lat: number, lng: number, timestamp: string): Location {
    return {
      timestamp,
      recorded_at: timestamp,
      age: 0,
      odometer: 0,
      odometer_error: 0,
      is_moving: true,
      uuid: `loc-${timestamp}`,
      coords: { latitude: lat, longitude: lng, accuracy: 5, speed: 0 },
      battery: { level: 0.8, is_charging: false },
      activity: { type: 'in_vehicle', confidence: 90 },
    } as unknown as Location;
  }

  function eventoLocation(loc: Location): HeadlessEvent {
    return { name: 'location', params: loc } as unknown as HeadlessEvent;
  }

  function puntoControlReal(id: string, coord: [number, number]): PuntoControlPaquete {
    return {
      id,
      orden: 5,
      coord: { type: 'Point', coordinates: coord },
      radioToleranciaM: 30,
      obligatorio: true,
    };
  }

  beforeEach(() => {
    cargarSesionMovilMock.mockReset();
    obtenerDeviceIdMovilMock.mockReset().mockResolvedValue('device-g2-1');
    abrirPaqueteDiaDbMock.mockReset().mockResolvedValue({});
    obtenerPaqueteDiaLocalMock.mockReset();
    abrirOutboxMock.mockReset().mockResolvedValue({});
    encolarEventoMock.mockReset().mockResolvedValue({ eventId: 'evt-g2', insertado: true });
    obtenerEventosPorTipoMock.mockReset().mockResolvedValue([]);
    obtenerVisitasPendientesMock.mockReset().mockResolvedValue([]);
    guardarVisitaPendienteMock.mockReset().mockResolvedValue(undefined);
    captureExceptionMock.mockClear();
    anunciarDeteccionesDelTickMock.mockClear().mockResolvedValue(undefined);
  });

  it('FIX POST-REVISIÓN (Codex verify-fix, punto 6): si guardarVisitaPendiente falla en la ENTRADA, la transición SÍ se aplica a memoria igual (ya no se pierde la visita) — el fallo se encola para reintentar y se reporta a Sentry sin abortar el tick', async () => {
    const sesionId = 'sesion-g2-1';
    const pc = puntoControlReal('pc-g2-1', [-63.18, -17.78]);
    const venceAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    cargarSesionMovilMock.mockResolvedValue({
      status: 'autenticado',
      contexto: { sesionId, asignacion: { id: 'asignacion-g2-1', venceAt } },
    } as unknown as SesionMovilGuardada);
    obtenerPaqueteDiaLocalMock.mockResolvedValue({
      paquete: { asignacion: { id: 'asignacion-g2-1', venceAt }, puntosControl: [pc] },
      vencido: false,
      descargadoEn: new Date().toISOString(),
    } as unknown as PaqueteDiaLocal);

    // Tick 1: entra exactamente sobre el punto (distancia ~0) — la transición de ENTRADA no
    // tiene evento propio (el cumplimiento recién se emite al confirmar), así que pasa por
    // `guardarVisitaPendiente` — que esta vez FALLA.
    guardarVisitaPendienteMock.mockRejectedValueOnce(new Error('sqlite ocupada'));
    await tareaHeadlessUbicacion(
      eventoLocation(location(-17.78, -63.18, '2026-09-23T12:00:00.000Z')),
    );

    // El resto del tick NO se abortó: el `gps_point` se encoló y el anuncio de aproximación
    // salió igual — el fallo es SOLO de la copia durable del candidato, no de la evidencia.
    expect(encolarEventoMock).toHaveBeenCalledTimes(1);
    expect(encolarEventoMock.mock.calls[0]?.[1]).toMatchObject({ tipo: 'gps_point' }); // sin confirmación todavía
    expect(anunciarDeteccionesDelTickMock).toHaveBeenCalledTimes(1);

    // El fallo se reportó — nunca se traga en silencio — con el `paso` del ENCOLADO de
    // reintento (punto 6), ya no `visita-pendiente-no-aplicada`.
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({
          contexto: 'gps-cola',
          paso: 'visita-pendiente-reintento-encolado',
        }),
        extra: expect.objectContaining({ sesionId }),
      }),
    );

    // Tick 2: un fix que crece a ~11 m respecto del mínimo (0). Como la transición de ENTRADA
    // del tick 1 SÍ quedó en memoria (punto 6 — la continuidad de la visita ya no depende de
    // que SQLite confirme en el primer intento), este tick CONFIRMA la pasada 1 — no la trata
    // como una entrada nueva. El reintento de la escritura fallida del tick 1 se drena ANTES de
    // procesar este tick (`guardarVisitaPendienteMock` ya no rechaza la segunda vez, por
    // `mockRejectedValueOnce`).
    await tareaHeadlessUbicacion(
      eventoLocation(location(-17.7799, -63.18, '2026-09-23T12:00:10.000Z')),
    );
    const confirmacion = encolarEventoMock.mock.calls
      .map(([, evento]) => evento)
      .find((evento) => evento?.tipo === 'cumplimiento_punto_control');
    expect(confirmacion).toMatchObject({
      tipo: 'cumplimiento_punto_control',
      payload: expect.objectContaining({ puntoControlId: 'pc-g2-1', pasada: 1 }),
    });
    // El reintento drenado escribió la copia durable con éxito la segunda vez.
    expect(guardarVisitaPendienteMock).toHaveBeenCalledTimes(2);
  });

  it('FIX POST-REVISIÓN (Codex verify-fix, punto 6): fallo en el ÚNICO fix dentro del radio + el siguiente fix ya FUERA del radio ⇒ la visita se persiste igual (antes se perdía para siempre)', async () => {
    const sesionId = 'sesion-g2-3';
    const pc = puntoControlReal('pc-g2-3', [-63.18, -17.78]);
    const venceAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    cargarSesionMovilMock.mockResolvedValue({
      status: 'autenticado',
      contexto: { sesionId, asignacion: { id: 'asignacion-g2-3', venceAt } },
    } as unknown as SesionMovilGuardada);
    obtenerPaqueteDiaLocalMock.mockResolvedValue({
      paquete: { asignacion: { id: 'asignacion-g2-3', venceAt }, puntosControl: [pc] },
      vencido: false,
      descargadoEn: new Date().toISOString(),
    } as unknown as PaqueteDiaLocal);

    // Tick 1 (único fix DENTRO del radio de 30 m): la escritura de la visita pendiente falla.
    guardarVisitaPendienteMock.mockRejectedValueOnce(new Error('sqlite ocupada'));
    await tareaHeadlessUbicacion(
      eventoLocation(location(-17.78, -63.18, '2026-09-23T12:00:00.000Z')),
    );
    // Todavía sin confirmar — evidencia intacta, solo `gps_point` en el outbox.
    expect(encolarEventoMock.mock.calls.every(([, evento]) => evento?.tipo === 'gps_point')).toBe(true);

    // Tick 2: el vehículo pasó de largo — ~2.2 km, bien fuera del radio (30 m) y del radio de
    // re-armado (45 m). Con la memoria intacta (punto 6), la distancia "crece" respecto del
    // mínimo (0) y CONFIRMA — con el diseño anterior (G2 sin reintento), la memoria nunca había
    // avanzado a `dentro: true` y este fix no encontraba ninguna visita que cerrar: la pasada se
    // perdía para siempre.
    await tareaHeadlessUbicacion(
      eventoLocation(location(-17.80, -63.18, '2026-09-23T12:00:10.000Z')),
    );
    const confirmacion = encolarEventoMock.mock.calls
      .map(([, evento]) => evento)
      .find((evento) => evento?.tipo === 'cumplimiento_punto_control');
    expect(confirmacion).toMatchObject({
      tipo: 'cumplimiento_punto_control',
      payload: expect.objectContaining({ puntoControlId: 'pc-g2-3', pasada: 1 }),
    });
  });

  it('cuando guardarVisitaPendiente funciona, la entrada SÍ queda en memoria y el siguiente fix que crece confirma la pasada 1', async () => {
    const sesionId = 'sesion-g2-2';
    const pc = puntoControlReal('pc-g2-2', [-63.18, -17.78]);
    const venceAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    cargarSesionMovilMock.mockResolvedValue({
      status: 'autenticado',
      contexto: { sesionId, asignacion: { id: 'asignacion-g2-2', venceAt } },
    } as unknown as SesionMovilGuardada);
    obtenerPaqueteDiaLocalMock.mockResolvedValue({
      paquete: { asignacion: { id: 'asignacion-g2-2', venceAt }, puntosControl: [pc] },
      vencido: false,
      descargadoEn: new Date().toISOString(),
    } as unknown as PaqueteDiaLocal);

    await tareaHeadlessUbicacion(
      eventoLocation(location(-17.78, -63.18, '2026-09-23T12:00:00.000Z')),
    );
    await tareaHeadlessUbicacion(
      eventoLocation(location(-17.7799, -63.18, '2026-09-23T12:00:10.000Z')),
    );

    expect(captureExceptionMock).not.toHaveBeenCalled();
    const confirmacion = encolarEventoMock.mock.calls
      .map(([, evento]) => evento)
      .find((evento) => evento?.tipo === 'cumplimiento_punto_control');
    expect(confirmacion).toMatchObject({
      tipo: 'cumplimiento_punto_control',
      payload: expect.objectContaining({ puntoControlId: 'pc-g2-2', pasada: 1 }),
    });
  });
});

/**
 * FIX POST-REVISIÓN (Codex `verify-fix`, punto 7, "el timeout de la cola no cancela la
 * operación subyacente"): antes de este fix, una operación que vencía el techo de tiempo
 * (`TIMEOUT_REGISTRO_GPS_MS`, 30 s) liberaba la cola para el siguiente fix/heartbeat pero seguía
 * corriendo de fondo — si SQLite finalmente respondía (tarde, no muerta), sus escrituras podían
 * intercalarse con las de la operación más nueva que la cola ya había dejado avanzar. El fix
 * (contador de generación) hace que esa operación vencida aborte el resto de su trabajo apenas
 * detecta que quedó vieja.
 *
 * `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync` porque `conTimeout` usa un `setTimeout`
 * real para el techo — sin controlar el reloj, este test dependería de esperar 30 s de verdad
 * (o de que la máquina de CI tarde justo lo suficiente, flaky por construcción).
 */
describe('registrarPuntoGpsInterno — FIX POST-REVISIÓN (Codex verify-fix, punto 7, generación de la cola)', () => {
  function location(lat: number, lng: number, timestamp: string): Location {
    return {
      timestamp,
      recorded_at: timestamp,
      age: 0,
      odometer: 0,
      odometer_error: 0,
      is_moving: true,
      uuid: `loc-${timestamp}`,
      coords: { latitude: lat, longitude: lng, accuracy: 5, speed: 0 },
      battery: { level: 0.8, is_charging: false },
      activity: { type: 'in_vehicle', confidence: 90 },
    } as unknown as Location;
  }

  function eventoLocation(loc: Location): HeadlessEvent {
    return { name: 'location', params: loc } as unknown as HeadlessEvent;
  }

  function puntoControlReal(id: string, coord: [number, number]): PuntoControlPaquete {
    return {
      id,
      orden: 5,
      coord: { type: 'Point', coordinates: coord },
      radioToleranciaM: 30,
      obligatorio: true,
    };
  }

  beforeEach(() => {
    cargarSesionMovilMock.mockReset();
    obtenerDeviceIdMovilMock.mockReset().mockResolvedValue('device-timeout-1');
    abrirPaqueteDiaDbMock.mockReset().mockResolvedValue({});
    obtenerPaqueteDiaLocalMock.mockReset();
    abrirOutboxMock.mockReset().mockResolvedValue({});
    obtenerEventosPorTipoMock.mockReset().mockResolvedValue([]);
    obtenerVisitasPendientesMock.mockReset().mockResolvedValue([]);
    guardarVisitaPendienteMock.mockReset().mockResolvedValue(undefined);
    captureExceptionMock.mockClear();
    anunciarDeteccionesDelTickMock.mockClear().mockResolvedValue(undefined);
  });

  afterEach(() => {
    // Ver el mismo comentario en el bloque de heartbeat: nunca dejar timers falsos filtrándose
    // al resto de la suite.
    vi.useRealTimers();
  });

  it('una operación que vence su timeout y sigue corriendo de fondo NO escribe la visita pendiente tras despertar tarde — la operación NUEVA (que sí corrió a tiempo) es la única que la escribe', async () => {
    const sesionId = 'sesion-timeout-1';
    const pc = puntoControlReal('pc-timeout-1', [-63.18, -17.78]);
    const venceAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    cargarSesionMovilMock.mockResolvedValue({
      status: 'autenticado',
      contexto: { sesionId, asignacion: { id: 'asignacion-timeout-1', venceAt } },
    } as unknown as SesionMovilGuardada);
    obtenerPaqueteDiaLocalMock.mockResolvedValue({
      paquete: { asignacion: { id: 'asignacion-timeout-1', venceAt }, puntosControl: [pc] },
      vencido: false,
      descargadoEn: new Date().toISOString(),
    } as unknown as PaqueteDiaLocal);

    vi.useFakeTimers();

    // Tick 1 (entra sobre el punto, distancia ~0): su `encolarEvento` del `gps_point` queda
    // COLGADO — simula una escritura SQLite realmente lenta, no muerta.
    let resolverEncolarLento!: (valor: { eventId: string; insertado: boolean }) => void;
    const encolarLento = new Promise<{ eventId: string; insertado: boolean }>((resolve) => {
      resolverEncolarLento = resolve;
    });
    encolarEventoMock
      .mockReset()
      .mockImplementationOnce(() => encolarLento)
      .mockResolvedValue({ eventId: 'evt-timeout-2', insertado: true });

    const tick1 = tareaHeadlessUbicacion(
      eventoLocation(location(-17.78, -63.18, '2026-09-10T12:00:00.000Z')),
    );

    // Vence el techo de 30 s (`TIMEOUT_REGISTRO_GPS_MS`) — la cola avanza (generación++) y
    // `tareaHeadlessUbicacion` de tick 1 resuelve (su propio try/catch reporta el timeout, no
    // relanza).
    await vi.advanceTimersByTimeAsync(30_000 + 100);
    await tick1;
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ paso: 'timeout-registro-punto' }) }),
    );
    captureExceptionMock.mockClear();

    // Tick 2: la cola YA avanzó — un fix normal, mismo punto (todavía no hay ninguna visita en
    // memoria: tick 1 nunca llegó a aplicar la suya), corre en la generación NUEVA y sí puede
    // escribir su visita pendiente con normalidad.
    await tareaHeadlessUbicacion(
      eventoLocation(location(-17.78, -63.18, '2026-09-10T12:00:40.000Z')),
    );
    expect(guardarVisitaPendienteMock).toHaveBeenCalledTimes(1);
    const llamadaTick2 = guardarVisitaPendienteMock.mock.calls[0]![1] as { candidatoTsFixMs: number };

    // Recién ACÁ "responde" la escritura colgada del tick 1 — su operación interna
    // (`registrarPuntoGpsInterno`) sigue corriendo de fondo y retoma justo después del `await
    // encolarEvento` del `gps_point`. Con la generación ya vieja, tiene que abortar ANTES de
    // llegar a `guardarVisitaPendiente` — si el fix de la generación no funcionara, este resolve
    // dispararía una SEGUNDA llamada (pisando o duplicando la visita que tick 2 ya escribió).
    resolverEncolarLento({ eventId: 'evt-timeout-1', insertado: true });
    await vi.advanceTimersByTimeAsync(0); // deja correr los microtasks/continuaciones pendientes

    expect(guardarVisitaPendienteMock).toHaveBeenCalledTimes(1); // sigue en 1: nunca llegó del tick 1
    // La única fila escrita es la del tick 2 (candidato con el `tsFix` del segundo fix, no del
    // primero) — prueba que la operación vieja no alcanzó a pisarla.
    expect(llamadaTick2.candidatoTsFixMs).toBe(Date.parse('2026-09-10T12:00:40.000Z'));
  });
});

describe('registrarPuntoGps — fase ida/regreso del circuito', () => {
  const pcCerca: PuntoControlPaquete = {
    id: 'pc-otra-fase',
    orden: 5,
    coord: { type: 'Point', coordinates: [-63.18, -17.78] },
    radioToleranciaM: 30,
    obligatorio: true,
  };
  const pcLejos: PuntoControlPaquete = { ...pcCerca, id: 'pc-de-la-fase', coord: { type: 'Point', coordinates: [-63.1, -17.7] } };
  const fix = {
    timestamp: '2026-10-14T12:00:00.000Z',
    coords: { latitude: -17.78, longitude: -63.18, accuracy: 5, speed: 0 },
  } as unknown as Location;

  beforeEach(() => {
    abrirOutboxMock.mockReset().mockResolvedValue({});
    encolarEventoMock.mockReset().mockResolvedValue({ eventId: 'evt-fase', insertado: true });
    obtenerVisitasPendientesMock.mockReset().mockResolvedValue([]);
  });

  it('detecta y avisa solo los PC que devuelve la fase; el resto del circuito no se evalúa', async () => {
    const mock = vi.mocked(puntosDeLaFaseActual);
    mock.mockResolvedValueOnce([pcLejos]);
    const filtrado = await registrarPuntoGps(
      {} as never,
      fix,
      { deviceId: 'd', sesionId: 's-fase', puntosControl: [pcCerca, pcLejos], geometriaRuta: [[0, 0], [1, 1]] },
      { current: new Map() },
    );
    expect(filtrado.deteccionAproximacion).toBeNull();
    expect(mock.mock.calls.at(-1)![3]).toEqual([[0, 0], [1, 1]]);

    const completo = await registrarPuntoGps(
      {} as never,
      fix,
      { deviceId: 'd', sesionId: 's-fase', puntosControl: [pcCerca, pcLejos] },
      { current: new Map() },
    );
    expect(completo.deteccionAproximacion?.puntoControlId).toBe('pc-otra-fase');
  });

  it('si la fase no se puede resolver, detecta todos (no se pierde evidencia) y lo reporta', async () => {
    vi.mocked(puntosDeLaFaseActual).mockRejectedValueOnce(new Error('sqlite ocupada'));
    const r = await registrarPuntoGps(
      {} as never,
      fix,
      { deviceId: 'd', sesionId: 's-fase', puntosControl: [pcCerca, pcLejos] },
      { current: new Map() },
    );
    expect(r.deteccionAproximacion?.puntoControlId).toBe('pc-otra-fase');
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ paso: 'fase-vuelta' }) }),
    );
  });
});

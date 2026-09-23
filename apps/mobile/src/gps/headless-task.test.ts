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
// `@sentry/react-native` y `react-native-background-geolocation` porque todos traen
// dependencias nativas (`expo-sqlite`, `expo-crypto`, `expo-secure-store`) que rompen bajo
// vitest/Node — mismo motivo documentado en `db/paquete-dia-local.ts` y en
// `use-auth-movil.refrescar.test.ts`. `obtenerContextoUbicacionPersistido` solo orquesta
// llamadas a esos módulos.
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
  };
});

vi.mock('../db/paquete-dia', () => ({
  abrirPaqueteDiaDb: vi.fn(),
  obtenerPaqueteDiaLocal: vi.fn(),
}));

vi.mock('../shared/security/sesion-movil-store', () => ({
  cargarSesionMovil: vi.fn(),
  obtenerDeviceIdMovil: vi.fn(),
}));

// ENTREGA 7 (plan post-piloto 2026-09-09, "anuncio desde headless"): `anunciarDeteccionesDelTick`
// dispara `expo-notifications`/`expo-speech`/`Vibration`, que a su vez importan `react-native`
// (rompe bajo vitest/Node, ver `anuncio-punto-control.test.ts`) — se mockea el módulo entero
// para que este archivo pueda seguir enfocado en la ORQUESTACIÓN (¿se llama?, ¿con qué?), no en
// el contenido del anuncio, que ya cubre su propio test.
vi.mock('../features/operacion/anuncio-punto-control', () => ({
  anunciarDeteccionesDelTick: vi.fn().mockResolvedValue(undefined),
  // FIX POST-REVISIÓN (bug 2): el handler de heartbeat (`manejarHeartbeatHeadless`) llama a
  // `anunciarPuntoControl` directo (no al wrapper `anunciarDeteccionesDelTick`, que espera un
  // solo tick con aproximación+confirmación) — mockeado igual, sin contenido.
  anunciarPuntoControl: vi.fn().mockResolvedValue(undefined),
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
  obtenerDeviceIdMovil,
  type SesionMovilGuardada,
} from '../shared/security/sesion-movil-store';
import {
  anunciarDeteccionesDelTick,
  anunciarPuntoControl,
} from '../features/operacion/anuncio-punto-control';
import { obtenerContextoUbicacionPersistido, tareaHeadlessUbicacion } from './headless-task';

const cargarSesionMovilMock = cargarSesionMovil as unknown as ReturnType<typeof vi.fn>;
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
const anunciarPuntoControlMock = anunciarPuntoControl as unknown as ReturnType<typeof vi.fn>;
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
    expect(resultado.deteccion).toBeNull();
    expect(resultado.deteccionAproximacion).toMatchObject({
      puntoControlId: 'pc-headless-1',
      fase: 'aproximacion',
    });
    // DECISIÓN CTO 2026-09-23 (`RADIO_CONFIRMACION_M`): distancia 0 <= 40 m — la proximidad
    // dispara en TIEMPO REAL en el MISMO tick de la entrada, sin esperar a que la evidencia
    // confirme (que recién llega en un fix posterior, cuando la distancia crece).
    expect(resultado.deteccionConfirmacionProximidad).toMatchObject({
      puntoControlId: 'pc-headless-1',
      fase: 'confirmado-proximidad',
    });
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

    expect(anunciarDeteccionesDelTickMock).toHaveBeenCalledTimes(2);
    const [, , resultadoSegundoTick] = anunciarDeteccionesDelTickMock.mock.calls[1]!;
    expect(resultadoSegundoTick.deteccion).toMatchObject({
      puntoControlId: 'pc-headless-2',
      fase: 'confirmado',
      pasada: 1,
    });
  });

  it('sin turno vigente (sin sesión): descarta el punto ANTES de intentar anunciar nada', async () => {
    cargarSesionMovilMock.mockResolvedValue(null);

    await tareaHeadlessUbicacion(
      eventoLocation(location(-17.78, -63.18, '2026-09-10T12:00:00.000Z')),
    );

    expect(anunciarDeteccionesDelTickMock).not.toHaveBeenCalled();
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
    anunciarPuntoControlMock.mockReset().mockResolvedValue(undefined);
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
    expect(anunciarPuntoControlMock).not.toHaveBeenCalled();
  });

  it('vehículo detenido dentro del radio (terminal, "el chofer estaciona"): un heartbeat AL CUMPLIRSE UMBRAL_ANTIGUEDAD_CANDIDATO_MS confirma con el candidato, SIN fix nuevo, y anuncia la confirmación', async () => {
    const sesionId = 'sesion-heartbeat-2';
    const pc = puntoControlReal('pc-heartbeat-2', [-63.18, -17.78]);
    sesionYPaqueteDe(sesionId, 'asignacion-heartbeat-2', pc);

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T12:00:00.000Z'));
    await tareaHeadlessUbicacion(eventoLocation(location(-17.78, -63.18, '2026-09-10T12:00:00.000Z')));
    const llamadasEncolarAntes = encolarEventoMock.mock.calls.length;

    // Pasan 91 s sin ningún fix nuevo — el heartbeat sigue llegando igual (vehículo detenido).
    vi.setSystemTime(new Date('2026-09-10T12:01:31.000Z'));
    await tareaHeadlessUbicacion(eventoHeartbeat());

    // Confirmó por heartbeat: un `cumplimiento_punto_control` nuevo en el outbox, con el
    // candidato ya observado (fase confirmado, pasada 1) — nunca una posición inventada.
    expect(encolarEventoMock.mock.calls.length).toBe(llamadasEncolarAntes + 1);
    const [, eventoEncolado] = encolarEventoMock.mock.calls[encolarEventoMock.mock.calls.length - 1]!;
    expect(eventoEncolado).toMatchObject({
      tipo: 'cumplimiento_punto_control',
      // FIX POST-REVISIÓN ("eventId estable"): la confirmación forzada por heartbeat deriva el
      // MISMO eventId que derivaría un fix real para esta tripleta (ver
      // `location-task.test.ts`, "el cumplimiento lleva un eventId derivado...") — así, si un
      // fix real llegara a confirmar la misma pasada por otro camino, el servidor los trata
      // como el MISMO evento en vez de contarlo dos veces.
      eventId: derivarEventIdDeterministico([sesionId, 'pc-heartbeat-2', '1']),
      payload: expect.objectContaining({ puntoControlId: 'pc-heartbeat-2', pasada: 1 }),
    });
    // Y salió el anuncio (sonido/voz) de la confirmación — un heartbeat también tiene que
    // avisarle al chofer, no solo dejar evidencia silenciosa.
    expect(anunciarPuntoControlMock).toHaveBeenCalledTimes(1);
  });

  it('sin sesión activa: el heartbeat es un no-op silencioso, no lanza ni encola nada', async () => {
    cargarSesionMovilMock.mockResolvedValue(null);

    await expect(tareaHeadlessUbicacion(eventoHeartbeat())).resolves.toBeUndefined();
    expect(encolarEventoMock).not.toHaveBeenCalled();
    expect(anunciarPuntoControlMock).not.toHaveBeenCalled();
  });

  it('sin ninguna visita en curso (ningún punto de control cerca): el heartbeat no encola ni anuncia nada', async () => {
    const sesionId = 'sesion-heartbeat-3';
    const pc = puntoControlReal('pc-heartbeat-3', [-63.18, -17.78]);
    sesionYPaqueteDe(sesionId, 'asignacion-heartbeat-3', pc);
    // Nunca hubo un fix `location` — no hay ninguna visita `dentro: true` para este punto.

    await tareaHeadlessUbicacion(eventoHeartbeat());

    expect(encolarEventoMock).not.toHaveBeenCalled();
    expect(anunciarPuntoControlMock).not.toHaveBeenCalled();
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

  it('si guardarVisitaPendiente falla en la ENTRADA, NO aplica la transición a memoria (el próximo fix la reprocesa desde cero) y reporta a Sentry sin abortar el tick', async () => {
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
    expect(anunciarDeteccionesDelTickMock).toHaveBeenCalledTimes(1);
    const [, , resultadoPrimerTick] = anunciarDeteccionesDelTickMock.mock.calls[0]!;
    expect(resultadoPrimerTick.deteccion).toBeNull();

    // El fallo se reportó — nunca se traga en silencio.
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ contexto: 'gps-cola', paso: 'visita-pendiente-no-aplicada' }),
        extra: expect.objectContaining({ sesionId }),
      }),
    );

    // Tick 2: un fix que, DE HABER quedado en memoria como "mínimo 0 m", confirmaría la pasada 1
    // acá mismo (la distancia creció a ~11 m). Como la transición de ENTRADA del tick 1 NO se
    // aplicó (persistencia fallida), este tick se procesa como una ENTRADA NUEVA — sin
    // confirmar todavía — en vez de confirmar de más con un mínimo que SQLite nunca respaldó.
    await tareaHeadlessUbicacion(
      eventoLocation(location(-17.7799, -63.18, '2026-09-23T12:00:10.000Z')),
    );
    const resultadoSegundoTick = anunciarDeteccionesDelTickMock.mock.calls[1]![2];
    expect(resultadoSegundoTick.deteccion).toBeNull();
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
    const resultadoSegundoTick = anunciarDeteccionesDelTickMock.mock.calls[1]![2];
    expect(resultadoSegundoTick.deteccion).toMatchObject({
      puntoControlId: 'pc-g2-2',
      fase: 'confirmado',
      pasada: 1,
    });
  });
});

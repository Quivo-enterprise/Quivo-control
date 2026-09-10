import { describe, expect, it, vi, beforeEach } from 'vitest';

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

vi.mock('../db/outbox', () => ({
  abrirOutbox: vi.fn(),
  encolarEvento: vi.fn(),
  obtenerEventosPorTipo: vi.fn(),
}));

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
}));

import BackgroundGeolocation, { type HeadlessEvent, type Location } from 'react-native-background-geolocation';
import type { PuntoControlPaquete } from '@quivo/shared';
import { abrirPaqueteDiaDb, obtenerPaqueteDiaLocal, type PaqueteDiaLocal } from '../db/paquete-dia';
import { abrirOutbox, encolarEvento, obtenerEventosPorTipo } from '../db/outbox';
import {
  cargarSesionMovil,
  obtenerDeviceIdMovil,
  type SesionMovilGuardada,
} from '../shared/security/sesion-movil-store';
import { anunciarDeteccionesDelTick } from '../features/operacion/anuncio-punto-control';
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
const anunciarDeteccionesDelTickMock = anunciarDeteccionesDelTick as unknown as ReturnType<
  typeof vi.fn
>;

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

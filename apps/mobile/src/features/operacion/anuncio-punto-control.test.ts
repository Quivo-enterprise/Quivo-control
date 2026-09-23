import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PuntoControlPaquete } from '@quivo/shared';
import type { DeteccionPuntoControl } from '../../gps/geofence';

// ENTREGA 7 (plan post-piloto 2026-09-09, "anuncio desde headless"): `anuncio-punto-control.ts`
// es DELIBERADAMENTE sin React (lo llama tanto `tareaHeadlessUbicacion`, sin árbol de
// componentes, como el `useEffect` de `gps-provider.tsx`) — ver el docblock de cabecera de ese
// módulo. `expo-notifications`, `expo-speech` y `@sentry/react-native` importan `react-native`
// por debajo, que rompe bajo vitest/Node (sintaxis Flow que Rollup no puede parsear) — mismo
// motivo por el que `headless-task.test.ts` mockea sus propias dependencias nativas.
vi.mock('react-native', () => ({
  Vibration: { vibrate: vi.fn() },
}));

vi.mock('expo-speech', () => ({
  speak: vi.fn(),
}));

vi.mock('expo-notifications', () => ({
  setNotificationChannelAsync: vi.fn().mockResolvedValue(undefined),
  scheduleNotificationAsync: vi.fn().mockResolvedValue('notif-id'),
  AndroidImportance: { HIGH: 4 },
  // Hallazgo de campo (Sentry, build 10, Galaxy A71 Android 13): `POST_NOTIFICATIONS` es un
  // permiso de runtime real en Android 13+ — `getPermissionsAsync`/`requestPermissionsAsync`
  // son la API real de `expo-notifications` para leerlo/pedirlo. `PermissionStatus` es un ENUM
  // (valor real usado por `anuncio-punto-control.ts`, no solo un tipo), así que el mock tiene
  // que exportarlo como objeto, no solo declarar el tipo.
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  getPermissionsAsync: vi.fn().mockResolvedValue({ status: 'granted' }),
  requestPermissionsAsync: vi.fn().mockResolvedValue({ status: 'granted' }),
}));

vi.mock('@sentry/react-native', () => ({
  captureException: vi.fn(),
}));

// `registrarAnuncioSiNuevo` es el dedupe PERSISTIDO (SQLite) — se mockea igual que en
// `headless-task.test.ts` (`../db/outbox` trae `expo-sqlite`, que también rompe bajo Node).
vi.mock('../../db/outbox', () => ({
  registrarAnuncioSiNuevo: vi.fn().mockResolvedValue(true),
}));

import { Vibration } from 'react-native';
import * as Speech from 'expo-speech';
import * as Notifications from 'expo-notifications';
import * as Sentry from '@sentry/react-native';
import { registrarAnuncioSiNuevo } from '../../db/outbox';
import {
  anunciarDeteccionesDelTick,
  anunciarPuntoControl,
  asegurarPermisoNotificaciones,
  limpiarAproximacionesAnunciadas,
  limpiarConfirmacionesProximidadAnunciadas,
  obtenerEstadoPermisoNotificaciones,
  type AnuncioPuntoControlOpciones,
} from './anuncio-punto-control';

const vibrateMock = Vibration.vibrate as unknown as ReturnType<typeof vi.fn>;
const speakMock = Speech.speak as unknown as ReturnType<typeof vi.fn>;
const scheduleNotificationMock = Notifications.scheduleNotificationAsync as unknown as ReturnType<
  typeof vi.fn
>;
const setChannelMock = Notifications.setNotificationChannelAsync as unknown as ReturnType<
  typeof vi.fn
>;
const getPermissionsMock = Notifications.getPermissionsAsync as unknown as ReturnType<typeof vi.fn>;
const requestPermissionsMock = Notifications.requestPermissionsAsync as unknown as ReturnType<
  typeof vi.fn
>;
const captureExceptionMock = Sentry.captureException as unknown as ReturnType<typeof vi.fn>;
const registrarAnuncioSiNuevoMock = registrarAnuncioSiNuevo as unknown as ReturnType<typeof vi.fn>;

const DB_FALSO = {} as never;

function puntoControl(id: string, orden: number): PuntoControlPaquete {
  return {
    id,
    orden,
    coord: { type: 'Point', coordinates: [0, 0] },
    radioToleranciaM: 30,
    obligatorio: true,
  };
}

function deteccion(
  overrides: Partial<DeteccionPuntoControl> & { puntoControlId: string },
): DeteccionPuntoControl {
  return {
    distanciaM: 50,
    cumplido: true,
    radioToleranciaM: 30,
    ...overrides,
  };
}

function opciones(puntosControl: PuntoControlPaquete[] = [puntoControl('pc-1', 15)]): AnuncioPuntoControlOpciones {
  return { sesionId: 'sesion-1', puntosControl };
}

describe('anuncio-punto-control.ts — no importa React (Entrega 7)', () => {
  it('el módulo fuente no tiene ningún import de react (headless no monta árbol de componentes)', () => {
    const fuente = readFileSync(path.join(__dirname, 'anuncio-punto-control.ts'), 'utf-8');
    // Anclado al INICIO de línea (multiline) para no confundir la sentencia de import real con
    // la mención en el docblock de cabecera del propio módulo, que documenta a propósito por
    // qué NO debe tener una.
    expect(fuente).not.toMatch(/^\s*import\b[^;]*from\s+['"]react['"]/m);
    expect(fuente).not.toMatch(/^\s*(?:const|let|var).*require\(['"]react['"]\)/m);
  });
});

describe('anunciarPuntoControl — fase "aproximacion" (Entrega 7)', () => {
  beforeEach(() => {
    vibrateMock.mockClear();
    speakMock.mockClear();
    scheduleNotificationMock.mockClear();
    captureExceptionMock.mockClear();
    registrarAnuncioSiNuevoMock.mockReset().mockResolvedValue(true);
  });

  it('solo habla — nunca vibra ni notifica (es un aviso informativo, no evidencia de paso)', async () => {
    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: 'pc-aprox-1', fase: 'aproximacion', distanciaM: 134 }),
      opciones([puntoControl('pc-aprox-1', 15)]),
    );

    expect(speakMock).toHaveBeenCalledTimes(1);
    // ENTREGA 5: la voz redondea a decenas ("a 130 metros", no "a 134 metros") y dice el
    // número de orden humano (`orden + 1`).
    expect(speakMock.mock.calls[0]?.[0]).toBe('Punto de control 16, a 130 m.');
    expect(vibrateMock).not.toHaveBeenCalled();
    expect(scheduleNotificationMock).not.toHaveBeenCalled();
  });

  it('dedupea en memoria por puntoControlId — no repite la voz mientras el vehículo siga dentro del radio de aviso', async () => {
    const d = deteccion({ puntoControlId: 'pc-aprox-2', fase: 'aproximacion', distanciaM: 140 });
    const opts = opciones([puntoControl('pc-aprox-2', 0)]);

    await anunciarPuntoControl(DB_FALSO, d, opts);
    await anunciarPuntoControl(DB_FALSO, { ...d, distanciaM: 90 }, opts);
    await anunciarPuntoControl(DB_FALSO, { ...d, distanciaM: 40 }, opts);

    expect(speakMock).toHaveBeenCalledTimes(1);
  });

  it('FIX POST-REVISIÓN (bug 4): confirmar NO reabre el ciclo de aproximación — el vehículo puede seguir a <150 m, alejándose', async () => {
    // Antes de este fix, `anunciarPuntoControl` borraba la entrada de `aproximacionesAnunciadas`
    // en cuanto el punto CONFIRMABA (con el vehículo todavía muy cerca — la confirmación ocurre
    // en el mínimo local). El próximo fix mientras sigue alejándose (todavía dentro de
    // `RADIO_AVISO_M`, mucho más ancho que el radio de detección) volvía a pasar por
    // `fase: 'aproximacion'` con la entrada YA libre → segunda voz "acercándose" a un punto del
    // que en realidad se está alejando. Ahora el ciclo solo se reabre con
    // `limpiarAproximacionesAnunciadas` (llamada desde el geofence cuando RE-ARMA de verdad, ver
    // el test de `anunciarDeteccionesDelTick` más abajo) — confirmar, por sí solo, no alcanza.
    const puntoId = 'pc-aprox-3';
    const opts = opciones([puntoControl(puntoId, 0)]);

    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: puntoId, fase: 'aproximacion', distanciaM: 100 }),
      opts,
    );
    expect(speakMock).toHaveBeenCalledTimes(1);

    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: puntoId, fase: 'confirmado', pasada: 1, distanciaM: 10 }),
      opts,
    );

    // El vehículo sigue alejándose, todavía dentro de RADIO_AVISO_M: NO debe volver a hablar.
    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: puntoId, fase: 'aproximacion', distanciaM: 95 }),
      opts,
    );
    expect(speakMock).toHaveBeenCalledTimes(1);
  });

  it('FIX POST-REVISIÓN (bug 4): limpiarAproximacionesAnunciadas SÍ reabre el ciclo — la vuelta siguiente vuelve a avisar', async () => {
    const puntoId = 'pc-aprox-3b';
    const opts = opciones([puntoControl(puntoId, 0)]);

    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: puntoId, fase: 'aproximacion', distanciaM: 100 }),
      opts,
    );
    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: puntoId, fase: 'confirmado', pasada: 1, distanciaM: 10 }),
      opts,
    );
    expect(speakMock).toHaveBeenCalledTimes(1);

    // El geofence re-armó de verdad (el vehículo se alejó lo suficiente, con la histéresis de
    // FACTOR_REARME_RADIO/FIXES_REARME_CONSECUTIVOS) — recién ACÁ corresponde reabrir.
    limpiarAproximacionesAnunciadas([puntoId]);

    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: puntoId, fase: 'aproximacion', distanciaM: 95 }),
      opts,
    );
    expect(speakMock).toHaveBeenCalledTimes(2);
  });

  it('un fallo de Speech.speak se captura en Sentry y no rechaza (el llamador no necesita su propio try/catch)', async () => {
    speakMock.mockImplementationOnce(() => {
      throw new Error('motor de voz no disponible');
    });

    await expect(
      anunciarPuntoControl(
        DB_FALSO,
        deteccion({ puntoControlId: 'pc-aprox-4', fase: 'aproximacion' }),
        opciones([puntoControl('pc-aprox-4', 0)]),
      ),
    ).resolves.toBeUndefined();

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });
});

describe('anunciarPuntoControl — fase "confirmado" (Entrega 7, dedupe persistido)', () => {
  beforeEach(() => {
    vibrateMock.mockClear();
    speakMock.mockClear();
    scheduleNotificationMock.mockClear();
    setChannelMock.mockClear();
    captureExceptionMock.mockClear();
    registrarAnuncioSiNuevoMock.mockReset().mockResolvedValue(true);
  });

  it('vibra + notifica, nunca habla (la voz es solo para el aviso de aproximación)', async () => {
    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: 'pc-conf-1', fase: 'confirmado', pasada: 1 }),
      opciones([puntoControl('pc-conf-1', 5)]),
    );

    expect(vibrateMock).toHaveBeenCalledTimes(1);
    expect(scheduleNotificationMock).toHaveBeenCalledTimes(1);
    expect(speakMock).not.toHaveBeenCalled();
    // FIX POST-REVISIÓN (bug 3, "cae en el canal por defecto — sin heads-up ni chime"):
    // `trigger: null` entregaba inmediato pero SIN canal — Android enrutaba al canal default
    // (silencioso), y el canal `CANAL_ANUNCIO_ANDROID` con importance HIGH + timbre propio,
    // creado por `asegurarCanalNotificacion()`, nunca se referenciaba desde ningún lado. El fix
    // usa `ChannelAwareTriggerInput` (`{ channelId }`) — el único lugar de este SDK
    // (`expo-notifications@0.32.17`) donde una notificación inmediata puede elegir canal.
    expect(scheduleNotificationMock.mock.calls[0]?.[0]).toMatchObject({
      content: { title: 'Punto de control 6 registrado' },
      trigger: { channelId: 'quivo-anuncio-punto-control-v1' },
    });
  });

  it('misma pasada anunciada dos veces (dos ticks que confirman lo mismo) → un solo anuncio', async () => {
    // Simula el dedupe PERSISTIDO real: la primera llamada gana la fila (INSERT OR IGNORE),
    // la segunda la pierde.
    registrarAnuncioSiNuevoMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const d = deteccion({ puntoControlId: 'pc-conf-2', fase: 'confirmado', pasada: 1 });
    const opts = opciones([puntoControl('pc-conf-2', 0)]);

    await anunciarPuntoControl(DB_FALSO, d, opts);
    await anunciarPuntoControl(DB_FALSO, d, opts);

    expect(vibrateMock).toHaveBeenCalledTimes(1);
    expect(scheduleNotificationMock).toHaveBeenCalledTimes(1);
  });

  it('pasada NUEVA del mismo punto de control (multi-vuelta) → vuelve a anunciar', async () => {
    const opts = opciones([puntoControl('pc-conf-3', 0)]);

    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: 'pc-conf-3', fase: 'confirmado', pasada: 1 }),
      opts,
    );
    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: 'pc-conf-3', fase: 'confirmado', pasada: 2 }),
      opts,
    );

    expect(vibrateMock).toHaveBeenCalledTimes(2);
    expect(scheduleNotificationMock).toHaveBeenCalledTimes(2);
  });

  it('vibra SIEMPRE aunque falle la notificación (canal más robusto, no depende de audio)', async () => {
    scheduleNotificationMock.mockRejectedValueOnce(new Error('canal no disponible'));

    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: 'pc-conf-4', fase: 'confirmado', pasada: 1 }),
      opciones([puntoControl('pc-conf-4', 0)]),
    );

    expect(vibrateMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it('fail-open: si el dedupe persistido falla (SQLite ocupada), anuncia de todos modos', async () => {
    registrarAnuncioSiNuevoMock.mockRejectedValueOnce(new Error('handle zombi'));

    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: 'pc-conf-5', fase: 'confirmado', pasada: 1 }),
      opciones([puntoControl('pc-conf-5', 0)]),
    );

    expect(vibrateMock).toHaveBeenCalledTimes(1);
    expect(scheduleNotificationMock).toHaveBeenCalledTimes(1);
    // El fallo del dedupe queda registrado aparte, con su propio `paso`.
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ paso: 'dedupe-confirmacion' }) }),
    );
  });

  it('ignora una detección "confirmado" sin número de pasada (no debería ocurrir, pero no debe reventar)', async () => {
    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: 'pc-conf-6', fase: 'confirmado', pasada: undefined }),
      opciones([puntoControl('pc-conf-6', 0)]),
    );

    expect(vibrateMock).not.toHaveBeenCalled();
    expect(scheduleNotificationMock).not.toHaveBeenCalled();
  });
});

describe('anunciarPuntoControl — fase "confirmado-proximidad" (DECISIÓN CTO 2026-09-23, RADIO_CONFIRMACION_M)', () => {
  beforeEach(() => {
    vibrateMock.mockClear();
    speakMock.mockClear();
    scheduleNotificationMock.mockClear();
    setChannelMock.mockClear();
    captureExceptionMock.mockClear();
    registrarAnuncioSiNuevoMock.mockReset().mockResolvedValue(true);
  });

  it('vibra + notifica "llegaste", nunca habla, y NO pasa por el dedupe persistido (no hay pasada todavía)', async () => {
    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: 'pc-prox-1', fase: 'confirmado-proximidad', distanciaM: 30 }),
      opciones([puntoControl('pc-prox-1', 5)]),
    );

    expect(vibrateMock).toHaveBeenCalledTimes(1);
    expect(scheduleNotificationMock).toHaveBeenCalledTimes(1);
    expect(speakMock).not.toHaveBeenCalled();
    expect(registrarAnuncioSiNuevoMock).not.toHaveBeenCalled();
    expect(scheduleNotificationMock.mock.calls[0]?.[0]).toMatchObject({
      content: { title: 'Punto de control 6: llegaste' },
      trigger: { channelId: 'quivo-anuncio-punto-control-v1' },
    });
  });

  it('dedupe EN MEMORIA por puntoControlId: una segunda detección de proximidad para el MISMO punto no repite el anuncio', async () => {
    const opts = opciones([puntoControl('pc-prox-2', 0)]);
    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: 'pc-prox-2', fase: 'confirmado-proximidad', distanciaM: 35 }),
      opts,
    );
    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: 'pc-prox-2', fase: 'confirmado-proximidad', distanciaM: 10 }),
      opts,
    );

    expect(vibrateMock).toHaveBeenCalledTimes(1);
    expect(scheduleNotificationMock).toHaveBeenCalledTimes(1);
  });

  it('limpiarConfirmacionesProximidadAnunciadas (liberado por puntosRearmados, la histéresis de DETECCIÓN) permite un nuevo anuncio', async () => {
    const opts = opciones([puntoControl('pc-prox-3', 0)]);
    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: 'pc-prox-3', fase: 'confirmado-proximidad', distanciaM: 35 }),
      opts,
    );
    limpiarConfirmacionesProximidadAnunciadas(['pc-prox-3']);
    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: 'pc-prox-3', fase: 'confirmado-proximidad', distanciaM: 35 }),
      opts,
    );

    expect(vibrateMock).toHaveBeenCalledTimes(2);
    expect(scheduleNotificationMock).toHaveBeenCalledTimes(2);
  });

  it('DECISIÓN CTO: si la proximidad YA anunció "llegaste", la confirmación de EVIDENCIA (fase "confirmado") para la MISMA visita NO repite vibración/notificación', async () => {
    const opts = opciones([puntoControl('pc-prox-4', 0)]);
    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: 'pc-prox-4', fase: 'confirmado-proximidad', distanciaM: 20 }),
      opts,
    );
    expect(vibrateMock).toHaveBeenCalledTimes(1);

    // La evidencia confirma varios fixes después, en el mínimo local — mismo puntoControlId.
    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: 'pc-prox-4', fase: 'confirmado', pasada: 1 }),
      opts,
    );

    // Sin doble aviso para el mismo paso: ni vibración ni notificación nuevas, y el dedupe
    // persistido (SQLite) ni se consulta — no hace falta, ya se avisó.
    expect(vibrateMock).toHaveBeenCalledTimes(1);
    expect(scheduleNotificationMock).toHaveBeenCalledTimes(1);
    expect(registrarAnuncioSiNuevoMock).not.toHaveBeenCalled();
  });

  it('si la proximidad NUNCA anunció (el mínimo no bajó de RADIO_CONFIRMACION_M), la confirmación de evidencia sigue avisando como siempre — "el punto no puede quedar sin confirmar"', async () => {
    const opts = opciones([puntoControl('pc-prox-5', 0)]);

    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: 'pc-prox-5', fase: 'confirmado', pasada: 1 }),
      opts,
    );

    expect(vibrateMock).toHaveBeenCalledTimes(1);
    expect(scheduleNotificationMock).toHaveBeenCalledTimes(1);
  });
});

describe('anunciarDeteccionesDelTick (Entrega 7)', () => {
  beforeEach(() => {
    vibrateMock.mockClear();
    speakMock.mockClear();
    scheduleNotificationMock.mockClear();
    registrarAnuncioSiNuevoMock.mockReset().mockResolvedValue(true);
  });

  it('anuncia la aproximación y la confirmación del mismo tick cuando ambas vienen', async () => {
    const opts = opciones([puntoControl('pc-tick-1', 0)]);
    await anunciarDeteccionesDelTick(DB_FALSO, opts, {
      deteccionAproximacion: deteccion({
        puntoControlId: 'pc-tick-1',
        fase: 'aproximacion',
        distanciaM: 120,
      }),
      deteccion: deteccion({ puntoControlId: 'pc-tick-1', fase: 'confirmado', pasada: 1 }),
    });

    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(vibrateMock).toHaveBeenCalledTimes(1);
    expect(scheduleNotificationMock).toHaveBeenCalledTimes(1);
  });

  it('no anuncia nada cuando el tick no trae ninguna detección', async () => {
    await anunciarDeteccionesDelTick(DB_FALSO, opciones(), {
      deteccionAproximacion: null,
      deteccion: null,
    });

    expect(speakMock).not.toHaveBeenCalled();
    expect(vibrateMock).not.toHaveBeenCalled();
    expect(scheduleNotificationMock).not.toHaveBeenCalled();
  });

  it('FIX POST-REVISIÓN (G1): puntosRearmadosVoz libera el dedupe de aproximación ANTES de procesar el tick', async () => {
    const puntoId = 'pc-tick-rearme';
    const opts = opciones([puntoControl(puntoId, 0)]);

    // "Usa" la entrada de aproximación de este punto.
    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: puntoId, fase: 'aproximacion', distanciaM: 100 }),
      opts,
    );
    expect(speakMock).toHaveBeenCalledTimes(1);

    // Un tick que re-arma la histéresis PROPIA de voz de ESTE punto (`puntosRearmadosVoz`,
    // `gps/geofence.ts` — G1) y, en el mismo tick, ya está de nuevo dentro de RADIO_AVISO_M
    // (rebote) — debe poder volver a avisar sin esperar al tick siguiente. A propósito NO se usa
    // `puntosRearmados` (la histéresis de DETECCIÓN, sobre `radioToleranciaM`): reusar esa acá
    // era justo el bug que G1 cierra (la detección re-arma mucho antes de que el vehículo salga
    // de verdad de la zona de aviso).
    await anunciarDeteccionesDelTick(DB_FALSO, opts, {
      deteccion: null,
      deteccionAproximacion: deteccion({ puntoControlId: puntoId, fase: 'aproximacion', distanciaM: 140 }),
      puntosRearmadosVoz: [puntoId],
    });

    expect(speakMock).toHaveBeenCalledTimes(2);
  });

  it('FIX POST-REVISIÓN (G1): puntosRearmados (histéresis de DETECCIÓN) NO libera el dedupe de voz', async () => {
    const puntoId = 'pc-tick-rearme-deteccion';
    const opts = opciones([puntoControl(puntoId, 0)]);

    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: puntoId, fase: 'aproximacion', distanciaM: 100 }),
      opts,
    );
    expect(speakMock).toHaveBeenCalledTimes(1);

    // Sin `puntosRearmadosVoz` (undefined): la detección pudo haber re-armado
    // (`radioToleranciaM`, mucho más chico que `RADIO_AVISO_M`), pero eso YA NO alcanza para
    // reabrir la voz (G1) — el vehículo puede seguir a 60-140 m, adentro de la zona de aviso.
    await anunciarDeteccionesDelTick(DB_FALSO, opts, {
      deteccion: null,
      deteccionAproximacion: deteccion({ puntoControlId: puntoId, fase: 'aproximacion', distanciaM: 90 }),
    });

    expect(speakMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * Hallazgo de campo (Sentry, build 10 de producción, Galaxy A71 Android 13): declarar
 * `POST_NOTIFICATIONS` en `app.config.ts` no alcanza en Android 13+ — hay que pedirlo en
 * runtime. `asegurarPermisoNotificaciones` es lo que llama `iniciar()` en
 * `use-gps-operativo.ts`, en foreground, antes de arrancar el recorrido.
 */
describe('asegurarPermisoNotificaciones (hallazgo de campo, Android 13 POST_NOTIFICATIONS)', () => {
  beforeEach(() => {
    getPermissionsMock.mockReset().mockResolvedValue({ status: 'granted' });
    requestPermissionsMock.mockReset().mockResolvedValue({ status: 'granted' });
    captureExceptionMock.mockClear();
  });

  it('si ya está concedido, no vuelve a mostrar el diálogo (no llama a requestPermissionsAsync)', async () => {
    getPermissionsMock.mockResolvedValue({ status: 'granted' });

    const resultado = await asegurarPermisoNotificaciones();

    expect(resultado).toBe('granted');
    expect(requestPermissionsMock).not.toHaveBeenCalled();
  });

  it('si todavía no se preguntó, pide el permiso y devuelve la respuesta del chofer', async () => {
    getPermissionsMock.mockResolvedValue({ status: 'undetermined' });
    requestPermissionsMock.mockResolvedValue({ status: 'denied' });

    const resultado = await asegurarPermisoNotificaciones();

    expect(requestPermissionsMock).toHaveBeenCalledTimes(1);
    expect(resultado).toBe('denied');
  });

  it('best-effort: si el bridge nativo falla, no rechaza — devuelve null y reporta a Sentry', async () => {
    getPermissionsMock.mockRejectedValue(new Error('bridge no disponible'));

    await expect(asegurarPermisoNotificaciones()).resolves.toBeNull();
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ paso: 'pedir-permiso-notificaciones' }),
      }),
    );
  });
});

describe('obtenerEstadoPermisoNotificaciones (lectura para el preflight de la Entrega 26)', () => {
  beforeEach(() => {
    getPermissionsMock.mockReset();
    requestPermissionsMock.mockReset();
    captureExceptionMock.mockClear();
  });

  it('lee el estado SIN disparar el diálogo del sistema', async () => {
    getPermissionsMock.mockResolvedValue({ status: 'denied' });

    const resultado = await obtenerEstadoPermisoNotificaciones();

    expect(resultado).toBe('denied');
    expect(requestPermissionsMock).not.toHaveBeenCalled();
  });

  it('devuelve null (no "denegado") si falla la lectura — para no confundir un problema transitorio con una decisión del chofer', async () => {
    getPermissionsMock.mockRejectedValue(new Error('bridge no disponible'));

    await expect(obtenerEstadoPermisoNotificaciones()).resolves.toBeNull();
  });
});

/**
 * El punto central del hallazgo de campo: la notificación es UN canal más, no el único. Si el
 * chofer deniega `POST_NOTIFICATIONS` (o el permiso todavía no se concedió), la confirmación de
 * un punto de control sigue vibrando y la voz de aproximación sigue hablando — ninguna de las
 * dos depende de ese permiso. Antes de este hallazgo esto YA era cierto por construcción
 * (`Vibration.vibrate` corre fuera del `try/catch` de la notificación, `Speech.speak` no toca
 * `expo-notifications` en absoluto) — este bloque lo prueba EXPLÍCITAMENTE contra el escenario
 * real reportado (permiso denegado), no solo contra un fallo genérico de `scheduleNotificationAsync`.
 */
describe('permiso de notificaciones denegado — el anuncio NO se pierde (hallazgo de campo)', () => {
  beforeEach(() => {
    vibrateMock.mockClear();
    speakMock.mockClear();
    scheduleNotificationMock.mockClear();
    registrarAnuncioSiNuevoMock.mockReset().mockResolvedValue(true);
    // Simula el estado real reportado desde el campo: sin el permiso, Android no rechaza la
    // llamada — silenciosamente no muestra nada. `scheduleNotificationAsync` puede devolver un
    // id igual (comportamiento real documentado del SDK) y aun así la notificación no aparece;
    // desde el código esto es indistinguible de un éxito, así que la garantía tiene que venir
    // de que la vibración NUNCA dependa de este resultado, no de detectarlo.
    scheduleNotificationMock.mockResolvedValue('notif-id-fantasma');
  });

  it('confirmación con notificaciones denegadas: vibra igual (la vibración no depende de si la notificación se ve)', async () => {
    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: 'pc-denegado-1', fase: 'confirmado', pasada: 1 }),
      opciones([puntoControl('pc-denegado-1', 0)]),
    );

    expect(vibrateMock).toHaveBeenCalledTimes(1);
  });

  it('aproximación con notificaciones denegadas: la voz sigue hablando (no depende de expo-notifications)', async () => {
    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: 'pc-denegado-2', fase: 'aproximacion', distanciaM: 100 }),
      opciones([puntoControl('pc-denegado-2', 0)]),
    );

    expect(speakMock).toHaveBeenCalledTimes(1);
  });

  it('un tick completo (aproximación + confirmación) con notificaciones denegadas: vibra Y habla, en cualquier orden de fallo de la notificación', async () => {
    scheduleNotificationMock.mockRejectedValueOnce(new Error('POST_NOTIFICATIONS denegado'));
    const opts = opciones([puntoControl('pc-denegado-3', 0)]);

    await anunciarDeteccionesDelTick(DB_FALSO, opts, {
      deteccionAproximacion: deteccion({
        puntoControlId: 'pc-denegado-3',
        fase: 'aproximacion',
        distanciaM: 90,
      }),
      deteccion: deteccion({ puntoControlId: 'pc-denegado-3', fase: 'confirmado', pasada: 1 }),
    });

    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(vibrateMock).toHaveBeenCalledTimes(1);
  });
});

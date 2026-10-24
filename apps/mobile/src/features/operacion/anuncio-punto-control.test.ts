import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { RADIO_CONFIRMACION_M, type PuntoControlPaquete } from '@quivo/shared';
import type { DeteccionPuntoControl } from '../../gps/geofence';

// ENTREGA 7 (plan post-piloto 2026-09-09, "anuncio desde headless"): `anuncio-punto-control.ts`
// es DELIBERADAMENTE sin React (lo llama tanto `tareaHeadlessUbicacion`, sin árbol de
// componentes, como `use-gps-operativo.ts` en foreground) — ver el docblock de cabecera de ese
// módulo. `expo-notifications`, `expo-speech` y `@sentry/react-native` importan `react-native`
// por debajo, que rompe bajo vitest/Node (sintaxis Flow que Rollup no puede parsear) — mismo
// motivo por el que `headless-task.test.ts` mockea sus propias dependencias nativas.
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  Vibration: { vibrate: vi.fn() },
}));

vi.mock('expo-speech', () => ({
  speak: vi.fn(),
}));

vi.mock('expo-notifications', () => ({
  setNotificationChannelAsync: vi.fn().mockResolvedValue(undefined),
  deleteNotificationChannelAsync: vi.fn().mockResolvedValue(undefined),
  scheduleNotificationAsync: vi.fn().mockResolvedValue('notif-id'),
  // FIX POST-REVISIÓN (Codex `verify-fix`, punto 4): `anuncio-punto-control.ts` llama
  // `setNotificationHandler` como efecto de MÓDULO (al importarlo) — sin este mock, cualquier
  // test que importe el módulo real (todo este archivo) rompería en la carga.
  setNotificationHandler: vi.fn(),
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

// REDISEÑO (decisión del CTO, ronda posterior al veredicto `partial` de Codex `verify-fix` del
// 2026-09-23, punto 3 del brief — "intención durable ANTES de programar"): el dedupe viejo
// (`registrarAnuncioSiNuevo`/`anuncioYaRegistrado`) fue reemplazado por el mecanismo de intención
// reclamada — se mockea igual que antes (`../../db/outbox` trae `expo-sqlite`, que también rompe
// bajo Node).
vi.mock('../../db/outbox', () => ({
  claveAnuncio: (sesionId: string, puntoControlId: string, pasada: number) =>
    `${sesionId}:${puntoControlId}:${pasada}`,
  reclamarIntencionAnuncio: vi.fn(),
  marcarAnuncioProgramado: vi.fn().mockResolvedValue(undefined),
  marcarAnuncioProgramando: vi.fn().mockResolvedValue(undefined),
  obtenerAnunciosPendientesDeProgramar: vi.fn().mockResolvedValue([]),
}));

// La designación activa (orden efectivo de la voz) sale del cache SQLite de la vuelta actual.
const designacionMock = vi.hoisted(() => ({
  valor: null as { puntoEspera: { id: string } } | null,
  lecturas: 0,
}));
vi.mock('../../db/vuelta-actual-local', () => ({
  leerDesignacionOrdenLocal: async () => {
    designacionMock.lecturas += 1;
    return designacionMock.valor;
  },
}));

import { Platform, Vibration } from 'react-native';
import * as Speech from 'expo-speech';
import * as Notifications from 'expo-notifications';
import * as Sentry from '@sentry/react-native';
import {
  marcarAnuncioProgramado,
  marcarAnuncioProgramando,
  obtenerAnunciosPendientesDeProgramar,
  reclamarIntencionAnuncio,
} from '../../db/outbox';
import {
  anunciarDeteccionesDelTick,
  anunciarLlegadaPuntoControl,
  anunciarPuntoControl,
  asegurarPermisoNotificaciones,
  limpiarAproximacionesAnunciadas,
  limpiarCanalesObsoletos,
  limpiarSilenciosTerminal,
  obtenerEstadoPermisoNotificaciones,
  reintentarAnunciosLlegadaPendientes,
  silenciarTerminalAnclado,
  terminalSilenciado,
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
const reclamarIntencionAnuncioMock = reclamarIntencionAnuncio as unknown as ReturnType<typeof vi.fn>;
const marcarAnuncioProgramadoMock = marcarAnuncioProgramado as unknown as ReturnType<typeof vi.fn>;
const marcarAnuncioProgramandoMock = marcarAnuncioProgramando as unknown as ReturnType<typeof vi.fn>;
const obtenerAnunciosPendientesDeProgramarMock =
  obtenerAnunciosPendientesDeProgramar as unknown as ReturnType<typeof vi.fn>;

const DB_FALSO = {} as never;

/**
 * REDISEÑO (hallazgo 1): simula la tabla real `anuncios_punto_control` (clave PK, estado
 * 'pendiente'/'programando'/'programado') para los tests — `reclamarIntencionAnuncioMock` inserta
 * (con `INSERT OR IGNORE`, solo la primera llamada por clave "gana"), `marcarAnuncioProgramandoMock`
 * mueve la fila a `'programando'`, `marcarAnuncioProgramadoMock` la mueve a `'programado'`, y
 * `obtenerAnunciosPendientesDeProgramarMock` lista lo que sigue `'pendiente'` (siempre) o
 * `'programando'` (solo si nadie la reclamó de nuevo desde entonces, mismo criterio simplificado
 * que el SQL real — acá no hay staleness de verdad porque los tests no controlan el reloj, así
 * que una fila `'programando'` se sigue ofreciendo salvo que ya haya pasado a `'programado'`).
 */
function configurarTablaAnunciosRealista(): void {
  const filas = new Map<
    string,
    { sesionId: string; puntoControlId: string; pasada: number; motivo: string; estado: string }
  >();
  reclamarIntencionAnuncioMock.mockReset().mockImplementation(
    async (_db: unknown, sesionId: string, puntoControlId: string, pasada: number, motivo: string) => {
      const clave = `${sesionId}:${puntoControlId}:${pasada}`;
      if (filas.has(clave)) return { reclamado: false, clave };
      filas.set(clave, { sesionId, puntoControlId, pasada, motivo, estado: 'pendiente' });
      return { reclamado: true, clave };
    },
  );
  marcarAnuncioProgramandoMock.mockReset().mockImplementation(async (_db: unknown, clave: string) => {
    const fila = filas.get(clave);
    if (fila) fila.estado = 'programando';
  });
  marcarAnuncioProgramadoMock.mockReset().mockImplementation(async (_db: unknown, clave: string) => {
    const fila = filas.get(clave);
    if (fila) fila.estado = 'programado';
  });
  obtenerAnunciosPendientesDeProgramarMock.mockReset().mockImplementation(async (_db: unknown, sesionId: string) => {
    const pendientes: {
      clave: string;
      sesionId: string;
      puntoControlId: string;
      pasada: number;
      motivo: string;
    }[] = [];
    for (const [clave, fila] of filas) {
      if (fila.sesionId !== sesionId) continue;
      if (fila.estado === 'pendiente' || fila.estado === 'programando') {
        pendientes.push({ clave, sesionId: fila.sesionId, puntoControlId: fila.puntoControlId, pasada: fila.pasada, motivo: fila.motivo });
      }
    }
    return pendientes;
  });
}

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
    configurarTablaAnunciosRealista();
  });

  it('solo habla — nunca vibra ni notifica (es un aviso informativo, no evidencia de paso)', async () => {
    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: 'pc-aprox-1', fase: 'aproximacion', distanciaM: 134 }),
      opciones([puntoControl('pc-aprox-1', 15)]),
    );

    expect(speakMock).toHaveBeenCalledTimes(1);
    // ENTREGA 5: la voz redondea a decenas ("a 130 metros", no "a 134 metros") y dice la
    // posición humana en el orden efectivo (1-indexada; un único PC es el 1).
    expect(speakMock.mock.calls[0]?.[0]).toBe('Punto de control 1, a 130 m.');
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

  it('FIX POST-REVISIÓN (bug 4): confirmar (fase "confirmado") NO reabre el ciclo de aproximación — la voz no vuelve a hablar por sí sola', async () => {
    const puntoId = 'pc-aprox-3';
    const opts = opciones([puntoControl(puntoId, 0)]);

    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: puntoId, fase: 'aproximacion', distanciaM: 100 }),
      opts,
    );
    expect(speakMock).toHaveBeenCalledTimes(1);

    // `anunciarPuntoControl` ignora en silencio cualquier `fase` que no sea 'aproximacion' —
    // ver el docblock de la función (rediseño 2026-09-23): el resto del canal (vibración,
    // notificación) ya no vive acá.
    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: puntoId, fase: 'confirmado', pasada: 1, distanciaM: 10 }),
      opts,
    );

    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: puntoId, fase: 'aproximacion', distanciaM: 95 }),
      opts,
    );
    // El vehículo sigue alejándose, todavía dentro de RADIO_AVISO_M: NO debe volver a hablar.
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

describe('anunciarPuntoControl — orden efectivo y Molinos', () => {
  const l16 = (): PuntoControlPaquete[] => [
    { ...puntoControl('sr', 0), rol: 'terminal' },
    { ...puntoControl('molinos', 1), rol: 'espera' },
    { ...puntoControl('honduras', 2), rol: 'retorno' },
  ];

  beforeEach(() => {
    speakMock.mockClear();
    designacionMock.valor = null;
    configurarTablaAnunciosRealista();
  });

  it('sin designación: Honduras es el "Punto de control 2" (no 3) y Molinos no se anuncia', async () => {
    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: 'honduras', fase: 'aproximacion', distanciaM: 100 }),
      opciones(l16()),
    );
    expect(speakMock.mock.calls[0]?.[0]).toBe('Punto de control 2, a 100 m.');
    speakMock.mockClear();
    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: 'molinos', fase: 'aproximacion', distanciaM: 100 }),
      opciones(l16()),
    );
    expect(speakMock).not.toHaveBeenCalled();
  });

  it('con designación activa: Molinos entra tras Honduras y se anuncia como "Punto de control 3"', async () => {
    limpiarAproximacionesAnunciadas(['molinos']); // descarta el veredicto del test anterior
    designacionMock.valor = { puntoEspera: { id: 'molinos' } };
    await anunciarPuntoControl(
      DB_FALSO,
      deteccion({ puntoControlId: 'molinos', fase: 'aproximacion', distanciaM: 100 }),
      opciones(l16()),
    );
    expect(speakMock.mock.calls[0]?.[0]).toBe('Punto de control 3, a 100 m.');
  });

  it('dedupe primero: un punto ya anunciado no lee la designación (SQLite)', async () => {
    const det = deteccion({ puntoControlId: 'honduras', fase: 'aproximacion', distanciaM: 100 });
    limpiarAproximacionesAnunciadas(['honduras']);
    await anunciarPuntoControl(DB_FALSO, det, opciones(l16()));
    designacionMock.lecturas = 0;
    speakMock.mockClear();
    await anunciarPuntoControl(DB_FALSO, det, opciones(l16()));
    expect(designacionMock.lecturas).toBe(0);
    expect(speakMock).not.toHaveBeenCalled();
  });

  it('Molinos sin designación no se agrega al dedupe: al llegar la designación sí se anuncia', async () => {
    const det = deteccion({ puntoControlId: 'molinos', fase: 'aproximacion', distanciaM: 100 });
    limpiarAproximacionesAnunciadas(['molinos']);
    await anunciarPuntoControl(DB_FALSO, det, opciones(l16()));
    expect(speakMock).not.toHaveBeenCalled();
    designacionMock.valor = { puntoEspera: { id: 'molinos' } };
    // El veredicto negativo se recuerda unos segundos: pasado ese lapso, se relee y se anuncia.
    const ahora = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(ahora + 5_000);
    try {
      await anunciarPuntoControl(DB_FALSO, det, opciones(l16()));
    } finally {
      spy.mockRestore();
    }
    expect(speakMock).toHaveBeenCalledTimes(1);
  });

  it('Molinos sin designación: los ticks siguientes dentro de la vigencia no leen SQLite', async () => {
    const det = deteccion({ puntoControlId: 'molinos', fase: 'aproximacion', distanciaM: 100 });
    limpiarAproximacionesAnunciadas(['molinos']);
    const ahora = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(ahora + 60_000); // fuera de cualquier veredicto previo
    try {
      await anunciarPuntoControl(DB_FALSO, det, opciones(l16()));
      designacionMock.lecturas = 0;
      await anunciarPuntoControl(DB_FALSO, det, opciones(l16()));
      await anunciarPuntoControl(DB_FALSO, det, opciones(l16()));
    } finally {
      spy.mockRestore();
    }
    expect(designacionMock.lecturas).toBe(0);
    expect(speakMock).not.toHaveBeenCalled();
  });
});

describe('anunciarLlegadaPuntoControl (REDISEÑO 2026-09-23 — intención durable + motivo)', () => {
  beforeEach(() => {
    designacionMock.valor = null;
    vibrateMock.mockClear();
    speakMock.mockClear();
    scheduleNotificationMock.mockClear();
    setChannelMock.mockClear();
    captureExceptionMock.mockClear();
    configurarTablaAnunciosRealista();
  });

  it('PC de espera (Molinos) sin designación: no vibra, no notifica ni reclama la intención', async () => {
    designacionMock.valor = null;
    const pcs = [
      { ...puntoControl('sr', 0), rol: 'terminal' as const },
      { ...puntoControl('molinos', 1), rol: 'espera' as const },
    ];
    const r = await anunciarLlegadaPuntoControl(DB_FALSO, 'molinos', 1, 'proximidad', opciones(pcs));
    expect(r).toBe(false);
    expect(vibrateMock).not.toHaveBeenCalled();
    expect(scheduleNotificationMock).not.toHaveBeenCalled();
    expect(reclamarIntencionAnuncioMock).not.toHaveBeenCalled();
    designacionMock.valor = { puntoEspera: { id: 'molinos' } };
    await anunciarLlegadaPuntoControl(DB_FALSO, 'molinos', 1, 'proximidad', opciones(pcs));
    expect(vibrateMock).toHaveBeenCalledTimes(1);
  });

  it('reclama la intención ANTES de programar, y programa con `identifier` = la clave reclamada', async () => {
    await anunciarLlegadaPuntoControl(
      DB_FALSO,
      'pc-1',
      1,
      'proximidad',
      opciones([puntoControl('pc-1', 5)]),
    );

    expect(reclamarIntencionAnuncioMock).toHaveBeenCalledWith(DB_FALSO, 'sesion-1', 'pc-1', 1, 'proximidad');
    expect(vibrateMock).toHaveBeenCalledTimes(1);
    expect(scheduleNotificationMock).toHaveBeenCalledTimes(1);
    expect(scheduleNotificationMock.mock.calls[0]?.[0]).toMatchObject({
      identifier: 'sesion-1:pc-1:1',
      content: { title: 'Punto de control 1: llegaste' },
      trigger: { channelId: 'quivo-anuncio-punto-control-v2' },
    });
    // Reclamó → programó con éxito → marca 'programado'.
    expect(marcarAnuncioProgramadoMock).toHaveBeenCalledWith(DB_FALSO, 'sesion-1:pc-1:1');
  });

  it('motivo "proximidad": el texto menciona RADIO_CONFIRMACION_M (derivado de la constante, no hardcodeado)', async () => {
    await anunciarLlegadaPuntoControl(DB_FALSO, 'pc-1', 1, 'proximidad', opciones());
    expect(scheduleNotificationMock.mock.calls[0]?.[0]).toMatchObject({
      content: { body: `Estás a menos de ${RADIO_CONFIRMACION_M} metros del punto de control.` },
    });
  });

  it('motivo "fallback-tiempo": texto PROPIO, sin mencionar la distancia de proximidad (punto 7 del brief)', async () => {
    await anunciarLlegadaPuntoControl(DB_FALSO, 'pc-1', 1, 'fallback-tiempo', opciones());
    const body = scheduleNotificationMock.mock.calls[0]?.[0]?.content?.body as string;
    expect(body).not.toContain(`${RADIO_CONFIRMACION_M}`);
    expect(body).not.toMatch(/40\s*m/i);
  });

  it('motivo "fallback-salida": texto PROPIO, sin mencionar la distancia de proximidad (punto 7 del brief)', async () => {
    await anunciarLlegadaPuntoControl(DB_FALSO, 'pc-1', 1, 'fallback-salida', opciones());
    const body = scheduleNotificationMock.mock.calls[0]?.[0]?.content?.body as string;
    expect(body).not.toContain(`${RADIO_CONFIRMACION_M}`);
    expect(body).not.toMatch(/40\s*m/i);
  });

  it('reclamado: false (dos ticks que deciden la MISMA visita) → la segunda llamada NO vibra ni programa de nuevo', async () => {
    const opts = opciones([puntoControl('pc-2', 0)]);
    await anunciarLlegadaPuntoControl(DB_FALSO, 'pc-2', 1, 'proximidad', opts);
    await anunciarLlegadaPuntoControl(DB_FALSO, 'pc-2', 1, 'proximidad', opts);

    expect(vibrateMock).toHaveBeenCalledTimes(1);
    expect(scheduleNotificationMock).toHaveBeenCalledTimes(1);
  });

  it('pasada NUEVA (multi-vuelta) → vuelve a anunciar (identidad distinta)', async () => {
    const opts = opciones([puntoControl('pc-3', 0)]);
    await anunciarLlegadaPuntoControl(DB_FALSO, 'pc-3', 1, 'proximidad', opts);
    await anunciarLlegadaPuntoControl(DB_FALSO, 'pc-3', 2, 'proximidad', opts);

    expect(vibrateMock).toHaveBeenCalledTimes(2);
    expect(scheduleNotificationMock).toHaveBeenCalledTimes(2);
  });

  it('FIX (punto 3 del brief): si programar la notificación falla, NO se marca "programado" — la fila queda "programando"', async () => {
    scheduleNotificationMock.mockRejectedValueOnce(new Error('canal no disponible'));
    const exitoso = await anunciarLlegadaPuntoControl(
      DB_FALSO,
      'pc-4',
      1,
      'proximidad',
      opciones([puntoControl('pc-4', 0)]),
    );

    expect(exitoso).toBe(false);
    expect(vibrateMock).toHaveBeenCalledTimes(1);
    expect(marcarAnuncioProgramandoMock).toHaveBeenCalledWith(DB_FALSO, 'sesion-1:pc-4:1');
    expect(marcarAnuncioProgramadoMock).not.toHaveBeenCalled();
    // La intención SIGUE reclamada (no se revierte) — el reintento la retoma, no la reclama de
    // nuevo (ver `reintentarAnunciosLlegadaPendientes`, abajo).
    const pendientes = await obtenerAnunciosPendientesDeProgramarMock(DB_FALSO, 'sesion-1');
    expect(pendientes).toEqual([
      { clave: 'sesion-1:pc-4:1', sesionId: 'sesion-1', puntoControlId: 'pc-4', pasada: 1, motivo: 'proximidad' },
    ]);
  });

  it('FIX POST-REVISIÓN (hallazgo 6): fail CLOSED — si la reclamación misma falla (SQLite ocupada), NO vibra ni programa nada en este intento', async () => {
    // `sesionId` PROPIO (no el `'sesion-1'` compartido por `opciones()`): este test deja A
    // PROPÓSITO un reclamo fallido sin drenar en `reclamosFallidos` (un mapa a nivel de MÓDULO,
    // real, no mockeado) — con `'sesion-1'` contaminaría cualquier test posterior que llame
    // `reintentarAnunciosLlegadaPendientes(DB_FALSO, 'sesion-1', ...)`.
    reclamarIntencionAnuncioMock.mockRejectedValueOnce(new Error('handle zombi'));
    const exitoso = await anunciarLlegadaPuntoControl(
      DB_FALSO,
      'pc-5',
      1,
      'proximidad',
      { sesionId: 'sesion-hallazgo-6-fail-closed', puntosControl: [puntoControl('pc-5', 0)] },
    );

    expect(exitoso).toBe(false);
    expect(vibrateMock).not.toHaveBeenCalled();
    expect(scheduleNotificationMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ paso: 'reclamar-intencion-llegada' }) }),
    );
  });

  it('FIX POST-REVISIÓN (hallazgo 6): un reclamo fallido se reintenta desde `reintentarAnunciosLlegadaPendientes` y SÍ termina anunciando', async () => {
    // `sesionId` PROPIO de este test (no el `'sesion-1'` compartido por `opciones()`): el test
    // anterior ("fail CLOSED") deja su propio reclamo fallido (`pc-5`) sin drenar en
    // `reclamosFallidos` — un mapa a nivel de MÓDULO, real (no mockeado) — y
    // `reintentarAnunciosLlegadaPendientes` reintenta TODOS los reclamos de la sesión pedida, no
    // solo el de este test. Aislar por sesión evita que un test contamine el conteo del otro (en
    // producción esto es exactamente el comportamiento correcto: reintentar todo lo pendiente de
    // la sesión activa).
    const opts: AnuncioPuntoControlOpciones = {
      sesionId: 'sesion-hallazgo-6-retry',
      puntosControl: [puntoControl('pc-5b', 0)],
    };
    reclamarIntencionAnuncioMock.mockRejectedValueOnce(new Error('handle zombi'));
    const primerIntento = await anunciarLlegadaPuntoControl(DB_FALSO, 'pc-5b', 1, 'proximidad', opts);
    expect(primerIntento).toBe(false);
    expect(vibrateMock).not.toHaveBeenCalled();

    await reintentarAnunciosLlegadaPendientes(DB_FALSO, 'sesion-hallazgo-6-retry', [puntoControl('pc-5b', 0)]);

    expect(vibrateMock).toHaveBeenCalledTimes(1);
    expect(scheduleNotificationMock).toHaveBeenCalledTimes(1);
  });

  it('vibra SIEMPRE aunque falle la notificación (canal más robusto, no depende de audio)', async () => {
    scheduleNotificationMock.mockRejectedValueOnce(new Error('canal no disponible'));
    await anunciarLlegadaPuntoControl(DB_FALSO, 'pc-6', 1, 'proximidad', opciones([puntoControl('pc-6', 0)]));

    expect(vibrateMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ paso: 'notificacion-llegada' }) }),
    );
  });
});

describe('reintentarAnunciosLlegadaPendientes (drenado, dentro de conTimeout — gap 6)', () => {
  beforeEach(() => {
    vibrateMock.mockClear();
    scheduleNotificationMock.mockClear();
    captureExceptionMock.mockClear();
    configurarTablaAnunciosRealista();
  });

  it('reprograma una intención "programando" SIN volver a reclamarla', async () => {
    scheduleNotificationMock.mockRejectedValueOnce(new Error('canal no disponible'));
    await anunciarLlegadaPuntoControl(DB_FALSO, 'pc-1', 1, 'fallback-tiempo', opciones([puntoControl('pc-1', 0)]));
    expect(marcarAnuncioProgramadoMock).not.toHaveBeenCalled();
    reclamarIntencionAnuncioMock.mockClear();

    await reintentarAnunciosLlegadaPendientes(DB_FALSO, 'sesion-1', [puntoControl('pc-1', 0)]);

    expect(reclamarIntencionAnuncioMock).not.toHaveBeenCalled(); // no reclama de nuevo
    expect(scheduleNotificationMock).toHaveBeenCalledTimes(2); // 1er intento (fallido) + reintento
    expect(marcarAnuncioProgramadoMock).toHaveBeenCalledWith(DB_FALSO, 'sesion-1:pc-1:1');
  });

  it('no reintenta una intención de OTRA sesión (hallazgo 5)', async () => {
    scheduleNotificationMock.mockRejectedValueOnce(new Error('canal no disponible'));
    await anunciarLlegadaPuntoControl(DB_FALSO, 'pc-1b', 1, 'fallback-tiempo', opciones([puntoControl('pc-1b', 0)]));
    scheduleNotificationMock.mockClear();

    await reintentarAnunciosLlegadaPendientes(DB_FALSO, 'otra-sesion', [puntoControl('pc-1b', 0)]);

    expect(scheduleNotificationMock).not.toHaveBeenCalled();
  });

  it('no hace nada si no hay pendientes', async () => {
    await reintentarAnunciosLlegadaPendientes(DB_FALSO, 'sesion-1', []);
    expect(scheduleNotificationMock).not.toHaveBeenCalled();
  });

  it('best-effort: si listar pendientes falla, se reporta a Sentry y no rechaza', async () => {
    obtenerAnunciosPendientesDeProgramarMock.mockRejectedValueOnce(new Error('handle zombi'));
    await expect(reintentarAnunciosLlegadaPendientes(DB_FALSO, 'sesion-1', [])).resolves.toBeUndefined();
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ paso: 'listar-anuncios-pendientes' }) }),
    );
  });

  /** FIX POST-REVISIÓN (hallazgo 10, cleanup — "validar motivo antes de textoAnuncioLlegada"). */
  it('salta (y reporta) una fila pendiente con `motivo` irreconocible, sin programar nada', async () => {
    obtenerAnunciosPendientesDeProgramarMock.mockResolvedValueOnce([
      { clave: 'sesion-1:pc-raro:1', sesionId: 'sesion-1', puntoControlId: 'pc-raro', pasada: 1, motivo: 'motivo-inventado' },
    ]);

    await reintentarAnunciosLlegadaPendientes(DB_FALSO, 'sesion-1', [puntoControl('pc-raro', 0)]);

    expect(scheduleNotificationMock).not.toHaveBeenCalled();
    expect(vibrateMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ paso: 'reintentar-motivo-invalido' }),
      }),
    );
  });
});

describe('anunciarDeteccionesDelTick (REDISEÑO — solo EJECUTA decisiones ya tomadas)', () => {
  beforeEach(() => {
    vibrateMock.mockClear();
    speakMock.mockClear();
    scheduleNotificationMock.mockClear();
    configurarTablaAnunciosRealista();
  });

  it('ejecuta el aviso de aproximación Y los anuncios de llegada del mismo tick', async () => {
    const opts = opciones([puntoControl('pc-tick-1', 0)]);
    await anunciarDeteccionesDelTick(DB_FALSO, opts, {
      deteccionAproximacion: deteccion({
        puntoControlId: 'pc-tick-1',
        fase: 'aproximacion',
        distanciaM: 120,
      }),
      anunciosLlegada: [{ puntoControlId: 'pc-tick-1', pasada: 1, motivo: 'proximidad' }],
    });

    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(vibrateMock).toHaveBeenCalledTimes(1);
    expect(scheduleNotificationMock).toHaveBeenCalledTimes(1);
  });

  it('no anuncia nada cuando el tick no trae ninguna decisión', async () => {
    await anunciarDeteccionesDelTick(DB_FALSO, opciones(), {
      deteccionAproximacion: null,
      anunciosLlegada: [],
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

    await anunciarDeteccionesDelTick(DB_FALSO, opts, {
      deteccionAproximacion: deteccion({ puntoControlId: puntoId, fase: 'aproximacion', distanciaM: 140 }),
      anunciosLlegada: [],
      puntosRearmadosVoz: [puntoId],
    });

    expect(speakMock).toHaveBeenCalledTimes(2);
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
 * dos depende de ese permiso.
 */
describe('permiso de notificaciones denegado — el anuncio NO se pierde (hallazgo de campo)', () => {
  beforeEach(() => {
    vibrateMock.mockClear();
    speakMock.mockClear();
    scheduleNotificationMock.mockClear();
    configurarTablaAnunciosRealista();
    // Simula el estado real reportado desde el campo: sin el permiso, Android no rechaza la
    // llamada — silenciosamente no muestra nada. `scheduleNotificationAsync` puede devolver un
    // id igual (comportamiento real documentado del SDK) y aun así la notificación no aparece;
    // desde el código esto es indistinguible de un éxito, así que la garantía tiene que venir
    // de que la vibración NUNCA dependa de este resultado, no de detectarlo.
    scheduleNotificationMock.mockResolvedValue('notif-id-fantasma');
  });

  it('llegada con notificaciones denegadas: vibra igual (la vibración no depende de si la notificación se ve)', async () => {
    await anunciarLlegadaPuntoControl(
      DB_FALSO,
      'pc-denegado-1',
      1,
      'proximidad',
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

  it('un tick completo (aproximación + llegada) con notificaciones denegadas: vibra Y habla, en cualquier orden de fallo de la notificación', async () => {
    scheduleNotificationMock.mockRejectedValueOnce(new Error('POST_NOTIFICATIONS denegado'));
    const opts = opciones([puntoControl('pc-denegado-3', 0)]);

    await anunciarDeteccionesDelTick(DB_FALSO, opts, {
      deteccionAproximacion: deteccion({
        puntoControlId: 'pc-denegado-3',
        fase: 'aproximacion',
        distanciaM: 90,
      }),
      anunciosLlegada: [{ puntoControlId: 'pc-denegado-3', pasada: 1, motivo: 'proximidad' }],
    });

    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(vibrateMock).toHaveBeenCalledTimes(1);
  });
});

describe('limpiarCanalesObsoletos', () => {
  const deleteChannelMock = Notifications.deleteNotificationChannelAsync as unknown as ReturnType<
    typeof vi.fn
  >;

  beforeEach(() => {
    deleteChannelMock.mockClear();
    deleteChannelMock.mockResolvedValue(undefined);
    (Platform as { OS: string }).OS = 'android';
  });

  it('en Android borra el canal -v1 obsoleto', () => {
    limpiarCanalesObsoletos();
    expect(deleteChannelMock).toHaveBeenCalledTimes(1);
    expect(deleteChannelMock).toHaveBeenCalledWith('quivo-anuncio-punto-control-v1');
  });

  it('en iOS no hace nada', () => {
    (Platform as { OS: string }).OS = 'ios';
    limpiarCanalesObsoletos();
    expect(deleteChannelMock).not.toHaveBeenCalled();
  });

  it('si el borrado rechaza: no propaga (fire-and-forget)', async () => {
    deleteChannelMock.mockRejectedValue(new Error('x'));
    expect(() => limpiarCanalesObsoletos()).not.toThrow();
    await Promise.resolve();
  });
});

describe('terminal anclado al COMENZAR RUTA (silencio)', () => {
  beforeEach(() => {
    limpiarSilenciosTerminal();
    speakMock.mockClear();
    configurarTablaAnunciosRealista();
  });

  it('un id silenciado no anuncia aproximación ni llegada; otro id no se afecta', async () => {
    silenciarTerminalAnclado('pc-term');
    const o = opciones([puntoControl('pc-term', 1), puntoControl('pc-2', 2)]);
    await anunciarPuntoControl(DB_FALSO, deteccion({ puntoControlId: 'pc-term', fase: 'aproximacion' }), o);
    expect(speakMock).not.toHaveBeenCalled();
    expect(await anunciarLlegadaPuntoControl(DB_FALSO, 'pc-term', 1, 'proximidad', o)).toBe(false);
    await anunciarPuntoControl(DB_FALSO, deteccion({ puntoControlId: 'pc-2', fase: 'aproximacion' }), o);
    expect(speakMock).toHaveBeenCalledTimes(1);
  });

  it('el silencio dura toda la visita y se libera al re-armar la voz (otros ids intactos)', async () => {
    silenciarTerminalAnclado('pc-term');
    const o = opciones([puntoControl('pc-term', 1)]);
    for (let i = 0; i < 3; i++) {
      expect(await anunciarLlegadaPuntoControl(DB_FALSO, 'pc-term', 1, 'proximidad', o)).toBe(false);
    }
    limpiarAproximacionesAnunciadas(['otro']);
    expect(terminalSilenciado('pc-term')).toBe(true);
    limpiarAproximacionesAnunciadas(['pc-term']);
    expect(terminalSilenciado('pc-term')).toBe(false);
    expect(await anunciarLlegadaPuntoControl(DB_FALSO, 'pc-term', 1, 'proximidad', o)).toBe(true);
  });
});

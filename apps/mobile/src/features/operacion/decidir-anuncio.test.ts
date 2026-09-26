import { describe, expect, it } from 'vitest';
import { RADIO_CONFIRMACION_M } from '@quivo/shared';
import { claveCumplimiento, type DeteccionPuntoControl, type EstadoPuntoControl } from '../../gps/geofence';
import {
  decidirAnuncio,
  evaluarAnuncioDeHeartbeat,
  evaluarAnunciosDeFixes,
  UMBRAL_ANUNCIO_PROXIMIDAD_MS,
  type EstadoAnuncioVisita,
} from './decidir-anuncio';

const FRESCO: EstadoAnuncioVisita = { anunciado: false, desdeMs: undefined };

describe('decidirAnuncio — tabla de verdad (función pura, sin I/O)', () => {
  it('proximidad: fix activa con distanciaM <= radioConfirmacionM', () => {
    const { motivo, estado } = decidirAnuncio(
      FRESCO,
      { tipo: 'fix', visita: 'activa', distanciaM: 35, radioConfirmacionM: RADIO_CONFIRMACION_M },
      1_000,
    );
    expect(motivo).toBe('proximidad');
    expect(estado).toEqual({ anunciado: true, desdeMs: 1_000 });
  });

  it('NO proximidad: fix activa con distanciaM > radioConfirmacionM (y sin vencer el timeout)', () => {
    const { motivo, estado } = decidirAnuncio(
      FRESCO,
      { tipo: 'fix', visita: 'activa', distanciaM: 100, radioConfirmacionM: RADIO_CONFIRMACION_M },
      1_000,
    );
    expect(motivo).toBeNull();
    expect(estado).toEqual({ anunciado: false, desdeMs: 1_000 });
  });

  it('fallback-tiempo a 90 s: fix activa, lejos del radio, pero ya pasó UMBRAL_ANUNCIO_PROXIMIDAD_MS desde la entrada', () => {
    const estadoEntrada: EstadoAnuncioVisita = { anunciado: false, desdeMs: 0 };
    const { motivo, estado } = decidirAnuncio(
      estadoEntrada,
      { tipo: 'fix', visita: 'activa', distanciaM: 100, radioConfirmacionM: RADIO_CONFIRMACION_M },
      UMBRAL_ANUNCIO_PROXIMIDAD_MS,
    );
    expect(motivo).toBe('fallback-tiempo');
    expect(estado.anunciado).toBe(true);
  });

  it('fallback-tiempo NO dispara un instante antes del umbral (89.9 s)', () => {
    const estadoEntrada: EstadoAnuncioVisita = { anunciado: false, desdeMs: 0 };
    const { motivo } = decidirAnuncio(
      estadoEntrada,
      { tipo: 'fix', visita: 'activa', distanciaM: 100, radioConfirmacionM: RADIO_CONFIRMACION_M },
      UMBRAL_ANUNCIO_PROXIMIDAD_MS - 100,
    );
    expect(motivo).toBeNull();
  });

  it('fallback-tiempo también dispara sobre un HEARTBEAT (sin fix nuevo)', () => {
    const estadoEntrada: EstadoAnuncioVisita = { anunciado: false, desdeMs: 0 };
    const { motivo } = decidirAnuncio(estadoEntrada, { tipo: 'heartbeat' }, UMBRAL_ANUNCIO_PROXIMIDAD_MS + 1);
    expect(motivo).toBe('fallback-tiempo');
  });

  it('un HEARTBEAT nunca decide "proximidad" (no trae distancia real)', () => {
    const { motivo } = decidirAnuncio(FRESCO, { tipo: 'heartbeat' }, 1_000);
    expect(motivo).toBeNull();
  });

  it('fallback-salida: fix "saliendo" (re-armado real) sin haber anunciado nunca', () => {
    const { motivo, estado } = decidirAnuncio(
      FRESCO,
      { tipo: 'fix', visita: 'saliendo', distanciaM: 999, radioConfirmacionM: RADIO_CONFIRMACION_M },
      1_000,
    );
    expect(motivo).toBe('fallback-salida');
    expect(estado.anunciado).toBe(true);
  });

  it('ya anunciado: `motivo: null` sin importar la entrada, y el estado no cambia', () => {
    const yaAnunciado: EstadoAnuncioVisita = { anunciado: true, desdeMs: 500 };
    const resultadoFix = decidirAnuncio(
      yaAnunciado,
      { tipo: 'fix', visita: 'activa', distanciaM: 1, radioConfirmacionM: RADIO_CONFIRMACION_M },
      99_999,
    );
    const resultadoSaliendo = decidirAnuncio(
      yaAnunciado,
      { tipo: 'fix', visita: 'saliendo', distanciaM: 999, radioConfirmacionM: RADIO_CONFIRMACION_M },
      99_999,
    );
    const resultadoHeartbeat = decidirAnuncio(yaAnunciado, { tipo: 'heartbeat' }, 99_999);

    expect(resultadoFix).toEqual({ motivo: null, estado: yaAnunciado });
    expect(resultadoSaliendo).toEqual({ motivo: null, estado: yaAnunciado });
    expect(resultadoHeartbeat).toEqual({ motivo: null, estado: yaAnunciado });
  });

  it('nueva pasada: un estadoAnuncio fresco ({anunciado:false, desdeMs:undefined}) vuelve a poder decidir', () => {
    // El caller (evaluarAnunciosDeFixes, vía geofence.ts) resetea el estado en cada ENTRADA —
    // acá solo se verifica que un estado fresco se comporta como "nunca anunciado", sin
    // arrastrar nada de una visita/pasada anterior.
    const { motivo } = decidirAnuncio(
      FRESCO,
      { tipo: 'fix', visita: 'activa', distanciaM: 10, radioConfirmacionM: RADIO_CONFIRMACION_M },
      50_000,
    );
    expect(motivo).toBe('proximidad');
  });

  it('desdeMs ausente se trata como "recién entrando ahora" (nunca revienta, nunca dispara el fallback de inmediato)', () => {
    const { motivo, estado } = decidirAnuncio(
      { anunciado: false, desdeMs: undefined },
      { tipo: 'fix', visita: 'activa', distanciaM: 999, radioConfirmacionM: RADIO_CONFIRMACION_M },
      5_000,
    );
    expect(motivo).toBeNull();
    expect(estado.desdeMs).toBe(5_000);
  });
});

function estadoVisitaActiva(overrides: Partial<EstadoPuntoControl> = {}): EstadoPuntoControl {
  return {
    dentro: true,
    ultimoEmitidoMs: -Infinity,
    pasadas: 0,
    confirmado: false,
    puntoControlId: 'pc-1',
    radioToleranciaM: 150,
    anuncioHecho: false,
    anuncioDesdeMs: 0,
    ...overrides,
  };
}

function deteccionCruda(distanciaM: number, puntoControlId = 'pc-1'): DeteccionPuntoControl {
  return { puntoControlId, distanciaM, cumplido: distanciaM <= 150, radioToleranciaM: 150 };
}

describe('evaluarAnunciosDeFixes — LA EVIDENCIA NUNCA DISPARA (gap 1/2 del brief)', () => {
  it('la evidencia confirma (mínimo local, distancia crece) lejos de RADIO_CONFIRMACION_M y sin re-armar: NO decide ningún anuncio', () => {
    // Simula el tick donde `filtrarNuevosCumplimientos` acaba de CONFIRMAR la evidencia
    // (`confirmado: true`, `dentro` sigue en `true` — el re-armado es un tick aparte, más
    // adelante) con el fix ACTUAL a 90 m — lejos de RADIO_CONFIRMACION_M (40) y del umbral de
    // tiempo (recién entrando, `anuncioDesdeMs` == `tsFixMs`). La evidencia, por sí sola, no
    // debe producir NINGUNA decisión de anuncio.
    const sesionId = 'sesion-evidencia';
    const clave = claveCumplimiento(sesionId, 'pc-1');
    const estadosAntes = new Map<string, EstadoPuntoControl>([[clave, estadoVisitaActiva({ confirmado: false })]]);
    const transicionesEstado = new Map<string, EstadoPuntoControl>([
      [
        clave,
        estadoVisitaActiva({
          confirmado: true, // LA EVIDENCIA YA CONFIRMÓ este mismo tick
          anuncioHecho: false,
          anuncioDesdeMs: 1_000,
        }),
      ],
    ]);

    const { anuncios } = evaluarAnunciosDeFixes(
      estadosAntes,
      transicionesEstado,
      [deteccionCruda(90)],
      [], // sin re-armar todavía
      sesionId,
      1_000,
    );

    expect(anuncios).toEqual([]);
  });

  it('anunciarDeteccionesDelTick / anunciarLlegadaPuntoControl no reciben ningún campo de evidencia (garantía de tipos): la firma de resultado no acepta `deteccion`/`fase`', () => {
    // Documenta, a nivel de tipos, que ya no existe ningún camino para que un caller le pase
    // evidencia (`DeteccionPuntoControl` con `fase: 'confirmado'`) a la ejecución del anuncio de
    // llegada — el rediseño lo hace estructuralmente imposible, no solo "por convención".
    type ResultadoAnuncioLlegada = { puntoControlId: string; pasada: number; motivo: string };
    const anuncio: ResultadoAnuncioLlegada = { puntoControlId: 'pc-1', pasada: 1, motivo: 'proximidad' };
    expect(anuncio).not.toHaveProperty('fase');
    expect(anuncio).not.toHaveProperty('deteccion');
  });
});

describe('evaluarAnunciosDeFixes — orquestador (único punto de llamada, fixes)', () => {
  it('visita recién ENTRANDO (no en estadosAntes) con distancia <= radio: decide "proximidad" de inmediato', () => {
    const sesionId = 'sesion-1';
    const clave = claveCumplimiento(sesionId, 'pc-1');
    const estadosAntes = new Map<string, EstadoPuntoControl>();
    const transicionesEstado = new Map<string, EstadoPuntoControl>([
      [clave, estadoVisitaActiva({ pasadas: 0 })],
    ]);

    const { anuncios, transiciones } = evaluarAnunciosDeFixes(
      estadosAntes,
      transicionesEstado,
      [deteccionCruda(20)],
      [],
      sesionId,
      1_000,
    );

    expect(anuncios).toEqual([
      { motivo: 'proximidad', puntoControlId: 'pc-1', pasada: 1, distanciaM: 20, radioToleranciaM: 150 },
    ]);
    expect(transiciones.get(clave)?.anuncioHecho).toBe(true);
  });

  it('visita ya anunciada (anuncioHecho: true) — no vuelve a decidir nada', () => {
    const sesionId = 'sesion-1';
    const clave = claveCumplimiento(sesionId, 'pc-1');
    const estadosAntes = new Map<string, EstadoPuntoControl>([[clave, estadoVisitaActiva({ anuncioHecho: true })]]);
    const transicionesEstado = new Map<string, EstadoPuntoControl>([
      [clave, estadoVisitaActiva({ anuncioHecho: true })],
    ]);

    const { anuncios, transiciones } = evaluarAnunciosDeFixes(
      estadosAntes,
      transicionesEstado,
      [deteccionCruda(5)],
      [],
      sesionId,
      1_000,
    );

    expect(anuncios).toEqual([]);
    expect(transiciones.size).toBe(0);
  });

  it('fallback-salida: puntosRearmados incluye el punto y la visita estaba activa antes — decide sin importar la distancia actual', () => {
    const sesionId = 'sesion-1';
    const clave = claveCumplimiento(sesionId, 'pc-1');
    const estadosAntes = new Map<string, EstadoPuntoControl>([[clave, estadoVisitaActiva()]]);
    const transicionesEstado = new Map<string, EstadoPuntoControl>([
      [clave, estadoVisitaActiva({ dentro: false, confirmado: true, pasadas: 1 })],
    ]);

    const { anuncios } = evaluarAnunciosDeFixes(
      estadosAntes,
      transicionesEstado,
      [deteccionCruda(999)],
      ['pc-1'],
      sesionId,
      1_000,
    );

    expect(anuncios).toEqual([
      { motivo: 'fallback-salida', puntoControlId: 'pc-1', pasada: 1, distanciaM: 999, radioToleranciaM: 150 },
    ]);
  });

  it('sin visita relevante (ni activa ni saliendo): no decide nada', () => {
    const sesionId = 'sesion-1';
    const clave = claveCumplimiento(sesionId, 'pc-1');
    const transicionesEstado = new Map<string, EstadoPuntoControl>([
      [clave, { dentro: false, ultimoEmitidoMs: -Infinity, pasadas: 0 }],
    ]);

    const { anuncios } = evaluarAnunciosDeFixes(
      new Map(),
      transicionesEstado,
      [deteccionCruda(500)],
      [],
      sesionId,
      1_000,
    );

    expect(anuncios).toEqual([]);
  });

  /** FIX POST-REVISIÓN (hallazgo 2, code review — EL MÁS IMPORTANTE del lote: "la evidencia
   * re-sembrada dispara fallback-salida"). Reproduce el escenario real end-to-end: una visita
   * SEMBRADA desde el outbox (`clavesCumplimientoDesdePayloads`, `location-task.ts` — mismo shape
   * que esa función produce tras el fix del hallazgo 2: `dentro: true`, `confirmado: true`,
   * `anuncioHecho: true`) que luego se re-arma (el vehículo vuelve a pasar por al lado y se aleja
   * de nuevo) NUNCA debe decidir un anuncio — la invariante ("la evidencia nunca dispara un
   * anuncio") tiene que sobrevivir un reinicio del proceso, no solo la vida de un Map en memoria
   * que nunca se reconstruyó. */
  it('visita SEMBRADA desde evidencia (anuncioHecho: true, como siembra clavesCumplimientoDesdePayloads) que se re-arma: NO dispara fallback-salida', () => {
    const sesionId = 'sesion-resembrada';
    const clave = claveCumplimiento(sesionId, 'pc-1');
    const estadoSembrado = estadoVisitaActiva({
      confirmado: true,
      anuncioHecho: true, // ver el fix de `clavesCumplimientoDesdePayloads`
      anuncioDesdeMs: undefined,
    });
    const estadosAntes = new Map<string, EstadoPuntoControl>([[clave, estadoSembrado]]);
    const transicionesEstado = new Map<string, EstadoPuntoControl>([
      [clave, { ...estadoSembrado, dentro: false, pasadas: 1 }], // el fix de este tick re-arma (sale del radio)
    ]);

    const { anuncios } = evaluarAnunciosDeFixes(
      estadosAntes,
      transicionesEstado,
      [deteccionCruda(999)],
      ['pc-1'], // re-armó de verdad este tick
      sesionId,
      1_000,
    );

    expect(anuncios).toEqual([]);
  });

  it('fix sin transición este tick (descartado por A3): se ignora sin reventar', () => {
    const { anuncios, transiciones } = evaluarAnunciosDeFixes(
      new Map(),
      new Map(),
      [deteccionCruda(20)],
      [],
      'sesion-1',
      1_000,
    );
    expect(anuncios).toEqual([]);
    expect(transiciones.size).toBe(0);
  });
});

describe('evaluarAnuncioDeHeartbeat — orquestador (único punto de llamada, heartbeats)', () => {
  it('visita activa sin anunciar, vencido el umbral: fallback-tiempo', () => {
    const clave = claveCumplimiento('sesion-1', 'pc-1');
    const estados = new Map<string, EstadoPuntoControl>([
      [clave, estadoVisitaActiva({ anuncioDesdeMs: 0, minDistanciaM: 90 })],
    ]);

    const { anuncios, transiciones } = evaluarAnuncioDeHeartbeat(estados, UMBRAL_ANUNCIO_PROXIMIDAD_MS + 1);

    expect(anuncios).toEqual([
      { motivo: 'fallback-tiempo', puntoControlId: 'pc-1', pasada: 1, distanciaM: 90, radioToleranciaM: 150 },
    ]);
    expect(transiciones.get(clave)?.anuncioHecho).toBe(true);
  });

  it('vehículo detenido dentro del radio de detección — un heartbeat ANTES del umbral NO decide nada todavía', () => {
    const clave = claveCumplimiento('sesion-1', 'pc-1');
    const estados = new Map<string, EstadoPuntoControl>([[clave, estadoVisitaActiva({ anuncioDesdeMs: 0 })]]);

    const { anuncios } = evaluarAnuncioDeHeartbeat(estados, UMBRAL_ANUNCIO_PROXIMIDAD_MS - 100);
    expect(anuncios).toEqual([]);
  });

  /** FIX POST-REVISIÓN (hallazgo 4, code review — "con motivo null, desdeMs no se persiste: un
   * vehículo detenido que solo manda heartbeats nunca dispara fallback-tiempo"). Antes de este
   * fix, un heartbeat que NO disparaba (motivo null) saltaba el `transiciones.set` — la semilla de
   * `desdeMs` que `decidirAnuncio` acababa de calcular se perdía, y el PRÓXIMO heartbeat volvía a
   * sembrarla con SU PROPIO `ahoraMs` (nunca hereda el `desdeMs` real de la entrada a la visita).
   * Resultado real: un vehículo detenido que solo manda heartbeats (nunca un fix real, que sí
   * persiste vía `evaluarAnunciosDeFixes`) NUNCA llegaba a vencer el umbral de 90 s — el reloj se
   * reiniciaba en cada heartbeat. */
  it('la semilla de desdeMs SOBREVIVE un heartbeat que no dispara — el SEGUNDO heartbeat sí vence el fallback de tiempo', () => {
    const clave = claveCumplimiento('sesion-1', 'pc-1');
    const estados = new Map<string, EstadoPuntoControl>([
      [clave, estadoVisitaActiva({ anuncioDesdeMs: undefined })],
    ]);

    // Heartbeat 1: todavía lejos del umbral — no dispara, pero DEBE persistir la semilla de
    // desdeMs (10_000, el instante de este primer heartbeat/entrada).
    const r1 = evaluarAnuncioDeHeartbeat(estados, 10_000);
    expect(r1.anuncios).toEqual([]);
    expect(r1.transiciones.get(clave)?.anuncioDesdeMs).toBe(10_000);

    // El caller real (`confirmarVisitasVencidasEnCola`, `gps/headless-task.ts`) SIEMPRE aplica la
    // transición devuelta a `estados` (memoria) — ver su loop.
    for (const [k, e] of r1.transiciones) estados.set(k, e);

    // Heartbeat 2, a más de UMBRAL_ANUNCIO_PROXIMIDAD_MS del PRIMER heartbeat (no del segundo):
    // con el fix, dispara `fallback-tiempo`. Con el bug, `desdeMs` se habría re-sembrado a este
    // mismo `ahoraMs` en el heartbeat 1 (perdido), y la resta acá daría 0 — nunca dispara.
    const r2 = evaluarAnuncioDeHeartbeat(estados, 10_000 + UMBRAL_ANUNCIO_PROXIMIDAD_MS + 1);
    expect(r2.anuncios).toEqual([
      { motivo: 'fallback-tiempo', puntoControlId: 'pc-1', pasada: 1, distanciaM: 150, radioToleranciaM: 150 },
    ]);
  });

  it('visita ya anunciada: no decide de nuevo', () => {
    const clave = claveCumplimiento('sesion-1', 'pc-1');
    const estados = new Map<string, EstadoPuntoControl>([
      [clave, estadoVisitaActiva({ anuncioHecho: true, anuncioDesdeMs: 0 })],
    ]);

    const { anuncios } = evaluarAnuncioDeHeartbeat(estados, UMBRAL_ANUNCIO_PROXIMIDAD_MS + 1);
    expect(anuncios).toEqual([]);
  });

  it('visita no activa (dentro: false): ignorada', () => {
    const clave = claveCumplimiento('sesion-1', 'pc-1');
    const estados = new Map<string, EstadoPuntoControl>([
      [clave, estadoVisitaActiva({ dentro: false, anuncioDesdeMs: 0 })],
    ]);

    const { anuncios } = evaluarAnuncioDeHeartbeat(estados, UMBRAL_ANUNCIO_PROXIMIDAD_MS + 1);
    expect(anuncios).toEqual([]);
  });

  it('nunca decide "proximidad" (un heartbeat no trae fix nuevo)', () => {
    const clave = claveCumplimiento('sesion-1', 'pc-1');
    const estados = new Map<string, EstadoPuntoControl>([
      [clave, estadoVisitaActiva({ anuncioDesdeMs: 0, minDistanciaM: 5 })],
    ]);

    const { anuncios } = evaluarAnuncioDeHeartbeat(estados, UMBRAL_ANUNCIO_PROXIMIDAD_MS - 100);
    expect(anuncios).toEqual([]); // ni siquiera con minDistanciaM=5: solo decide por TIEMPO
  });

  /** FIX POST-REVISIÓN (code review — "Finalizar puede dejar un 'llegaste' sin anunciar"):
   * `detener()` (`use-gps-operativo.ts`) llama a `confirmarVisitasVencidasEnCola` con
   * `umbralAnuncioMs: 0` explícito — "ante la duda, emitir", mismo criterio que `umbralMs: 0`
   * de la confirmación de evidencia (`umbralMs` propiamente dicho, el 6° argumento). Antes del
   * fix faltaba el 9° argumento, así que caía al default (`UMBRAL_ANUNCIO_PROXIMIDAD_MS`,
   * 90 s): una visita hecha MENOS de 90 s antes de apretar "Finalizar" se confirmaba como
   * evidencia (por el `umbralMs: 0` de la confirmación) pero JAMÁS se anunciaba — el chofer se
   * quedaba sin la vibración/notificación de "llegaste" del último punto de su recorrido. */
  it('umbral 0 (el que detener() pasa al cerrar el recorrido) anuncia una visita recién entrada, sin esperar el umbral de tiempo', () => {
    const clave = claveCumplimiento('sesion-1', 'pc-1');
    const estados = new Map<string, EstadoPuntoControl>([
      [clave, estadoVisitaActiva({ anuncioDesdeMs: 0, minDistanciaM: 90 })],
    ]);

    // Con el default (90 s) esta MISMA visita, a solo 1 s de haber entrado, todavía no dispara.
    const conUmbralDefault = evaluarAnuncioDeHeartbeat(estados, 1_000);
    expect(conUmbralDefault.anuncios).toEqual([]);

    // Con umbral 0 (el que ahora pasa `detener()`), dispara de inmediato.
    const conUmbralCero = evaluarAnuncioDeHeartbeat(estados, 1_000, 0);
    expect(conUmbralCero.anuncios).toEqual([
      { motivo: 'fallback-tiempo', puntoControlId: 'pc-1', pasada: 1, distanciaM: 90, radioToleranciaM: 150 },
    ]);
  });
});

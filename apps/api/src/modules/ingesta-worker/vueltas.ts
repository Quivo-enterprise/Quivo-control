import { randomUUID } from 'node:crypto';
import {
  ESPERA_MAX_ACCURACY_M,
  ESPERA_SALIDA_MARGEN_M,
  ESPERA_SALIDA_PUNTOS_CONSECUTIVOS,
  type EstadoVuelta,
  type RolPuntoControl,
} from '@quivo/shared';
import {
  VENTANA_RECORRIDO_TOLERANCIA_MS,
  dedupeKeyEsperaCorta,
  dedupeKeyMolinosOmitido,
} from './infracciones.logic.js';

/**
 * Máquina PURA de vueltas (docs/plan-molinos-designacion.md, F1). No toca la base: el worker
 * (`deteccion-vueltas.ts`) carga la última vuelta de la sesión, le pasa los eventos nuevos del
 * lote ya ordenados/filtrados y aplica los cambios + infracciones resultantes.
 *
 * Reglas:
 * - La PRIMERA vuelta de la sesión se abre con lo que llegue primero: cumplimiento de un PC
 *   `terminal` o `inicio_recorrido`. Después de un `fin_recorrido` solo un `inicio_recorrido`
 *   abre una vuelta nueva (el GPS sigue pasando por la terminal con el recorrido terminado).
 * - Un cumplimiento `retorno` marca `pasoRetornoTs` en la vuelta en curso (el primero gana).
 * - Un cumplimiento `terminal` CON `pasoRetornoTs` cierra la vuelta `completa` y abre la
 *   siguiente con el mismo `ts` (siempre hay una en curso). SIN `pasoRetornoTs` no hace nada:
 *   SR → SR sin pasar por Honduras no cuenta vuelta.
 * - `fin_recorrido` deja la vuelta en curso `abierta_al_cierre`, salvo que esté VACÍA (ver abajo):
 *   entonces se ELIMINA. Como `fin_recorrido` usa el
 *   reloj del sistema y el cumplimiento el del GNSS, un `terminal` que llega hasta
 *   `VENTANA_RECORRIDO_TOLERANCIA_MS` (120 s, la misma tolerancia de `pc_omitido`) DESPUÉS de
 *   ese fin todavía cierra la vuelta `completa` (sin abrir otra: el recorrido terminó).
 * - Un `inicio_recorrido` con la vuelta en curso SIN `pasoRetornoTs` no hace nada (es el mismo
 *   recorrido, el chofer esperó en la terminal); con `pasoRetornoTs` es un recorrido nuevo: la
 *   vuelta en curso queda `abierta_al_cierre` y se abre otra.
 * - Espera: la llegada es el cumplimiento del PC de espera de la variante DESIGNADA mientras la
 *   vuelta designada está en curso. Una designada que cierra en la terminal sin llegada genera
 *   `molinos_omitido`. La salida la resuelve `resolverEspera` con los fixes GPS (stateless).
 *
 * Vuelta vacía: la que abrió la terminal (o un `inicio_recorrido`) y todavía no registró ningún PC
 * después (`pasoRetornoTs` y `ultimoPcTs` nulos) ni está designada. Al terminar el recorrido el
 * cumplimiento de SR cierra la vuelta N y abre la N+1; el `fin_recorrido` que sigue (o un
 * `inicio_recorrido` nuevo) la dejaría como una fila basura por recorrido, así que se ELIMINA en
 * vez de cerrarla. Nunca se elimina una designada. Como lo eliminado es siempre la ÚLTIMA vuelta,
 * la numeración del día queda sin huecos: la siguiente que se abra reutiliza ese número.
 * (El mismo criterio vive en el trigger `vueltas_cerrar_con_sesion` para el cierre de sesión.)
 *
 * Eventos fuera de orden / tardíos (outbox móvil): NO hay un watermark global. Cada evento se
 * evalúa contra la vuelta actual y uno anterior al inicio de esa vuelta (o que ya no aplica a su
 * estado) se ignora — no mueve la máquina hacia atrás, igual que `desvio.ts`. Dentro de un lote
 * el orden es por `ts`, así que lo que llega junto se ve consistente. Limitación documentada:
 * un cumplimiento tardío que llega DESPUÉS de que la vuelta ya cerró no se aplica (p. ej. el de
 * Molinos tras el cierre en SR deja un `molinos_omitido` abierto para descarte manual), y si se
 * pierde el cumplimiento de SR por un hueco de GPS dos vueltas se fusionan.
 */

/** Vuelta tal como la ve la máquina (columnas de `vueltas` + el PC de espera de su variante). */
export interface FilaVuelta {
  id: string;
  numero: number;
  inicioTs: Date;
  finTs: Date | null;
  estado: EstadoVuelta;
  pasoRetornoTs: Date | null;
  varianteId: string | null;
  /** `variantes.puntoEsperaId` de la variante designada (no se persiste en `vueltas`). */
  puntoEsperaId: string | null;
  esperaLlegadaTs: Date | null;
  esperaSalidaTs: Date | null;
  /** Último cumplimiento de un PC distinto de la terminal (retorno, espera o común) en la vuelta. */
  ultimoPcTs: Date | null;
}

/** Vuelta vacía: sin PC tras abrirse y sin designación (candidata a eliminarse al cerrar). */
export function esVueltaVacia(
  fila: Pick<FilaVuelta, 'pasoRetornoTs' | 'ultimoPcTs' | 'varianteId' | 'esperaLlegadaTs'>,
): boolean {
  return (
    fila.varianteId === null &&
    fila.pasoRetornoTs === null &&
    fila.ultimoPcTs === null &&
    fila.esperaLlegadaTs === null
  );
}

export type EventoVuelta =
  | { clase: 'inicio'; ts: Date }
  | { clase: 'fin'; ts: Date }
  | {
      clase: 'cumplimiento';
      ts: Date;
      puntoControlId: string;
      /** `puntos_control.rol` del PC; `null` = punto común (no mueve las vueltas). */
      rol: RolPuntoControl | null;
      lat: number;
      lng: number;
    };

export interface CambioVuelta {
  fila: FilaVuelta;
  /** `true` si la fila no existía antes de este avance (hay que insertarla). */
  nueva: boolean;
  /** `true` si la vuelta (vacía) se elimina en vez de cerrarse; si además es `nueva`, no se inserta. */
  eliminada?: boolean;
}

export interface InfraccionVuelta {
  tipo: 'molinos_omitido' | 'espera_corta';
  vueltaId: string;
  inicioTs: Date;
  /** `null` = la máquina no tiene posición (cierre por evento sin coordenadas): la resuelve el worker. */
  lat: number | null;
  lng: number | null;
  detalle: Record<string, unknown>;
  dedupeKey: string;
}

export interface ResultadoVueltas {
  cambios: CambioVuelta[];
  infracciones: InfraccionVuelta[];
}

/** A igual `ts`: el inicio abre antes que cualquier cumplimiento, y el fin va después. */
const PRIORIDAD_CLASE = { inicio: 0, cumplimiento: 1, fin: 2 } as const;

export function avanzarVueltas(
  ultima: FilaVuelta | null,
  eventos: readonly EventoVuelta[],
  opciones: { nuevoId?: () => string } = {},
): ResultadoVueltas {
  const nuevoId = opciones.nuevoId ?? randomUUID;
  const cambios = new Map<string, CambioVuelta>();
  const infracciones: InfraccionVuelta[] = [];
  let actual: FilaVuelta | null = ultima ? { ...ultima } : null;
  // Número de la última vuelta que existe (se retrocede al eliminar una vacía: sin huecos).
  let ultimoNumero = ultima?.numero ?? 0;

  const marcar = (fila: FilaVuelta, nueva = false, eliminada = false) => {
    cambios.set(fila.id, { fila, nueva: cambios.get(fila.id)?.nueva ?? nueva, eliminada });
  };
  const abrir = (ts: Date) => {
    const fila: FilaVuelta = {
      id: nuevoId(),
      numero: ultimoNumero + 1,
      inicioTs: ts,
      finTs: null,
      estado: 'en_curso',
      pasoRetornoTs: null,
      varianteId: null,
      puntoEsperaId: null,
      esperaLlegadaTs: null,
      esperaSalidaTs: null,
      ultimoPcTs: null,
    };
    ultimoNumero = fila.numero;
    actual = fila;
    marcar(fila, true);
  };
  // Designada a Molinos que termina SIN haber pasado por el punto de espera.
  const molinosOmitido = (fila: FilaVuelta, ts: Date, lat: number | null, lng: number | null) => {
    if (fila.varianteId === null || fila.esperaLlegadaTs !== null) return;
    infracciones.push({
      tipo: 'molinos_omitido',
      vueltaId: fila.id,
      inicioTs: ts,
      lat,
      lng,
      detalle: { vueltaId: fila.id, numero: fila.numero, varianteId: fila.varianteId },
      dedupeKey: dedupeKeyMolinosOmitido(fila.id),
    });
  };
  const cerrarCompleta = (fila: FilaVuelta, ts: Date, lat: number, lng: number) => {
    fila.estado = 'completa';
    fila.finTs = ts;
    marcar(fila);
    molinosOmitido(fila, ts, lat, lng);
  };
  const cerrarAbierta = (fila: FilaVuelta, ts: Date) => {
    fila.finTs = ts;
    if (esVueltaVacia(fila)) {
      // Vacía: se elimina (es la última vuelta, la numeración no deja hueco). `fila` queda como
      // marca de "recorrido terminado" para los eventos siguientes del lote.
      fila.estado = 'abierta_al_cierre';
      marcar(fila, false, true);
      if (fila.numero === ultimoNumero) ultimoNumero -= 1;
      return;
    }
    fila.estado = 'abierta_al_cierre';
    marcar(fila);
    // Se emite sin posición: el worker la toma del último fix GPS de la sesión.
    molinosOmitido(fila, ts, null, null);
  };

  const ordenados = [...eventos].sort(
    (a, b) => a.ts.getTime() - b.ts.getTime() || PRIORIDAD_CLASE[a.clase] - PRIORIDAD_CLASE[b.clase],
  );

  for (const ev of ordenados) {
    const t = ev.ts.getTime();
    if (ev.clase === 'inicio') {
      if (!actual) {
        abrir(ev.ts);
      } else if (actual.estado === 'en_curso') {
        if (actual.pasoRetornoTs && t > actual.pasoRetornoTs.getTime()) {
          cerrarAbierta(actual, ev.ts);
          abrir(ev.ts);
        }
      } else if (t > (actual.finTs ?? actual.inicioTs).getTime()) {
        abrir(ev.ts);
      }
      continue;
    }

    if (ev.clase === 'fin') {
      if (
        actual?.estado === 'en_curso' &&
        t >= actual.inicioTs.getTime() - VENTANA_RECORRIDO_TOLERANCIA_MS
      ) {
        cerrarAbierta(actual, ev.ts);
      }
      continue;
    }

    // cumplimiento
    if (ev.rol === 'terminal') {
      if (!actual) {
        abrir(ev.ts);
      } else if (actual.estado === 'en_curso') {
        if (actual.pasoRetornoTs && t >= actual.pasoRetornoTs.getTime()) {
          cerrarCompleta(actual, ev.ts, ev.lat, ev.lng);
          abrir(ev.ts);
        }
      } else if (
        actual.estado === 'abierta_al_cierre' &&
        actual.pasoRetornoTs &&
        t >= actual.pasoRetornoTs.getTime() &&
        t <= (actual.finTs ?? actual.inicioTs).getTime() + VENTANA_RECORRIDO_TOLERANCIA_MS
      ) {
        cerrarCompleta(actual, ev.ts, ev.lat, ev.lng);
      }
    } else if (ev.rol === 'retorno') {
      if (actual?.estado === 'en_curso' && !actual.pasoRetornoTs && t >= actual.inicioTs.getTime()) {
        actual.pasoRetornoTs = ev.ts;
        actual.ultimoPcTs = ev.ts;
        marcar(actual);
      }
    } else if (ev.rol === 'espera') {
      if (
        actual?.estado === 'en_curso' &&
        actual.varianteId !== null &&
        actual.esperaLlegadaTs === null &&
        t >= actual.inicioTs.getTime() &&
        (actual.puntoEsperaId === null || actual.puntoEsperaId === ev.puntoControlId)
      ) {
        actual.esperaLlegadaTs = ev.ts;
        actual.ultimoPcTs = ev.ts;
        marcar(actual);
      }
    } else if (ev.rol === null) {
      // Punto común: no mueve la máquina, pero la vuelta deja de estar vacía.
      if (actual?.estado === 'en_curso' && t >= actual.inicioTs.getTime()) {
        actual.ultimoPcTs = ev.ts;
        marcar(actual);
      }
    }
  }

  return { cambios: [...cambios.values()], infracciones };
}

/** Fix GPS con su distancia al punto de espera (la calcula PostGIS en el worker). */
export interface FixEspera {
  ts: Date;
  lat: number;
  lng: number;
  accuracy: number | null;
  distanciaM: number;
}

/**
 * Salida del punto de espera: el PRIMERO de `ESPERA_SALIDA_PUNTOS_CONSECUTIVOS` (2) fixes
 * consecutivos, posteriores a la llegada, con `accuracy <= ESPERA_MAX_ACCURACY_M` (accuracy nula
 * se acepta, como en el desvío) a más de `radioM + ESPERA_SALIDA_MARGEN_M`. Los fixes imprecisos
 * se descartan antes de contar (no cortan ni suman la racha). Pura y sin estado: el worker la
 * corre sobre los fixes de `gps_points` desde la llegada, así no importa en qué lote cayó cada
 * punto ni su orden de llegada. `hastaTs` acota por arriba (cierre de la vuelta).
 */
export function detectarSalidaEspera(
  llegadaTs: Date,
  fixes: readonly FixEspera[],
  radioM: number,
  hastaTs: Date | null = null,
): { ts: Date; lat: number; lng: number } | null {
  const umbral = radioM + ESPERA_SALIDA_MARGEN_M;
  const validos = fixes
    .filter(
      (f) =>
        f.ts.getTime() > llegadaTs.getTime() &&
        (hastaTs === null || f.ts.getTime() <= hastaTs.getTime()) &&
        (f.accuracy === null || f.accuracy <= ESPERA_MAX_ACCURACY_M) &&
        Number.isFinite(f.distanciaM),
    )
    .sort((a, b) => a.ts.getTime() - b.ts.getTime());
  let primero: FixEspera | null = null;
  let racha = 0;
  for (const f of validos) {
    if (f.distanciaM > umbral) {
      if (racha === 0) primero = f;
      racha += 1;
      if (racha >= ESPERA_SALIDA_PUNTOS_CONSECUTIVOS && primero) {
        return { ts: primero.ts, lat: primero.lat, lng: primero.lng };
      }
    } else {
      racha = 0;
      primero = null;
    }
  }
  return null;
}

/**
 * Cierra la espera de una vuelta designada: si hay salida confirmada devuelve su `ts` y, si
 * esperó menos de `esperaMin`, la infracción `espera_corta` (`detalle {esperaMin, requeridoMin}`:
 * lo esperado en minutos enteros hacia abajo y lo exigido). `null` si no aplica o todavía no
 * salió. Sin salida confirmada (hueco de GPS) NO se genera alerta: no hay evidencia.
 */
export function resolverEspera(
  vuelta: Pick<FilaVuelta, 'id' | 'varianteId' | 'esperaLlegadaTs' | 'esperaSalidaTs'>,
  fixes: readonly FixEspera[],
  params: { radioM: number; esperaMin: number; hastaTs?: Date | null },
): { esperaSalidaTs: Date; infraccion: InfraccionVuelta | null } | null {
  if (vuelta.varianteId === null || vuelta.esperaLlegadaTs === null || vuelta.esperaSalidaTs !== null) {
    return null;
  }
  const salida = detectarSalidaEspera(vuelta.esperaLlegadaTs, fixes, params.radioM, params.hastaTs ?? null);
  if (!salida) return null;
  const esperadoMs = salida.ts.getTime() - vuelta.esperaLlegadaTs.getTime();
  const infraccion: InfraccionVuelta | null =
    esperadoMs < params.esperaMin * 60_000
      ? {
          tipo: 'espera_corta',
          vueltaId: vuelta.id,
          inicioTs: salida.ts,
          lat: salida.lat,
          lng: salida.lng,
          detalle: {
            esperaMin: Math.floor(esperadoMs / 60_000),
            requeridoMin: params.esperaMin,
            vueltaId: vuelta.id,
          },
          dedupeKey: dedupeKeyEsperaCorta(vuelta.id),
        }
      : null;
  return { esperaSalidaTs: salida.ts, infraccion };
}

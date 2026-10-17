import { distanciaMetros } from '@quivo/shared';
import { ESTADO_RUMBO_INICIAL, seleccionarRumbo, type EstadoRumbo } from './rumbo';
import type { FixVisual } from './tipos';

/**
 * Estado visual completo que alimenta el mapa: posición mostrada (después del anti-jitter),
 * rumbo, velocidad/precisión del último fix aplicado y su timestamp — más el estado interno de
 * histéresis de rumbo (`estadoRumbo`), que viaja acá adentro para que este reducer sea la única
 * fuente de verdad; nada fuera de este módulo necesita tocar `EstadoRumbo` directamente (el
 * store público, `store-visual.ts`, expone un tipo `EstadoVisual` más chico sin este campo).
 */
export interface EstadoVisualMovimiento {
  lat: number;
  lng: number;
  /** Grados `[0,360)`, o `null` mientras no hubo ningún rumbo válido todavía. */
  rumbo: number | null;
  /** Metros. Precisión del último fix aplicado — radio del halo de precisión (Fase C). */
  accuracy: number;
  /** m/s del último fix aplicado, tal cual llegó (`-1` si el fix no traía velocidad real). */
  speed: number;
  /** Epoch ms del último fix aplicado — insumo de `estaObsoleto` (`geo.ts`) y de
   * `duracionAnimacionMs` entre este fix y el siguiente. */
  ts: number;
  estadoRumbo: EstadoRumbo;
}

/** m/s — junto con un desplazamiento menor a la precisión reportada, el movimiento se trata
 * como ruido del GPS y la posición mostrada no se mueve (anti-jitter, Fase B). Con `speed`
 * desconocida (`-1`) NO se activa el anti-jitter: sin dato de velocidad no hay base para asumir
 * que el vehículo está casi detenido, así que la posición se actualiza como si no hubiera
 * jitter (mismo criterio conservador que `seleccionarRumbo` con `speed` desconocida). */
const VELOCIDAD_ANTIJITTER_MPS = 0.5;

/**
 * Reducer puro `(estado, fix) => estado` del estado visual completo — compone `seleccionarRumbo`
 * (rumbo, con su propia histéresis) con el anti-jitter de posición: con velocidad baja y
 * desplazamiento menor a la precisión del fix, la posición mostrada no cambia (rumbo/accuracy/
 * speed/ts sí se actualizan igual, para que el halo de precisión y el chequeo de staleness
 * reflejen el fix más reciente aunque el marcador no se haya movido).
 */
export function aplicarFix(
  estado: EstadoVisualMovimiento | null,
  fix: FixVisual,
): EstadoVisualMovimiento {
  const estadoRumbo = seleccionarRumbo(fix, estado?.estadoRumbo ?? ESTADO_RUMBO_INICIAL);

  if (estado === null) {
    return {
      lat: fix.lat,
      lng: fix.lng,
      rumbo: estadoRumbo.rumbo,
      accuracy: fix.accuracy,
      speed: fix.speed,
      ts: fix.ts,
      estadoRumbo,
    };
  }

  const esJitter =
    fix.speed >= 0 &&
    fix.speed < VELOCIDAD_ANTIJITTER_MPS &&
    distanciaMetros(estado, fix) < fix.accuracy;

  return {
    lat: esJitter ? estado.lat : fix.lat,
    lng: esJitter ? estado.lng : fix.lng,
    rumbo: estadoRumbo.rumbo,
    accuracy: fix.accuracy,
    speed: fix.speed,
    ts: fix.ts,
    estadoRumbo,
  };
}

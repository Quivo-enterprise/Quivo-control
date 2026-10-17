import { calcularBearing, distanciaMetros, normalizarAngulo } from '@quivo/shared';
import type { Coordenada, FixVisual } from './tipos';

/**
 * Estado de histéresis del rumbo — lo que `seleccionarRumbo` lleva de un fix al siguiente.
 * Decisión del CTO (`docs/plan-ubicacion-fluida.md`, Fase B): rumbo GPS con histéresis; detenido,
 * se mantiene el último rumbo — sin brújula.
 */
export interface EstadoRumbo {
  /** Rumbo vigente en grados `[0,360)`, o `null` mientras no hubo ninguno válido todavía (se
   * dibuja un punto sin flecha). */
  rumbo: number | null;
  /** `true` mientras estamos en "rumbo de curso" — el modo en el que se confía en
   * `coords.heading` del fix (cuando además es válido, ver `headingValido`). Histéresis de
   * velocidad: ver las constantes de entrada/salida abajo. */
  enRumboDeCurso: boolean;
  /** Última posición usada como referencia del fallback por bearing. No se actualiza en CADA
   * fix: solo cuando de verdad se usó (heading válido o el fallback disparó) — así un tramo de
   * fixes lentos, cada uno por debajo del umbral de desplazamiento, sigue midiendo desde el
   * mismo punto en vez de reiniciar la referencia en cada fix y nunca acumular suficiente
   * distancia para superar el umbral. */
  referencia: Coordenada | null;
}

export const ESTADO_RUMBO_INICIAL: EstadoRumbo = {
  rumbo: null,
  enRumboDeCurso: false,
  referencia: null,
};

/** m/s — entra a "rumbo de curso" (confía en `coords.heading`) a esta velocidad o más. */
const VELOCIDAD_ENTRADA_MPS = 2.0;
/** m/s — sale de "rumbo de curso" por debajo de esta velocidad. Entre los dos umbrales se
 * mantiene el modo anterior: sin esta banda, una velocidad que oscila justo en el borde haría
 * titilar el rumbo entre GPS y el último valor sostenido en cada fix. */
const VELOCIDAD_SALIDA_MPS = 1.0;
/** grados — por encima de esto, `heading_accuracy` no alcanza para confiar en el heading GPS
 * del fix. */
const HEADING_ACCURACY_MAX_GRADOS = 45;
/** metros — piso del umbral de desplazamiento del fallback por bearing (el otro término de
 * `max(10, accuracy)` es la propia precisión del fix). */
const DESPLAZAMIENTO_MIN_FALLBACK_M = 10;

/** `coords.heading` es válido cuando viene de GPS (`heading >= 0`, ver el docblock de
 * `FixVisual.heading`) y, si el fix trae `heading_accuracy`, ésta no supera 45°. Sin
 * `heading_accuracy` (ausente) o con un valor `<= 0` (mismo "no disponible" que documenta el
 * SDK para varios campos de `Coords`), se trata como sin información de precisión — no bloquea. */
function headingValido(fix: FixVisual): boolean {
  if (fix.heading < 0) return false;
  const accuracy = fix.headingAccuracy;
  return accuracy === undefined || accuracy <= 0 || accuracy <= HEADING_ACCURACY_MAX_GRADOS;
}

/**
 * Reducer puro `(estado, fix) => estado` del rumbo mostrado. Prioridad, en este orden:
 * 1. `coords.heading` del fix, si estamos en "rumbo de curso" (histéresis de velocidad) y el
 *    heading es válido (ver `headingValido`).
 * 2. Fallback por bearing entre la última posición de referencia y la actual, si el
 *    desplazamiento supera `max(10m, accuracy)` — la única señal disponible con el vehículo
 *    detenido o con heading GPS no confiable.
 * 3. Si ninguna de las dos aplica, mantiene el último rumbo conocido (`null` si nunca hubo
 *    ninguno).
 */
export function seleccionarRumbo(fix: FixVisual, previo: EstadoRumbo): EstadoRumbo {
  let enRumboDeCurso = previo.enRumboDeCurso;
  if (fix.speed >= 0) {
    if (fix.speed >= VELOCIDAD_ENTRADA_MPS) enRumboDeCurso = true;
    else if (fix.speed < VELOCIDAD_SALIDA_MPS) enRumboDeCurso = false;
    // Entre los dos umbrales: se mantiene `previo.enRumboDeCurso` (histéresis).
  }
  // `speed < 0` (desconocida): tampoco se toca `enRumboDeCurso` — sin dato de velocidad no hay
  // base para decidir un cambio de modo.

  if (enRumboDeCurso && headingValido(fix)) {
    return { rumbo: normalizarAngulo(fix.heading), enRumboDeCurso, referencia: fix };
  }

  if (previo.referencia) {
    const desplazamiento = distanciaMetros(previo.referencia, fix);
    const umbral = Math.max(DESPLAZAMIENTO_MIN_FALLBACK_M, fix.accuracy);
    if (desplazamiento > umbral) {
      return { rumbo: calcularBearing(previo.referencia, fix), enRumboDeCurso, referencia: fix };
    }
    // Desplazamiento insuficiente para confiar en un bearing nuevo: mantiene rumbo y referencia
    // previos — no se "gasta" la referencia en un movimiento que puede ser solo ruido del fix.
    return { rumbo: previo.rumbo, enRumboDeCurso, referencia: previo.referencia };
  }

  // Primera posición conocida: todavía no hay un segundo punto para calcular un bearing. Guarda
  // ésta como referencia para el próximo fix; el rumbo queda como estaba (`null` si nunca hubo
  // ninguno).
  return { rumbo: previo.rumbo, enRumboDeCurso, referencia: fix };
}

import { haversineMetros } from '@quivo/shared';
import { FACTOR_REARME_RADIO, FIXES_REARME_CONSECUTIVOS } from '../../gps/geofence';

/**
 * Detección PURA de entrada/salida de la zona de la terminal para la fila de salida (sin red ni
 * React). Entrada: fix con precisión <= 100 m dentro del radio del PC terminal. Salida: estando
 * en fila, `FIXES_REARME_CONSECUTIVOS` fixes seguidos a más de `radio * FACTOR_REARME_RADIO` (el
 * mismo criterio de re-armado de `gps/geofence.ts`). Tras salir de la fila (botón, geocerca,
 * panel o worker) la llegada queda DESARMADA hasta alejarse igual: sin eso, el trufi que acaba de
 * salir volvería a la fila mientras sigue dentro del radio.
 */

/** Mismo corte que valida el servidor (422 por encima). */
export const ACCURACY_MAX_FILA_M = 100;
/** Entre dos intentos de POST (llegada o salida) pasa al menos esto: no spamear si el servidor rechaza. */
export const MIN_ENTRE_INTENTOS_MS = 60_000;
/** El botón de respaldo "Estoy en la fila" se ofrece a esta distancia del radio. */
export const FACTOR_CERCA_BOTON = 2;

export interface TerminalZona {
  lat: number;
  lng: number;
  radioM: number;
}

export interface FixFila {
  lat: number;
  lng: number;
  accuracy: number;
  /** ISO del fix (informativo para el servidor). */
  ts: string;
}

export interface EstadoDeteccionFila {
  fuerasConsecutivos: number;
  ultimoIntentoMs: number | null;
  /** `enFila` del fix anterior (`null` = desconocido: arranque en frío): detecta la entrada a la fila. */
  enFilaPrevio: boolean | null;
}

export const ESTADO_DETECCION_INICIAL: EstadoDeteccionFila = {
  fuerasConsecutivos: 0,
  ultimoIntentoMs: null,
  enFilaPrevio: null,
};

export type AccionFila = 'llegada' | 'salida' | 'rearmar' | null;

export function distanciaATerminalM(p: { lat: number; lng: number }, t: TerminalZona): number {
  return haversineMetros([p.lng, p.lat], [t.lng, t.lat]);
}

/** ¿Está lo bastante cerca como para ofrecer "Estoy en la fila"? (el servidor valida la zona real) */
export function estaCercaDeTerminal(p: { lat: number; lng: number }, t: TerminalZona): boolean {
  return distanciaATerminalM(p, t) <= t.radioM * FACTOR_CERCA_BOTON;
}

export function decidirAccionFila(entrada: {
  fix: FixFila;
  terminal: TerminalZona;
  /** Hay una fila abierta según el último estado del servidor. */
  enFila: boolean;
  /** Salió de la fila y todavía no se alejó: no se re-encola solo. */
  desarmada: boolean;
  estado: EstadoDeteccionFila;
  ahoraMs: number;
}): { accion: AccionFila; estado: EstadoDeteccionFila } {
  const { fix, terminal, enFila, desarmada, ahoraMs } = entrada;
  let { estado } = entrada;
  // Entrar a la fila (false -> true, también por llegada manual) invalida la racha previa de fixes
  // lejanos y arma el anti-rebote. Se evalúa ANTES de filtrar fixes: aunque todos los de la
  // transición se ignoren, `enFilaPrevio` se actualiza. `null` (estado inicial) no cuenta como entrada.
  if (enFila && estado.enFilaPrevio === false) {
    estado = { ...estado, fuerasConsecutivos: 0, ultimoIntentoMs: ahoraMs };
  }
  estado = { ...estado, enFilaPrevio: enFila };
  // Un fix impreciso (o corrupto) no prueba ni entrada ni salida: se ignora sin tocar la racha.
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng) || !Number.isFinite(fix.accuracy)) {
    return { accion: null, estado };
  }
  if (fix.accuracy > ACCURACY_MAX_FILA_M) return { accion: null, estado };

  const d = distanciaATerminalM(fix, terminal);
  const lejos = d > terminal.radioM * FACTOR_REARME_RADIO;
  const fuerasConsecutivos = lejos ? estado.fuerasConsecutivos + 1 : 0;
  const puedeIntentar =
    estado.ultimoIntentoMs === null || ahoraMs - estado.ultimoIntentoMs >= MIN_ENTRE_INTENTOS_MS;
  const base = { ...estado, fuerasConsecutivos };

  if (enFila) {
    if (fuerasConsecutivos >= FIXES_REARME_CONSECUTIVOS && puedeIntentar) {
      return { accion: 'salida', estado: { ...base, ultimoIntentoMs: ahoraMs } };
    }
    return { accion: null, estado: base };
  }
  if (desarmada) {
    return { accion: fuerasConsecutivos >= FIXES_REARME_CONSECUTIVOS ? 'rearmar' : null, estado: base };
  }
  if (d <= terminal.radioM && puedeIntentar) {
    return { accion: 'llegada', estado: { ...base, ultimoIntentoMs: ahoraMs } };
  }
  return { accion: null, estado: base };
}

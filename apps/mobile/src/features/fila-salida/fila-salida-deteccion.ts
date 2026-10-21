import * as Sentry from '@sentry/react-native';
import type { PuntoControlPaquete } from '@quivo/shared';
import { leerEstadoVueltaLocal } from '../../db/vuelta-actual-local';
import { rearmarFilaLocal } from '../vuelta-actual/vuelta-actual-oportunista';
import { registrarLlegada, registrarSalida } from './fila-salida-acciones';
import {
  ESTADO_DETECCION_INICIAL,
  decidirAccionFila,
  type EstadoDeteccionFila,
  type FixFila,
  type TerminalZona,
} from './zona-terminal';

/**
 * Detección automática de entrada/salida de la zona de la terminal. Un único punto de entrada
 * (`procesarFixFila`) que llaman los MISMOS callbacks de ubicación que ya consultan la vuelta
 * actual (foreground y headless): no abre suscripciones propias. La decisión es pura
 * (`zona-terminal.ts`); acá solo se lee el estado local, se ejecuta la acción y se recuerda el
 * último fix. Nunca rechaza. Quien llama garantiza que hay recorrido activo.
 */

let estado: EstadoDeteccionFila = ESTADO_DETECCION_INICIAL;
let enCurso = false;
let ultimoFix: FixFila | null = null;

/** SOLO tests/cambio de sesión: olvida racha, anti-rebote y último fix. */
export function reiniciarDeteccionFila(): void {
  estado = ESTADO_DETECCION_INICIAL;
  enCurso = false;
  ultimoFix = null;
}

/** Último fix visto por este contexto JS (para el botón "Estoy en la fila"). */
export function ultimoFixFila(): FixFila | null {
  return ultimoFix;
}

/** PC `terminal` de la ruta del día con su radio, o `null` si la ruta no tiene (no hay fila). */
export function terminalDeLaRuta(puntos: readonly PuntoControlPaquete[]): TerminalZona | null {
  const t = puntos.find((p) => p.rol === 'terminal');
  if (!t) return null;
  const [lng, lat] = t.coord.coordinates;
  if (typeof lng !== 'number' || typeof lat !== 'number') return null;
  return { lat, lng, radioM: t.radioToleranciaM };
}

/** Convierte un `Location` del SDK (o equivalente) al fix mínimo; `null` si faltan datos. */
export function fixDeLocation(l: {
  timestamp?: string | number;
  coords: { latitude: number; longitude: number; accuracy?: number };
}): FixFila | null {
  const accuracy = l.coords.accuracy;
  if (typeof accuracy !== 'number') return null;
  const ms = new Date(l.timestamp ?? Date.now()).getTime();
  return {
    lat: l.coords.latitude,
    lng: l.coords.longitude,
    accuracy,
    ts: new Date(Number.isFinite(ms) ? ms : Date.now()).toISOString(),
  };
}

export async function procesarFixFila(
  fix: FixFila | null,
  ctx: {
    sesionId: string;
    puntosControl: readonly PuntoControlPaquete[];
    obtenerAccessToken: () => Promise<string | null>;
  },
): Promise<void> {
  if (!fix) return;
  ultimoFix = fix;
  const terminal = terminalDeLaRuta(ctx.puntosControl);
  if (!terminal || enCurso) return;
  enCurso = true;
  try {
    const local = await leerEstadoVueltaLocal(ctx.sesionId);
    const r = decidirAccionFila({
      fix,
      terminal,
      enFila: Boolean(local.ultimo?.fila),
      desarmada: local.filaDesarmada === true,
      estado,
      ahoraMs: Date.now(),
    });
    estado = r.estado;
    if (r.accion === 'rearmar') await rearmarFilaLocal(ctx.sesionId);
    else if (r.accion === 'llegada') await registrarLlegada(ctx.obtenerAccessToken, fix);
    else if (r.accion === 'salida') await registrarSalida(ctx.obtenerAccessToken, 'geocerca', 1);
  } catch (error) {
    Sentry.captureException(error, { tags: { contexto: 'fila-salida', paso: 'deteccion' } });
  } finally {
    enCurso = false;
  }
}

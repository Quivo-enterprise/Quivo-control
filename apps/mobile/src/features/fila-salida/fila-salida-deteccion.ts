import * as Sentry from '@sentry/react-native';
import type { PuntoControlPaquete } from '@quivo/shared';
import { leerEstadoVueltaLocal } from '../../db/vuelta-actual-local';
import { leerPausa } from '../operacion/pausa-recorrido';
import { rearmarFilaLocal } from '../vuelta-actual/vuelta-actual-oportunista';
import { registrarLlegada, registrarSalida } from './fila-salida-acciones';
import { deteccion } from './fila-salida-estado';
import { decidirAccionFila, type FixFila, type TerminalZona } from './zona-terminal';

/**
 * Detección automática de entrada/salida de la zona de la terminal. Un único punto de entrada
 * (`procesarFixFila`) que llaman los MISMOS callbacks de ubicación que ya consultan la vuelta
 * actual (foreground y headless): no abre suscripciones propias. La decisión es pura
 * (`zona-terminal.ts`); acá solo se lee el estado local, se ejecuta la acción y se recuerda el
 * último fix. Nunca rechaza. Quien llama garantiza que hay recorrido activo.
 */

/** Un fix más viejo que esto no sirve para "Estoy en la fila" (el trufi pudo moverse). */
export const MAX_EDAD_FIX_MS = 60_000;

/** Último fix visto por este contexto JS (para el botón "Estoy en la fila"); `null` si no hay o es viejo. */
export function ultimoFixFila(): FixFila | null {
  return Date.now() - deteccion.ultimoFixRecibidoMs <= MAX_EDAD_FIX_MS ? deteccion.ultimoFix : null;
}

/** PC `terminal` de la ruta del día con su radio, o `null` si la ruta no tiene (no hay fila). */
export function terminalDeLaRuta(puntos: readonly PuntoControlPaquete[]): TerminalZona | null {
  const t = puntos.find((p) => p.rol === 'terminal');
  if (!t) return null;
  const [lng, lat] = t.coord.coordinates;
  if (typeof lng !== 'number' || typeof lat !== 'number') return null;
  return { lat, lng, radioM: t.radioToleranciaM };
}

/** Id del PC `terminal` de la ruta del día, o `null` si no tiene. */
export function terminalIdDeLaRuta(puntos: readonly PuntoControlPaquete[]): string | null {
  return puntos.find((p) => p.rol === 'terminal')?.id ?? null;
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
    /** Se invoca en el acto al DETECTAR la entrada a la fila (fuera de pausa), antes del POST. */
    alDetectarLlegada?: () => void;
  },
): Promise<void> {
  if (!fix) return;
  deteccion.ultimoFix = fix;
  deteccion.ultimoFixRecibidoMs = Date.now();
  const terminal = terminalDeLaRuta(ctx.puntosControl);
  if (!terminal || deteccion.enCurso) return;
  deteccion.enCurso = true;
  try {
    const local = await leerEstadoVueltaLocal(ctx.sesionId);
    const r = decidirAccionFila({
      fix,
      terminal,
      enFila: Boolean(local.ultimo?.fila),
      desarmada: local.filaDesarmada === true,
      estado: deteccion.estado,
      ahoraMs: Date.now(),
    });
    deteccion.estado = r.estado;
    if (r.accion === 'rearmar') await rearmarFilaLocal(ctx.sesionId);
    else if (r.accion === 'llegada') {
      // En pausa no se hace fila: el server responde 409 y, si la pausa aún está en el outbox, la llegada la pisaría.
      if (!(await leerPausa(ctx.sesionId))) {
        ctx.alDetectarLlegada?.();
        await registrarLlegada(ctx.obtenerAccessToken, fix);
      }
    }
    else if (r.accion === 'salida') await registrarSalida(ctx.obtenerAccessToken, 'geocerca', 1);
  } catch (error) {
    Sentry.captureException(error, { tags: { contexto: 'fila-salida', paso: 'deteccion' } });
  } finally {
    deteccion.enCurso = false;
  }
}

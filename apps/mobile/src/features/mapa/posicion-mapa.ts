import type { EstadoVisual } from '../operacion/movimiento/store-visual';
import type { PosicionMapa } from './tipos';

/**
 * Posición que dibuja el mapa: prioriza el store visual (alimentado con cada fix, evidencia y
 * canal visual, sin pasar por props de React) y cae al prop `posicionActual` de siempre solo
 * mientras el store todavía no tiene nada (p. ej. el primer instante tras montar, antes de que
 * llegue el primer fix). Con el store poblado viajan también rumbo, precisión, velocidad, `ts`
 * y `obsoleto`.
 */
export function posicionMapaDesde(
  estadoVisual: EstadoVisual | null,
  posicionActual: { lat: number; lng: number } | null,
): PosicionMapa | null {
  if (estadoVisual) {
    return {
      lat: estadoVisual.lat,
      lng: estadoVisual.lng,
      heading: estadoVisual.rumbo,
      accuracy: estadoVisual.accuracy,
      speed: estadoVisual.speed,
      ts: estadoVisual.ts,
      obsoleto: estadoVisual.obsoleto,
    };
  }
  return posicionActual ? { lat: posicionActual.lat, lng: posicionActual.lng } : null;
}

/** Separación mínima (ms) entre dos commits de estado de la interpolación del marcador: ~30Hz.
 * A 60Hz cada commit manda props de `Marker` + `Circle` por el bridge (arquitectura vieja,
 * `newArchEnabled: false`), demasiado en Android de gama baja. Un poco menos de 1/30s para que
 * el jitter de `requestAnimationFrame` no salte un frame de más (16.7ms x 2 = 33.3ms). */
export const INTERVALO_MIN_COMMIT_MS = 30;

/** `true` si este frame de la interpolación debe publicarse al estado: el primero, el final
 * (siempre, para no quedar corto del destino) y los que superan `INTERVALO_MIN_COMMIT_MS`
 * desde el último commit. */
export function debeCommitearFrame(
  ahoraMs: number,
  ultimoCommitMs: number | null,
  esFrameFinal: boolean,
): boolean {
  if (esFrameFinal || ultimoCommitMs === null) return true;
  return ahoraMs - ultimoCommitMs >= INTERVALO_MIN_COMMIT_MS;
}

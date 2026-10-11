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

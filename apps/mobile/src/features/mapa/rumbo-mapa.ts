import { deltaAnguloCorto, normalizarAngulo } from '../operacion/movimiento/geo';

/**
 * Emisor liviano del rumbo (grados, `[0,360)`) de la cámara del mapa, para la brújula propia de la
 * pantalla. El mapa publica a ~30 Hz en navegación (cuadro a cuadro), así que NO viaja por props ni
 * por estado de React: la brújula se suscribe y mueve un `Animated.Value`, sin re-renderizar la
 * pantalla. Para no inundar de cambios imperceptibles solo notifica cuando el rumbo cambió al menos
 * `UMBRAL_RUMBO_GRADOS` respecto del último notificado (distancia circular), salvo `forzar`.
 */
export const UMBRAL_RUMBO_GRADOS = 2;

export interface EmisorRumbo {
  /** Publica un rumbo; no notifica si cambió menos que el umbral (salvo `forzar`). */
  publicar: (grados: number, forzar?: boolean) => void;
  /** Último rumbo notificado. */
  actual: () => number;
  /** Suscribe un oyente; devuelve la función para desuscribir. */
  suscribir: (oyente: (grados: number) => void) => () => void;
}

export function crearEmisorRumbo(): EmisorRumbo {
  let ultimo = 0;
  const oyentes = new Set<(grados: number) => void>();
  return {
    publicar(grados, forzar = false) {
      if (!Number.isFinite(grados)) return;
      const nuevo = normalizarAngulo(grados);
      if (!forzar && Math.abs(deltaAnguloCorto(ultimo, nuevo)) < UMBRAL_RUMBO_GRADOS) return;
      if (nuevo === ultimo) return;
      ultimo = nuevo;
      oyentes.forEach((oyente) => oyente(nuevo));
    },
    actual: () => ultimo,
    suscribir(oyente) {
      oyentes.add(oyente);
      return () => {
        oyentes.delete(oyente);
      };
    },
  };
}

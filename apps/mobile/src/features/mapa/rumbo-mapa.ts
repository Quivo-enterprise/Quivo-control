/**
 * Emisor liviano del rumbo (grados, `[0,360)`) de la cámara del mapa, para la brújula propia de la
 * pantalla. El mapa publica a ~30 Hz en navegación (cuadro a cuadro), así que NO viaja por props ni
 * por estado de React: la brújula se suscribe y mueve un `Animated.Value`, sin re-renderizar la
 * pantalla. Para no inundar de cambios imperceptibles solo notifica cuando el rumbo cambió al menos
 * `UMBRAL_RUMBO_GRADOS` respecto del último notificado (distancia circular), salvo `forzar`.
 */
export const UMBRAL_RUMBO_GRADOS = 2;

/** Normaliza a `[0,360)`. */
export function normalizarRumbo(grados: number): number {
  return ((grados % 360) + 360) % 360;
}

/** Distancia angular mínima (0–180) entre dos rumbos. */
export function diferenciaRumbo(a: number, b: number): number {
  const d = Math.abs(normalizarRumbo(a) - normalizarRumbo(b));
  return d > 180 ? 360 - d : d;
}

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
      const nuevo = normalizarRumbo(grados);
      if (!forzar && diferenciaRumbo(nuevo, ultimo) < UMBRAL_RUMBO_GRADOS) return;
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

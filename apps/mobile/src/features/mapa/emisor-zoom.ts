import { cuantizarZoom } from './estilo-ruta';

/**
 * Emisor del zoom cuantizado (pasos de `PASO_ZOOM`) que escala el ancho de la polilínea. Mismo
 * patrón que `emisorRumbo`: el mapa publica por frame de cámara, pero solo notifica al cruzar un
 * paso, y quienes dibujan las polilíneas se suscriben, así que solo ellas re-renderizan (no el
 * árbol entero de `RouteMap`).
 */
export interface EmisorZoom {
  /** Publica un zoom (se cuantiza); no notifica si no cruzó un paso. Ignora no finitos. */
  publicar: (zoom: number) => void;
  /** Último zoom cuantizado notificado. */
  actual: () => number;
  suscribir: (oyente: () => void) => () => void;
}

export function crearEmisorZoom(zoomInicial: number): EmisorZoom {
  let ultimo = cuantizarZoom(zoomInicial);
  const oyentes = new Set<() => void>();
  return {
    publicar(zoom) {
      if (!Number.isFinite(zoom)) return;
      const q = cuantizarZoom(zoom);
      if (q === ultimo) return;
      ultimo = q;
      oyentes.forEach((oyente) => oyente());
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

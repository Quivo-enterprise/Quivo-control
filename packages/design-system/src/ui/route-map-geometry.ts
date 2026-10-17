// Lógica geométrica pura de `route-map-impl.tsx`, separada a propósito en su propio módulo
// sin imports de Leaflet/React: `route-map-impl.tsx` importa Leaflet a nivel de módulo, y
// Leaflet toca `window` en import-time (`L.Browser` hace feature-detection al cargar), así que
// no se puede importar en un test que corre en el entorno `node` por default de Vitest (no hay
// `jsdom` en este repo). Esta función sí se puede testear directo, sin montar un mapa.

/** Fracción central del viewport (0-1) dentro de la cual `FollowPoint` tolera que el punto
 * seguido se mueva sin que el mapa reencuadre. */
export const FOLLOW_CENTRAL_FRACTION = 0.6;

/**
 * Determina si un punto —ya proyectado a coordenadas de píxel del contenedor del mapa (ver
 * `Map.latLngToContainerPoint`)— cae dentro del rectángulo central del viewport, dado el
 * tamaño del contenedor (`Map.getSize`) y una fracción central (0-1, default 60%).
 *
 * Usada por `FollowPoint` en `route-map-impl.tsx`: con el vehículo detenido, el ruido normal
 * del GPS (`distanceFilter: 50` igual deja jitter de unos metros entre fixes) movería el punto
 * en cada actualización, y centrar el mapa (`panTo`) en cada una haría que "vibrara"
 * constantemente. Tolerar el 60% central (20% de margen a cada lado) absorbe ese ruido sin
 * perder de vista al vehículo cuando sí se está moviendo.
 */
export function isWithinCentralViewport(
  point: { x: number; y: number },
  size: { x: number; y: number },
  fraction: number = FOLLOW_CENTRAL_FRACTION,
  relleno?: RellenoMapa,
): boolean {
  if (size.x <= 0 || size.y <= 0) return true;
  const { left, top, ancho, alto } = rectVisible(size, relleno);
  const marginX = left + (ancho * (1 - fraction)) / 2;
  const marginY = top + (alto * (1 - fraction)) / 2;
  return (
    point.x >= marginX &&
    point.x <= left + ancho - (marginX - left) &&
    point.y >= marginY &&
    point.y <= top + alto - (marginY - top)
  );
}

/** Zonas del contenedor tapadas por la UI (HUD arriba, panel abajo o al costado), en px. */
export interface RellenoMapa {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Rectángulo visible del contenedor (menos el relleno). Si el relleno lo anula (ancho o alto
 * <= 0) se ignora: mejor seguir con el contenedor entero que no seguir nada. */
function rectVisible(size: { x: number; y: number }, relleno?: RellenoMapa) {
  const l = Math.max(0, relleno?.left ?? 0);
  const t = Math.max(0, relleno?.top ?? 0);
  const ancho = size.x - l - Math.max(0, relleno?.right ?? 0);
  const alto = size.y - t - Math.max(0, relleno?.bottom ?? 0);
  return ancho > 0 && alto > 0 ? { left: l, top: t, ancho, alto } : { left: 0, top: 0, ancho: size.x, alto: size.y };
}

/** Cuánto (px) queda el centro del rectángulo visible respecto del centro del contenedor
 * (x > 0: a la derecha; y > 0: abajo). Es donde debe caer el punto seguido al centrarlo. */
export function centroVisibleDesplazado(
  size: { x: number; y: number },
  relleno?: RellenoMapa,
): { x: number; y: number } {
  const r = rectVisible(size, relleno);
  return { x: r.left + r.ancho / 2 - size.x / 2, y: r.top + r.alto / 2 - size.y / 2 };
}

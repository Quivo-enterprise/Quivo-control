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
): boolean {
  if (size.x <= 0 || size.y <= 0) return true;
  const marginX = (size.x * (1 - fraction)) / 2;
  const marginY = (size.y * (1 - fraction)) / 2;
  return (
    point.x >= marginX &&
    point.x <= size.x - marginX &&
    point.y >= marginY &&
    point.y <= size.y - marginY
  );
}

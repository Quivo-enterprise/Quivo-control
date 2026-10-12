// Proyección Web Mercator pura (la que usan Google Maps y MapLibre) para saber en qué pixel del
// contenedor cae un punto, dada la cámara (centro + zoom). Permite decidir el `followPoint` del
// motor Google sin depender de `map.getProjection()` (que no existe hasta el primer `idle`) y
// testearlo en `node`. Asume cámara sin inclinación ni rotación (el motor las deshabilita).

const TAMANO_TESELA = 256;

/** Coordenadas "mundo" Mercator (0..256 a zoom 0). */
function aMundo(lat: number, lng: number): { x: number; y: number } {
  const seno = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return {
    x: TAMANO_TESELA * (0.5 + lng / 360),
    y: TAMANO_TESELA * (0.5 - Math.log((1 + seno) / (1 - seno)) / (4 * Math.PI)),
  };
}

/** Pixel (origen arriba-izquierda) del contenedor donde cae `punto`. */
export function latLngAPixelContenedor(
  punto: { lat: number; lng: number },
  centro: { lat: number; lng: number },
  zoom: number,
  tamano: { x: number; y: number },
): { x: number; y: number } {
  const escala = 2 ** zoom;
  const p = aMundo(punto.lat, punto.lng);
  const c = aMundo(centro.lat, centro.lng);
  return {
    x: (p.x - c.x) * escala + tamano.x / 2,
    y: (p.y - c.y) * escala + tamano.y / 2,
  };
}

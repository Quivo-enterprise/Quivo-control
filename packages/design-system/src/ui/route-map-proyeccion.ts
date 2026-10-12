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

/** Inversa de `aMundo`: coordenadas "mundo" Mercator -> lat/lng. */
function deMundo(x: number, y: number): { lat: number; lng: number } {
  const n = Math.PI - (2 * Math.PI * y) / TAMANO_TESELA;
  return {
    lat: (Math.atan(Math.sinh(n)) * 180) / Math.PI,
    lng: (x / TAMANO_TESELA - 0.5) * 360,
  };
}

/**
 * Equivalente de `line-offset` de MapLibre para el motor Google (cuyas `Polyline` no lo tienen):
 * desplaza lateralmente el camino `offsetPx` pixeles de pantalla (positivo = a la derecha del
 * sentido de avance, igual que MapLibre) a un zoom dado. Como el desplazamiento es constante en
 * pixeles, el consumidor debe recalcularlo cuando cambia el zoom. En cada vértice usa la normal
 * promedio de los segmentos vecinos (esquinas suaves, sin mitra) y se limita a offsets chicos
 * (rutas paralelas, ±pocos px), para los que esa aproximación es indistinguible.
 */
export function desplazarCamino(
  camino: Array<{ lat: number; lng: number }>,
  offsetPx: number,
  zoom: number,
): Array<{ lat: number; lng: number }> {
  if (offsetPx === 0 || camino.length < 2) return camino;
  const escala = 2 ** zoom;
  const mundo = camino.map((p) => aMundo(p.lat, p.lng));
  // Normal derecha (pantalla con y hacia abajo) de cada segmento, unitaria; (0,0) si degenerado.
  const normales = mundo.slice(1).map((b, i) => {
    const a = mundo[i] ?? b;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const largo = Math.hypot(dx, dy);
    return largo === 0 ? { x: 0, y: 0 } : { x: -dy / largo, y: dx / largo };
  });
  return camino.map((original, i) => {
    const p = mundo[i];
    if (!p) return original;
    const previa = normales[i - 1];
    const siguiente = normales[i];
    const nx = (previa?.x ?? 0) + (siguiente?.x ?? 0);
    const ny = (previa?.y ?? 0) + (siguiente?.y ?? 0);
    const largo = Math.hypot(nx, ny);
    if (largo === 0) return original;
    const paso = offsetPx / escala;
    return deMundo(p.x + (nx / largo) * paso, p.y + (ny / largo) * paso);
  });
}

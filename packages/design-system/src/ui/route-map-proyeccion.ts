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

/** Tope de la mitra: el vértice nunca se aleja del eje más de `LIMITE_MITRA` veces el offset. */
const LIMITE_MITRA = 2;

/**
 * Equivalente de `line-offset` de MapLibre para el motor Google (cuyas `Polyline` no lo tienen):
 * desplaza lateralmente el camino `offsetPx` pixeles de pantalla (positivo = a la derecha del
 * sentido de avance, igual que MapLibre) a un zoom dado. Como el desplazamiento es constante en
 * pixeles, el consumidor debe recalcularlo cuando cambia el zoom.
 *
 * En cada vértice se une el desplazamiento de los segmentos vecinos con una mitra: el vértice se
 * mueve por la bisectriz `offsetPx / cos(θ/2)` (así ambos tramos quedan a `offsetPx` del eje),
 * acotada a `LIMITE_MITRA × offsetPx` para que en giros muy cerrados no salte una espiga. En una
 * reversión exacta (la bisectriz no existe) se usa la normal del segmento anterior. Los puntos
 * consecutivos repetidos (vehículo detenido) heredan la normal del segmento no degenerado más
 * cercano, de modo que toda la racha se desplaza igual y no quedan muescas sobre el eje.
 * Devuelve un punto por cada punto de entrada.
 */
export function desplazarCamino(
  camino: Array<{ lat: number; lng: number }>,
  offsetPx: number,
  zoom: number,
): Array<{ lat: number; lng: number }> {
  if (offsetPx === 0 || camino.length < 2) return camino;
  const escala = 2 ** zoom;
  const paso = offsetPx / escala;
  const mundo = camino.map((p) => aMundo(p.lat, p.lng));
  // Normal derecha (pantalla con y hacia abajo) de cada segmento, unitaria; null si degenerado.
  const normales = mundo.slice(1).map((b, i) => {
    const a = mundo[i] ?? b;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const largo = Math.hypot(dx, dy);
    return largo === 0 ? null : { x: -dy / largo, y: dx / largo };
  });
  /** Normal del segmento válido más cercano hacia atrás (índice < i), si existe. */
  const normalPrevia = (i: number) => {
    for (let j = i - 1; j >= 0; j--) {
      const n = normales[j];
      if (n) return n;
    }
    return null;
  };
  /** Normal del segmento válido más cercano hacia delante (índice >= i), si existe. */
  const normalSiguiente = (i: number) => {
    for (let j = i; j < normales.length; j++) {
      const n = normales[j];
      if (n) return n;
    }
    return null;
  };
  return camino.map((original, i) => {
    const p = mundo[i];
    if (!p) return original;
    const previa = normalPrevia(i);
    const siguiente = normalSiguiente(i);
    const primera = previa ?? siguiente;
    const segunda = siguiente ?? previa;
    if (!primera || !segunda) return original; // todo el camino es un único punto
    const sx = primera.x + segunda.x;
    const sy = primera.y + segunda.y;
    const largo = Math.hypot(sx, sy);
    // `largo / 2` = cos(θ/2) entre las normales. Casi 0 => reversión: normal del tramo previo.
    if (largo < 1e-9) return deMundo(p.x + primera.x * paso, p.y + primera.y * paso);
    const mitra = Math.min(2 / largo, LIMITE_MITRA);
    return deMundo(p.x + (sx / largo) * paso * mitra, p.y + (sy / largo) * paso * mitra);
  });
}

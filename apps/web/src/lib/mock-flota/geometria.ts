/**
 * Interpolación sobre una polilínea `[lat, lng][]`, usada para mover los trufis mock a lo
 * largo de la ruta de su línea (tick de 1 s en `flota-mock-context.tsx`).
 *
 * Es interpolación LINEAL por distancia acumulada (no geodésica exacta, no sigue calles):
 * para el radio de una demo de mapa (zoom ciudad/barrio) el error es imperceptible y evita
 * traer una librería de geometría nueva (regla del contrato: "no new dependencies").
 */

/** Radio medio terrestre en metros — mismo valor que usa el resto del repo para haversine. */
const RADIO_TIERRA_M = 6_371_000;

function aRadianes(grados: number): number {
  return (grados * Math.PI) / 180;
}

/** Distancia haversine en metros entre dos puntos `[lat, lng]`. */
function distanciaMetros(a: [number, number], b: [number, number]): number {
  const [lat1, lng1] = a;
  const [lat2, lng2] = b;
  const dLat = aRadianes(lat2 - lat1);
  const dLng = aRadianes(lng2 - lng1);
  const rLat1 = aRadianes(lat1);
  const rLat2 = aRadianes(lat2);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Cache de largos de segmento por polilínea (clave: la referencia del array), para no
 * recalcular N distancias haversine en CADA tick (1/s) de CADA trufi — la polilínea de una
 * línea es la misma referencia de array durante toda la vida de la demo (`LINEAS_MOCK` no se
 * reconstruye), así que se calcula una sola vez y se reusa. `WeakMap` para no retener la
 * polilínea si alguna vez dejara de estar referenciada desde otro lado.
 */
const cacheSegmentos = new WeakMap<
  [number, number][],
  { segmentos: number[]; largoTotal: number }
>();

function segmentosDe(polilinea: [number, number][]): { segmentos: number[]; largoTotal: number } {
  const cacheado = cacheSegmentos.get(polilinea);
  if (cacheado) {
    return cacheado;
  }
  const segmentos: number[] = [];
  let largoTotal = 0;
  for (let i = 0; i < polilinea.length - 1; i++) {
    const largo = distanciaMetros(polilinea[i]!, polilinea[i + 1]!);
    segmentos.push(largo);
    largoTotal += largo;
  }
  const resultado = { segmentos, largoTotal };
  cacheSegmentos.set(polilinea, resultado);
  return resultado;
}

/**
 * Posición sobre la polilínea para un `avance` en `[0, 1)` (hace loop: `avance` fuera de
 * rango se normaliza con módulo 1 antes de interpolar).
 *
 * Recorre la polilínea acumulando distancia real (haversine) hasta ubicar el segmento que
 * contiene el punto pedido, y hace `lerp` lineal lat/lng dentro de ese segmento — suficiente
 * para el propósito visual de la demo (ver cabecera del archivo). Los largos de segmento se
 * calculan una sola vez por polilínea (`segmentosDe`, cacheados en un `WeakMap`), no en cada
 * llamada.
 */
export function posicionEnPolilinea(
  polilinea: [number, number][],
  avance: number,
): { lat: number; lng: number } {
  if (polilinea.length === 0) {
    return { lat: 0, lng: 0 };
  }
  if (polilinea.length === 1) {
    const [lat, lng] = polilinea[0]!;
    return { lat, lng };
  }

  // Normaliza a [0, 1) incluso si `avance` viene negativo o >= 1 (el tick suma un paso chico
  // cada segundo y podría pasarse de largo del final).
  const t = ((avance % 1) + 1) % 1;

  const { segmentos, largoTotal } = segmentosDe(polilinea);

  if (largoTotal === 0) {
    const [lat, lng] = polilinea[0]!;
    return { lat, lng };
  }

  const distanciaObjetivo = t * largoTotal;
  let acumulado = 0;
  for (let i = 0; i < segmentos.length; i++) {
    const largoSegmento = segmentos[i]!;
    if (acumulado + largoSegmento >= distanciaObjetivo || i === segmentos.length - 1) {
      const fraccionSegmento = largoSegmento === 0 ? 0 : (distanciaObjetivo - acumulado) / largoSegmento;
      const [lat1, lng1] = polilinea[i]!;
      const [lat2, lng2] = polilinea[i + 1]!;
      const clamp = Math.min(1, Math.max(0, fraccionSegmento));
      return {
        lat: lat1 + (lat2 - lat1) * clamp,
        lng: lng1 + (lng2 - lng1) * clamp,
      };
    }
    acumulado += largoSegmento;
  }

  // Inalcanzable en la práctica (el loop siempre retorna dentro del for), pero TypeScript
  // no lo sabe con `noUncheckedIndexedAccess` — fallback al último punto.
  const [lat, lng] = polilinea[polilinea.length - 1]!;
  return { lat, lng };
}

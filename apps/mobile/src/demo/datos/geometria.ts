/**
 * portado desde apps/web/src/lib/mock-flota/geometria.ts — mantener sincronizado
 *
 * Solo el subconjunto que necesita el APK demo: interpolar posición/heading sobre la polilínea
 * de una línea, medir distancias en metros a lo largo de la ruta, y (`trazoVisibleDe`) recortar
 * el tramo a DIBUJAR en el mapa cuando la línea es de ida y vuelta (la 120). Se deja afuera lo
 * que el mock del web usa solo para desvíos/atascos (`tramoDesdeAvance`,
 * `desplazarPerpendicular`) — el APK demo no simula esos escenarios.
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
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Wrapper público de `distanciaMetros` — lo necesita `motor.ts` para medir gaps
 * delante/detrás sin reimplementar haversine. */
export function distanciaEntrePuntosM(a: [number, number], b: [number, number]): number {
  return distanciaMetros(a, b);
}

/** Cache de largos de segmento por polilínea (clave: la referencia del array), para no
 * recalcular N distancias haversine en cada tick del motor — la polilínea de una línea es la
 * misma referencia de array durante toda la vida de la demo (`LINEAS_MOCK` no se reconstruye). */
const cacheSegmentos = new WeakMap<[number, number][], { segmentos: number[]; largoTotal: number }>();

function segmentosDe(polilinea: [number, number][]): { segmentos: number[]; largoTotal: number } {
  const cacheado = cacheSegmentos.get(polilinea);
  if (cacheado) return cacheado;
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

/** Largo total (metros) de una polilínea. */
export function largoTotalM(polilinea: [number, number][]): number {
  return segmentosDe(polilinea).largoTotal;
}

/**
 * Posición sobre la polilínea para un `avance` en `[0, 1)` (hace loop: `avance` fuera de rango
 * se normaliza con módulo 1 antes de interpolar). Interpolación lineal por distancia acumulada
 * (no geodésica exacta) — de sobra para el radio visual de esta demo.
 */
export function posicionEnPolilinea(
  polilinea: [number, number][],
  avance: number,
): { lat: number; lng: number } {
  if (polilinea.length === 0) return { lat: 0, lng: 0 };
  if (polilinea.length === 1) {
    const [lat, lng] = polilinea[0]!;
    return { lat, lng };
  }

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
      return { lat: lat1 + (lat2 - lat1) * clamp, lng: lng1 + (lng2 - lng1) * clamp };
    }
    acumulado += largoSegmento;
  }
  const [lat, lng] = polilinea[polilinea.length - 1]!;
  return { lat, lng };
}

/**
 * Avance `[0,1)` de un punto `(lat, lng)` sobre `polilinea`: ubica el vértice más cercano y
 * devuelve su distancia acumulada / largo total. Ver el docblock del original en
 * `apps/web/src/lib/mock-flota/geometria.ts` para el caso de un único punto suelto.
 */
export function avanceDeParada(polilinea: [number, number][], lat: number, lng: number): number {
  if (polilinea.length === 0) return 0;
  let indiceCercano = 0;
  let distanciaCercana = Infinity;
  for (let i = 0; i < polilinea.length; i++) {
    const d = distanciaMetros(polilinea[i]!, [lat, lng]);
    if (d < distanciaCercana) {
      distanciaCercana = d;
      indiceCercano = i;
    }
  }
  const { segmentos, largoTotal } = segmentosDe(polilinea);
  if (largoTotal === 0) return 0;
  let acumulado = 0;
  for (let i = 0; i < indiceCercano; i++) acumulado += segmentos[i]!;
  return Math.min(0.999999, acumulado / largoTotal);
}

/**
 * Avances `[0,1)` de un conjunto de paradas de una MISMA línea, en el orden en que se pasaron
 * (no necesariamente ordenadas por `orden`) — cada parada busca su vértice más cercano
 * ESTRICTAMENTE DESPUÉS del vértice encontrado para la parada anterior (según `orden`), así el
 * resultado es siempre monótono creciente por `orden`. Ver el docblock largo del original para
 * el porqué (evita empates cuando el vértice global más cercano de dos paradas cae en la misma
 * zona de la polilínea).
 */
export function avancesDeParadas(
  polilinea: [number, number][],
  paradas: { lat: number; lng: number; orden: number }[],
): number[] {
  if (polilinea.length === 0 || paradas.length === 0) return paradas.map(() => 0);
  const { segmentos, largoTotal } = segmentosDe(polilinea);
  const ordenAsc = [...paradas].sort((a, b) => a.orden - b.orden);
  const avancePorOrden = new Map<number, number>();

  let indiceBusqueda = 0;
  ordenAsc.forEach((parada, i) => {
    if (i === 0) {
      avancePorOrden.set(parada.orden, 0);
      return;
    }
    const desde = Math.min(indiceBusqueda + 1, polilinea.length - 1);
    let indiceCercano = desde;
    let distanciaCercana = Infinity;
    for (let idx = desde; idx < polilinea.length; idx++) {
      const d = distanciaMetros(polilinea[idx]!, [parada.lat, parada.lng]);
      if (d < distanciaCercana) {
        distanciaCercana = d;
        indiceCercano = idx;
      }
    }
    let acumulado = 0;
    for (let idx = 0; idx < indiceCercano; idx++) acumulado += segmentos[idx]!;
    const avance = largoTotal === 0 ? 0 : Math.min(0.999999, acumulado / largoTotal);
    avancePorOrden.set(parada.orden, avance);
    indiceBusqueda = indiceCercano;
  });

  return paradas.map((p) => avancePorOrden.get(p.orden) ?? 0);
}

/**
 * Metros recorridos AVANZANDO por la polilínea desde `avanceInicio` hasta `avanceFin`, en
 * sentido de recorrido normal (hace loop si `avanceFin < avanceInicio`). Usado por
 * `adelanteAtras` (`motor.ts`) para medir la distancia sobre la ruta entre dos unidades.
 */
export function distanciaEntreAvancesM(
  polilinea: [number, number][],
  avanceInicio: number,
  avanceFin: number,
): number {
  const { largoTotal } = segmentosDe(polilinea);
  if (largoTotal === 0) return 0;
  const a = ((avanceInicio % 1) + 1) % 1;
  const b = ((avanceFin % 1) + 1) % 1;
  const fraccion = b >= a ? b - a : 1 - a + b;
  return fraccion * largoTotal;
}

/**
 * Rumbo (grados, 0=norte/+lat, 90=este/+lng — aproximación plana) de la polilínea en el punto
 * `avance`, usado para orientar el marcador del trufi propio y los de otros vehículos en el
 * mapa.
 */
export function bearingEnAvance(polilinea: [number, number][], avance: number): number {
  if (polilinea.length < 2) return 0;
  const { segmentos, largoTotal } = segmentosDe(polilinea);
  if (largoTotal === 0) return 0;
  const t = ((avance % 1) + 1) % 1;
  const distanciaObjetivo = t * largoTotal;
  let acumulado = 0;
  for (let i = 0; i < segmentos.length; i++) {
    if (acumulado + segmentos[i]! >= distanciaObjetivo || i === segmentos.length - 1) {
      const [lat1, lng1] = polilinea[i]!;
      const [lat2, lng2] = polilinea[i + 1]!;
      const dLat = lat2 - lat1;
      const dLng = (lng2 - lng1) * Math.cos(aRadianes((lat1 + lat2) / 2));
      return (Math.atan2(dLng, dLat) * 180) / Math.PI;
    }
    acumulado += segmentos[i]!;
  }
  return 0;
}

/**
 * Detecta el vértice de RETORNO de una polilínea de ida y vuelta (recorre las mismas calles de
 * ida y de vuelta para cerrar el loop, como la Línea 120) — el índice donde el recorrido empieza
 * a retrazar, en sentido opuesto, el camino que ya hizo. Ver el docblock largo del original en
 * `apps/web/src/lib/mock-flota/geometria.ts` para el porqué del algoritmo (punto más lejano del
 * inicio + verificación de espejo).
 */
export function indiceDeRetornoDe(polilinea: [number, number][], toleranciaM = 5): number | null {
  if (polilinea.length < 3) return null;

  const inicio = polilinea[0]!;
  let distanciaMax = -1;
  let indiceMax = -1;
  for (let i = 0; i < polilinea.length; i++) {
    const d = distanciaMetros(inicio, polilinea[i]!);
    if (d > distanciaMax) {
      distanciaMax = d;
      indiceMax = i;
    }
  }

  const alcance = Math.min(indiceMax, polilinea.length - 1 - indiceMax);
  if (alcance === 0) return null;

  for (let k = 1; k <= alcance; k++) {
    const antes = polilinea[indiceMax - k]!;
    const despues = polilinea[indiceMax + k]!;
    if (distanciaMetros(antes, despues) > toleranciaM) return null;
  }

  return indiceMax;
}

/**
 * Tramo VISIBLE de una polilínea — solo la ida, cuando la polilínea completa es de ida y vuelta
 * sobre las mismas calles (ver `indiceDeRetornoDe`). Para DIBUJAR el trazo en el mapa, no para
 * mover vehículos (`posicionEnPolilinea` sigue necesitando la polilínea COMPLETA). Si la
 * polilínea no es de ida y vuelta (p. ej. el circuito Z12), devuelve la misma polilínea sin
 * cambios.
 */
export function trazoVisibleDe(polilinea: [number, number][]): [number, number][] {
  const indiceRetorno = indiceDeRetornoDe(polilinea);
  return indiceRetorno === null ? polilinea : polilinea.slice(0, indiceRetorno + 1);
}

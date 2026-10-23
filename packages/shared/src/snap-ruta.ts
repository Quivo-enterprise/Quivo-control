import { deltaAnguloCorto, normalizarAngulo, type Coordenada } from './geo.js';

/**
 * Snap VISUAL del marcador a la polilínea de la ruta asignada (sin OSRM: no está desplegado en
 * producción). Funciones puras, sin React ni SDK. Solo afecta lo que se dibuja: la evidencia, el
 * sync y la geofence siguen con el GPS crudo. Fuera de ruta (`snapARuta` → `null`) el marcador
 * muestra el GPS crudo.
 *
 * Geometría en proyección equirectangular local (metros) alrededor del centroide de la ruta: a
 * escala de una ruta urbana el error frente a haversine es despreciable y evita trigonometría por
 * segmento en cada fix.
 */

const RADIO_TIERRA_M = 6_371_008.8;
const RAD = Math.PI / 180;

/** Distancia máxima al eje de la ruta (m) para aceptar el snap: `max(25, min(accuracy, 40))`. */
export const DISTANCIA_MIN_ACEPTADA_M = 25;
export const DISTANCIA_MAX_ACEPTADA_M = 40;
/** Con velocidad ≥ este valor (m/s) y rumbo conocido, se exige alineación con el segmento. */
export const VELOCIDAD_MIN_RUMBO_MS = 2;
/** Diferencia circular máxima (°) entre el rumbo del fix y el bearing del segmento. */
export const TOLERANCIA_RUMBO_GRADOS = 60;
/** Sin rumbo confiable (lento), diferencia circular máxima (°) entre el bearing del segmento y el
 * último rumbo mostrado: un segmento casi opuesto (carril contrario) no se adopta. */
export const TOLERANCIA_RUMBO_PREVIO_GRADOS = 120;
/** Ventana de histéresis alrededor del segmento anterior. */
export const VENTANA_SEGMENTOS = 15;
export const VENTANA_METROS = 300;
/** Penalización (m) a los segmentos de la ventana que no son el anterior ni sus vecinos
 * inmediatos: un carril paralelo apenas más cerca no le gana al tramo que ya se venía siguiendo. */
export const PENALIZACION_SALTO_M = 8;
/** Fixes consecutivos sin snap durante los que el llamador conserva el tramo anterior (histéresis
 * que sobrevive a un fallo aislado); al superarlo se descarta y se busca en toda la ruta. */
export const MAX_FALLOS_SNAP = 3;
/** Distancia (m) entre inicio y fin bajo la cual la ruta se considera un circuito cerrado. */
const UMBRAL_CIRCUITO_M = 50;

interface Segmento {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  largo: number;
  /** Bearing `[0,360)` del segmento (0 = norte, horario). */
  bearing: number;
  /** Distancia acumulada (m) al inicio del segmento. */
  acumulado: number;
}

export interface RutaSnap {
  segmentos: Segmento[];
  largoTotal: number;
  /** El fin de la ruta coincide con su inicio: se puede dar la vuelta al interpolar. */
  cerrada: boolean;
  lat0: number;
  lng0: number;
  kx: number;
  ky: number;
}

export interface FixSnap {
  lat: number;
  lng: number;
  rumbo: number | null;
  velocidadMs: number | null;
  accuracy: number | null;
}

export interface ResultadoSnap {
  lat: number;
  lng: number;
  /** Bearing del segmento sobre el que quedó el marcador. */
  rumbo: number;
  /** Distancia acumulada (m) desde el inicio de la polilínea. */
  distanciaRecorrida: number;
  indiceSegmento: number;
  /** Distancia (m) del GPS crudo al eje de la ruta. */
  distanciaAlEje: number;
}

export interface PuntoEnRuta {
  lat: number;
  lng: number;
  rumbo: number;
  /** Distancia acumulada (m) del punto, ya normalizada al rango de la ruta. */
  distancia: number;
}

/** Precalcula los segmentos de la polilínea. `null` con menos de 2 puntos distintos. */
export function prepararRutaSnap(coordenadas: Coordenada[]): RutaSnap | null {
  if (coordenadas.length < 2) return null;
  let sumaLat = 0;
  let sumaLng = 0;
  for (const c of coordenadas) {
    sumaLat += c.lat;
    sumaLng += c.lng;
  }
  const lat0 = sumaLat / coordenadas.length;
  const lng0 = sumaLng / coordenadas.length;
  const ky = RADIO_TIERRA_M * RAD;
  const kx = ky * Math.cos(lat0 * RAD);

  const segmentos: Segmento[] = [];
  let acumulado = 0;
  for (let i = 0; i < coordenadas.length - 1; i += 1) {
    const a = coordenadas[i]!;
    const b = coordenadas[i + 1]!;
    const ax = (a.lng - lng0) * kx;
    const ay = (a.lat - lat0) * ky;
    const bx = (b.lng - lng0) * kx;
    const by = (b.lat - lat0) * ky;
    const largo = Math.hypot(bx - ax, by - ay);
    if (!(largo > 0)) continue; // puntos repetidos: sin dirección
    const bearing = normalizarAngulo(Math.atan2(bx - ax, by - ay) / RAD);
    segmentos.push({ ax, ay, bx, by, largo, bearing, acumulado });
    acumulado += largo;
  }
  if (segmentos.length === 0) return null;
  const primero = segmentos[0]!;
  const ultimo = segmentos[segmentos.length - 1]!;
  const cerrada = Math.hypot(ultimo.bx - primero.ax, ultimo.by - primero.ay) <= UMBRAL_CIRCUITO_M;
  return { segmentos, largoTotal: acumulado, cerrada, lat0, lng0, kx, ky };
}

interface Candidato {
  indice: number;
  distancia: number;
  t: number;
}

/**
 * Mejor segmento aceptable en los índices `[desde, hasta]` (inclusive), o `null`. En una ruta
 * cerrada los índices son "virtuales" y se toman módulo la cantidad de segmentos (la ventana
 * puede cruzar el punto de cierre); la penalización de salto usa la distancia circular.
 */
function mejorCandidato(
  ruta: RutaSnap,
  x: number,
  y: number,
  desde: number,
  hasta: number,
  umbral: number,
  rumbo: number | null,
  base: number | null = null,
  rumboPrevio: number | null = null,
): Candidato | null {
  const n = ruta.segmentos.length;
  let mejor: Candidato | null = null;
  let mejorPuntaje = Infinity;
  for (let k = desde; k <= hasta; k += 1) {
    const i = ruta.cerrada ? ((k % n) + n) % n : k;
    const s = ruta.segmentos[i]!;
    const dx = s.bx - s.ax;
    const dy = s.by - s.ay;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / (s.largo * s.largo)));
    const distancia = Math.hypot(x - (s.ax + dx * t), y - (s.ay + dy * t));
    if (distancia > umbral) continue;
    if (rumbo !== null && Math.abs(deltaAnguloCorto(s.bearing, rumbo)) > TOLERANCIA_RUMBO_GRADOS) {
      continue;
    }
    if (
      rumbo === null &&
      rumboPrevio !== null &&
      Math.abs(deltaAnguloCorto(s.bearing, rumboPrevio)) > TOLERANCIA_RUMBO_PREVIO_GRADOS
    ) {
      continue;
    }
    let salto = base !== null ? Math.abs(i - base) : 0;
    if (ruta.cerrada) salto = Math.min(salto, n - salto);
    const puntaje = distancia + (salto > 1 ? PENALIZACION_SALTO_M : 0);
    if (puntaje < mejorPuntaje) {
      mejorPuntaje = puntaje;
      mejor = { indice: i, distancia, t };
    }
  }
  return mejor;
}

/**
 * Distancia (m) y bearing del segmento de la ruta más cercano a `(lat, lng)`; `null` si la ruta no
 * tiene segmentos. Sin ventana ni filtro de rumbo: sirve para saber en qué sentido corre la ruta en
 * un punto (p. ej. un PC), no para seguir al vehículo.
 */
export function segmentoMasCercano(
  ruta: RutaSnap,
  lat: number,
  lng: number,
): { distancia: number; rumbo: number } | null {
  const x = (lng - ruta.lng0) * ruta.kx;
  const y = (lat - ruta.lat0) * ruta.ky;
  let mejor: { distancia: number; rumbo: number } | null = null;
  for (const s of ruta.segmentos) {
    const dx = s.bx - s.ax;
    const dy = s.by - s.ay;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / (s.largo * s.largo)));
    const distancia = Math.hypot(x - (s.ax + dx * t), y - (s.ay + dy * t));
    if (mejor === null || distancia < mejor.distancia) mejor = { distancia, rumbo: s.bearing };
  }
  return mejor;
}

/** Distancia acumulada (m) al inicio del segmento con índice virtual `k` (módulo en circuito cerrado). */
function acumuladoVirtual(ruta: RutaSnap, k: number): number {
  const n = ruta.segmentos.length;
  if (!ruta.cerrada) return ruta.segmentos[k]!.acumulado;
  const vuelta = Math.floor(k / n);
  return ruta.segmentos[k - vuelta * n]!.acumulado + vuelta * ruta.largoTotal;
}

/**
 * Proyecta el fix sobre la ruta. Devuelve `null` si queda fuera de tolerancia o desalineado
 * (el llamador usa entonces el GPS crudo). Con `anterior` busca primero en una ventana de
 * segmentos/metros alrededor del tramo previo (con wrap en circuitos cerrados), favoreciendo el
 * previo y sus vecinos (histéresis: evita saltar al carril paralelo o a un tramo que cruza). Si
 * ahí no hay candidato aceptable busca en toda la ruta, salvo que el rumbo se ignore (parado o
 * lento, sin rumbo confiable): ahí un tramo lejano o del carril opuesto sería un falso positivo,
 * así que solo se admite la búsqueda global tras `MAX_FALLOS_SNAP` fixes consecutivos sin snap
 * (`fallosConsecutivos`, lo lleva el llamador). Sin rumbo confiable, con `rumboPrevio` (último
 * rumbo confiable del llamador) no se adopta, ni en la ventana ni en la búsqueda global, un
 * segmento a más de `TOLERANCIA_RUMBO_PREVIO_GRADOS` de él: sin candidato → `null` y el llamador
 * conserva el rumbo previo.
 */
export function snapARuta(
  ruta: RutaSnap,
  fix: FixSnap,
  anterior: { indiceSegmento: number } | null,
  fallosConsecutivos = 0,
  rumboPrevio: number | null = null,
): ResultadoSnap | null {
  const x = (fix.lng - ruta.lng0) * ruta.kx;
  const y = (fix.lat - ruta.lat0) * ruta.ky;
  const umbral = Math.max(
    DISTANCIA_MIN_ACEPTADA_M,
    Math.min(fix.accuracy ?? DISTANCIA_MIN_ACEPTADA_M, DISTANCIA_MAX_ACEPTADA_M),
  );
  const rumbo =
    fix.rumbo !== null &&
    Number.isFinite(fix.rumbo) &&
    fix.rumbo >= 0 &&
    fix.velocidadMs !== null &&
    fix.velocidadMs >= VELOCIDAD_MIN_RUMBO_MS
      ? fix.rumbo
      : null;
  const ultimo = ruta.segmentos.length - 1;

  let candidato: Candidato | null = null;
  let ventanaIntentada = false;
  if (anterior && anterior.indiceSegmento >= 0 && anterior.indiceSegmento <= ultimo) {
    ventanaIntentada = true;
    const base = anterior.indiceSegmento;
    const n = ultimo + 1;
    const acumBase = ruta.segmentos[base]!.acumulado;
    // Índices virtuales: en circuito cerrado pueden salir de `[0, ultimo]` (wrap); la ventana
    // nunca cubre más de una vuelta.
    let lo = base;
    while (
      (ruta.cerrada || lo > 0) &&
      base - lo + 1 < n &&
      (base - lo < VENTANA_SEGMENTOS || acumBase - acumuladoVirtual(ruta, lo - 1) <= VENTANA_METROS)
    ) {
      lo -= 1;
    }
    let hi = base;
    while (
      (ruta.cerrada || hi < ultimo) &&
      hi - lo + 1 < n &&
      (hi - base < VENTANA_SEGMENTOS || acumuladoVirtual(ruta, hi + 1) - acumBase <= VENTANA_METROS)
    ) {
      hi += 1;
    }
    candidato = mejorCandidato(ruta, x, y, lo, hi, umbral, rumbo, base, rumboPrevio);
  }
  if (
    !candidato &&
    (!ventanaIntentada || rumbo !== null || fallosConsecutivos >= MAX_FALLOS_SNAP)
  ) {
    candidato = mejorCandidato(ruta, x, y, 0, ultimo, umbral, rumbo, null, rumboPrevio);
  }
  if (!candidato) return null;

  const s = ruta.segmentos[candidato.indice]!;
  const punto = puntoEnSegmento(ruta, s, candidato.t);
  return {
    lat: punto.lat,
    lng: punto.lng,
    rumbo: s.bearing,
    distanciaRecorrida: s.acumulado + candidato.t * s.largo,
    indiceSegmento: candidato.indice,
    distanciaAlEje: candidato.distancia,
  };
}

function puntoEnSegmento(ruta: RutaSnap, s: Segmento, t: number): Coordenada {
  return {
    lat: ruta.lat0 + (s.ay + (s.by - s.ay) * t) / ruta.ky,
    lng: ruta.lng0 + (s.ax + (s.bx - s.ax) * t) / ruta.kx,
  };
}

/** Punto y bearing a la distancia acumulada `distancia` (acotada a `[0, largoTotal]`). */
export function puntoEnDistancia(ruta: RutaSnap, distancia: number): PuntoEnRuta {
  const d = Math.max(0, Math.min(ruta.largoTotal, distancia));
  let lo = 0;
  let hi = ruta.segmentos.length - 1;
  while (lo < hi) {
    const medio = (lo + hi + 1) >> 1;
    if (ruta.segmentos[medio]!.acumulado <= d) lo = medio;
    else hi = medio - 1;
  }
  const s = ruta.segmentos[lo]!;
  const punto = puntoEnSegmento(ruta, s, Math.min(1, (d - s.acumulado) / s.largo));
  return { lat: punto.lat, lng: punto.lng, rumbo: s.bearing, distancia: d };
}

/**
 * Posición a lo largo de la polilínea entre dos distancias acumuladas, con `t ∈ [0,1]` — las
 * esquinas se siguen por la calle en vez de cortarlas en línea recta. En una ruta cerrada, un
 * salto mayor a la mitad del largo se interpreta como dar la vuelta (cruce del punto de cierre)
 * y se interpola por el camino corto con wrap; en una abierta, o con un retroceso chico, se
 * interpola tal cual (hacia atrás).
 */
export function interpolarSobreRuta(
  ruta: RutaSnap,
  desdeDist: number,
  hastaDist: number,
  t: number,
): PuntoEnRuta {
  const delta = deltaSobreRuta(ruta, desdeDist, hastaDist);
  let d = desdeDist + delta * Math.max(0, Math.min(1, t));
  if (ruta.cerrada) {
    d %= ruta.largoTotal;
    if (d < 0) d += ruta.largoTotal;
  }
  return puntoEnDistancia(ruta, d);
}

/** Recorrido con signo (m) de `desdeDist` a `hastaDist` por el camino que usa `interpolarSobreRuta`
 * (con wrap por el camino corto en circuitos cerrados). */
function deltaSobreRuta(ruta: RutaSnap, desdeDist: number, hastaDist: number): number {
  let delta = hastaDist - desdeDist;
  if (ruta.cerrada) {
    if (delta < -ruta.largoTotal / 2) delta += ruta.largoTotal;
    else if (delta > ruta.largoTotal / 2) delta -= ruta.largoTotal;
  }
  return delta;
}

/** Margen fijo (m) sobre la cuerda y factor de la cuerda para aceptar la animación por la calle. */
const MARGEN_CUERDA_M = 30;
const FACTOR_CUERDA = 3;

/**
 * ¿Es razonable animar por la calle entre dos puntos ajustados? Solo si el recorrido sobre la
 * polilínea no supera `max(3 × cuerda, cuerda + 30 m)`, con `cuerda` la distancia en línea recta
 * (haversine) entre ambos. Si no (ida y vuelta por carriles opuestos pegados, un tramo que se
 * dobla sobre sí mismo), el marcador recorrería media ruta para moverse unos metros: se anima en
 * línea recta.
 */
export function debeInterpolarPorRuta(
  ruta: RutaSnap,
  desdeDist: number,
  hastaDist: number,
  cuerdaM: number,
): boolean {
  const recorrido = Math.abs(deltaSobreRuta(ruta, desdeDist, hastaDist));
  return recorrido <= Math.max(FACTOR_CUERDA * cuerdaM, cuerdaM + MARGEN_CUERDA_M);
}

/**
 * Vértices de la polilínea estrictamente entre las distancias acumuladas `desdeDist` y
 * `hastaDist`, más los dos extremos interpolados (`puntoEnDistancia`) — la geometría para dibujar
 * el tramo siguiendo la calle. Mismo criterio de camino que `interpolarSobreRuta`: en un circuito
 * cerrado, un salto mayor a media vuelta se recorre dando la vuelta (con wrap por el cierre).
 */
export function tramoDeRuta(
  ruta: RutaSnap,
  desdeDist: number,
  hastaDist: number,
): { lat: number; lng: number }[] {
  const delta = deltaSobreRuta(ruta, desdeDist, hastaDist);
  const L = ruta.largoTotal;
  const norm = (d: number) => (ruta.cerrada ? ((d % L) + L) % L : d);
  const coords: { lat: number; lng: number }[] = [];
  const empuja = (d: number) => {
    const p = puntoEnDistancia(ruta, norm(d));
    coords.push({ lat: p.lat, lng: p.lng });
  };
  empuja(desdeDist);
  const paso = delta >= 0 ? 1 : -1;
  const fin = desdeDist + delta;
  // Vueltas virtuales: los vértices están en acumulado + k·L (k entero, solo si cierra).
  const kMin = ruta.cerrada ? Math.floor(Math.min(desdeDist, fin) / L) : 0;
  const kMax = ruta.cerrada ? Math.floor(Math.max(desdeDist, fin) / L) : 0;
  const vertices: number[] = [];
  const lo = Math.min(desdeDist, fin);
  const hi = Math.max(desdeDist, fin);
  const segs = ruta.segmentos;
  for (let k = kMin; k <= kMax; k += 1) {
    // `acumulado` es ascendente: búsqueda binaria del primer vértice > lo - k·L y se avanza hasta hi - k·L.
    let a = 0;
    let b = segs.length;
    while (a < b) {
      const m = (a + b) >> 1;
      if (segs[m]!.acumulado + k * L <= lo) a = m + 1;
      else b = m;
    }
    for (let i = a; i < segs.length; i += 1) {
      const d = segs[i]!.acumulado + k * L;
      if (d >= hi) break;
      vertices.push(d);
    }
  }
  vertices.sort((a, b) => paso * (a - b));
  for (const d of vertices) empuja(d);
  empuja(fin);
  return coords;
}

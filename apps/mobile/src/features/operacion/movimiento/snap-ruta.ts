import { deltaAnguloCorto, normalizarAngulo } from './geo';
import type { Coordenada } from './tipos';

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
/** Ventana de histéresis alrededor del segmento anterior. */
export const VENTANA_SEGMENTOS = 15;
export const VENTANA_METROS = 300;
/** Penalización (m) a los segmentos de la ventana que no son el anterior ni sus vecinos
 * inmediatos: un carril paralelo apenas más cerca no le gana al tramo que ya se venía siguiendo. */
export const PENALIZACION_SALTO_M = 8;
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

/** Mejor segmento aceptable en `[desde, hasta]` (inclusive), o `null`. */
function mejorCandidato(
  ruta: RutaSnap,
  x: number,
  y: number,
  desde: number,
  hasta: number,
  umbral: number,
  rumbo: number | null,
  base: number | null = null,
): Candidato | null {
  let mejor: Candidato | null = null;
  let mejorPuntaje = Infinity;
  for (let i = desde; i <= hasta; i += 1) {
    const s = ruta.segmentos[i]!;
    const dx = s.bx - s.ax;
    const dy = s.by - s.ay;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / (s.largo * s.largo)));
    const distancia = Math.hypot(x - (s.ax + dx * t), y - (s.ay + dy * t));
    if (distancia > umbral) continue;
    if (rumbo !== null && Math.abs(deltaAnguloCorto(s.bearing, rumbo)) > TOLERANCIA_RUMBO_GRADOS) {
      continue;
    }
    const puntaje =
      distancia + (base !== null && Math.abs(i - base) > 1 ? PENALIZACION_SALTO_M : 0);
    if (puntaje < mejorPuntaje) {
      mejorPuntaje = puntaje;
      mejor = { indice: i, distancia, t };
    }
  }
  return mejor;
}

/**
 * Proyecta el fix sobre la ruta. Devuelve `null` si queda fuera de tolerancia o desalineado
 * (el llamador usa entonces el GPS crudo). Con `anterior` busca primero en una ventana de
 * segmentos/metros alrededor del tramo previo, favoreciendo el previo y sus vecinos (histéresis:
 * evita saltar al carril paralelo o a un tramo que cruza), y recién si ahí no hay candidato aceptable busca en toda la ruta.
 */
export function snapARuta(
  ruta: RutaSnap,
  fix: FixSnap,
  anterior: { indiceSegmento: number } | null,
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
  if (anterior && anterior.indiceSegmento >= 0 && anterior.indiceSegmento <= ultimo) {
    const base = anterior.indiceSegmento;
    const acumBase = ruta.segmentos[base]!.acumulado;
    let lo = base;
    while (
      lo > 0 &&
      (base - lo < VENTANA_SEGMENTOS ||
        acumBase - ruta.segmentos[lo - 1]!.acumulado <= VENTANA_METROS)
    ) {
      lo -= 1;
    }
    let hi = base;
    while (
      hi < ultimo &&
      (hi - base < VENTANA_SEGMENTOS || ruta.segmentos[hi + 1]!.acumulado - acumBase <= VENTANA_METROS)
    ) {
      hi += 1;
    }
    candidato = mejorCandidato(ruta, x, y, lo, hi, umbral, rumbo, base);
  }
  candidato ??= mejorCandidato(ruta, x, y, 0, ultimo, umbral, rumbo);
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
  let delta = hastaDist - desdeDist;
  if (ruta.cerrada) {
    if (delta < -ruta.largoTotal / 2) delta += ruta.largoTotal;
    else if (delta > ruta.largoTotal / 2) delta -= ruta.largoTotal;
  }
  let d = desdeDist + delta * Math.max(0, Math.min(1, t));
  if (ruta.cerrada) {
    d %= ruta.largoTotal;
    if (d < 0) d += ruta.largoTotal;
  }
  return puntoEnDistancia(ruta, d);
}

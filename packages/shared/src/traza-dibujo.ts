import type { PuntoTrazaGps } from './entities/recorrido.js';
import { calcularBearing, distanciaMetros } from './geo.js';
import {
  MAX_FALLOS_SNAP,
  debeInterpolarPorRuta,
  snapARuta,
  tramoDeRuta,
  type ResultadoSnap,
  type RutaSnap,
} from './snap-ruta.js';

/**
 * Qué se dibuja de la traza GPS real de un recorrido: segmentos "pegados a la calle" (`ruta`,
 * con el snap de `snap-ruta.ts` y las esquinas seguidas por la polilínea) y segmentos "libres"
 * (GPS crudo, donde el vehículo salió de la ruta). Función pura, solo afecta el dibujo.
 */

/** Se descartan fixes con `accuracy` mayor (m). `accuracy` nulo se conserva. */
export const UMBRAL_ACCURACY_DIBUJO_M = 50;
/** Se descartan fixes que implican ir más rápido que esto desde el último válido. */
export const VELOCIDAD_MAX_KMH = 120;
/** Hueco (s o m) entre fixes válidos consecutivos a partir del cual se corta la línea. */
export const HUECO_MAX_S = 120;
export const HUECO_MAX_M = 300;
/** Desplazamiento mínimo (m) para derivar el rumbo del movimiento: `max(esto, accuracy)`. */
const DESPLAZAMIENTO_MIN_RUMBO_M = 10;

export interface SegmentoTraza {
  tipo: 'ruta' | 'libre';
  coords: { lat: number; lng: number }[];
}

const msDe = (p: PuntoTrazaGps) => Date.parse(p.ts);

/** Rechazos por velocidad consecutivos y coherentes entre sí que sueltan el último válido (ancla). */
const REBASE_RECHAZADOS = 3;

/** Ir de `a` a `b` no supera `VELOCIDAD_MAX_KMH`. */
function velocidadPosible(a: PuntoTrazaGps, b: PuntoTrazaGps): boolean {
  const dtS = Math.max(1, (msDe(b) - msDe(a)) / 1000);
  return (distanciaMetros(a, b) / dtS) * 3.6 <= VELOCIDAD_MAX_KMH;
}

/** Puntos a considerar: por `ts` (orden estable, sin mutar la entrada), sin `ts` inválido, sin
 * `accuracy` > 50 m y sin saltos que impliquen > 120 km/h desde el último válido. */
export function puntosValidosParaDibujo<T extends PuntoTrazaGps>(puntos: readonly T[]): T[] {
  const ordenados = puntos.filter((p) => Number.isFinite(msDe(p))).sort((a, b) => msDe(a) - msDe(b));
  const validos: T[] = [];
  let rechazados: T[] = [];
  for (const p of ordenados) {
    if (p.accuracy !== null && p.accuracy > UMBRAL_ACCURACY_DIBUJO_M) continue;
    const ultimo = validos[validos.length - 1];
    if (ultimo && !velocidadPosible(ultimo, p)) {
      // Rechazados seguidos y coherentes entre sí: el outlier es el ancla, no ellos.
      const ant = rechazados[rechazados.length - 1];
      if (ant && velocidadPosible(ant, p)) rechazados.push(p);
      else rechazados = [p];
      if (rechazados.length < REBASE_RECHAZADOS) continue;
      validos.pop();
      validos.push(...rechazados);
      rechazados = [];
      continue;
    }
    rechazados = [];
    validos.push(p);
  }
  return validos;
}

/** Un punto ya ajustado a las rutas: `pos` es el punto sobre la calle (o el crudo si no ajustó). */
export interface PuntoAjustado {
  pos: { lat: number; lng: number };
  snap: ResultadoSnap | null;
  /** Índice de la ruta de `rutas` sobre la que ajustó, `-1` si no ajustó. */
  rutaIdx: number;
  /** Hay un hueco de tiempo/distancia respecto del punto anterior. */
  hueco: boolean;
}

/** Ajusta cada punto (ordenados por `ts`) a `rutas` con el snap de `snap-ruta.ts`, probándolas en
 * orden (la base primero, luego el tramo de variante), con la histéresis del snap anterior y el
 * rumbo derivado del movimiento. Un hueco reinicia esa memoria. No filtra: ver
 * `puntosValidosParaDibujo`. */
export function ajustarPuntosARutas(
  puntos: readonly PuntoTrazaGps[],
  rutas: readonly RutaSnap[],
): PuntoAjustado[] {
  const previos: ({ indiceSegmento: number } | null)[] = rutas.map(() => null);
  const fallos: number[] = rutas.map(() => 0);
  let rumboUltimo: number | null = null;
  return puntos.map((p, i) => {
    const prev = i > 0 ? puntos[i - 1]! : null;
    const dist = prev ? distanciaMetros(prev, p) : 0;
    const dtS = prev ? (msDe(p) - msDe(prev)) / 1000 : 0;
    const hueco = prev !== null && (dtS > HUECO_MAX_S || dist > HUECO_MAX_M);
    if (hueco) {
      previos.fill(null);
      fallos.fill(0);
      rumboUltimo = null;
    }
    if (prev && dist > Math.max(DESPLAZAMIENTO_MIN_RUMBO_M, p.accuracy ?? 0)) {
      rumboUltimo = calcularBearing(prev, p);
    }
    const velocidadMs = p.speed !== null && p.speed >= 0 ? p.speed : prev && dtS > 0 ? dist / dtS : null;

    let snap: ResultadoSnap | null = null;
    let rutaIdx = -1;
    for (let r = 0; r < rutas.length && !snap; r += 1) {
      const intentar = (rumbo: number | null) =>
        snapARuta(
          rutas[r]!,
          { lat: p.lat, lng: p.lng, rumbo, velocidadMs, accuracy: p.accuracy },
          previos[r]!,
          fallos[r]!,
        );
      // El rumbo puede estar viejo tras una esquina (solo se actualiza con desplazamiento > accuracy):
      // si el filtro de ±60° rechaza, se reintenta sin rumbo (conserva la histéresis).
      const res = intentar(rumboUltimo) ?? (rumboUltimo !== null ? intentar(null) : null);
      if (res) {
        snap = res;
        rutaIdx = r;
        previos[r] = { indiceSegmento: res.indiceSegmento };
        fallos[r] = 0;
      } else {
        fallos[r]! += 1;
        if (fallos[r]! > MAX_FALLOS_SNAP) previos[r] = null;
      }
    }
    const pos = snap ? { lat: snap.lat, lng: snap.lng } : { lat: p.lat, lng: p.lng };
    return { pos, snap, rutaIdx, hueco };
  });
}

/** Segmentos a dibujar para una traza, probando el snap contra `rutas` en orden (la base primero,
 * luego el tramo de variante). Los huecos de tiempo/distancia cortan la línea. */
export function trazaParaDibujo(
  puntos: readonly PuntoTrazaGps[],
  rutas: readonly RutaSnap[],
): SegmentoTraza[] {
  const ajustados = ajustarPuntosARutas(puntosValidosParaDibujo(puntos), rutas);
  const segmentos: SegmentoTraza[] = [];
  let actual: SegmentoTraza | null = null;
  let ant: PuntoAjustado | null = null;

  for (const { pos, snap, rutaIdx, hueco } of ajustados) {
    const tipoPunto: SegmentoTraza['tipo'] = snap ? 'ruta' : 'libre';
    // Un tramo es 'ruta' solo si AMBOS extremos están ajustados; si no, la cuerda sería inventada.
    const tipo: SegmentoTraza['tipo'] = ant?.snap && snap ? 'ruta' : 'libre';
    if (!ant || hueco) {
      actual = { tipo: tipoPunto, coords: [pos] };
      segmentos.push(actual);
    } else {
      let tramo = [ant.pos, pos];
      if (
        snap &&
        ant.snap &&
        ant.rutaIdx === rutaIdx &&
        debeInterpolarPorRuta(
          rutas[rutaIdx]!,
          ant.snap.distanciaRecorrida,
          snap.distanciaRecorrida,
          distanciaMetros(ant.pos, pos),
        )
      ) {
        tramo = tramoDeRuta(rutas[rutaIdx]!, ant.snap.distanciaRecorrida, snap.distanciaRecorrida);
      }
      if (actual!.tipo === tipo) {
        actual!.coords.push(...tramo.slice(1));
      } else {
        actual = { tipo, coords: tramo };
        segmentos.push(actual);
      }
    }
    ant = { pos, snap, rutaIdx, hueco };
  }
  return segmentos.filter((s) => s.coords.length >= 2);
}

import { haversineMetros } from './geo.js';

/** [longitud, latitud] — orden GeoJSON. */
type Coord = [number, number];

/** Radio (m) por defecto del PC de retorno para dar por "alcanzada" la primera aproximación. */
export const RADIO_CORTE_RETORNO_M = 150;

const RAD = Math.PI / 180;
const METROS_POR_GRADO = 6_371_008.8 * RAD;

/** Proyección equirectangular local (metros) alrededor de `origen`: sobra a escala de una ruta urbana. */
function aMetros(p: Coord, origen: Coord): [number, number] {
  return [(p[0] - origen[0]) * METROS_POR_GRADO * Math.cos(origen[1] * RAD), (p[1] - origen[1]) * METROS_POR_GRADO];
}

/** Distancia (m) y parámetro `t ∈ [0,1]` del punto del segmento `a→b` más cercano a `p`. */
function proyectarEnSegmento(p: Coord, a: Coord, b: Coord): { distanciaM: number; t: number } {
  const [ax, ay] = aMetros(a, p);
  const [bx, by] = aMetros(b, p);
  const dx = bx - ax;
  const dy = by - ay;
  const largo2 = dx * dx + dy * dy;
  // `p` es el origen (0,0): la proyección del origen sobre el segmento.
  const t = largo2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / largo2)) : 0;
  return { distanciaM: Math.hypot(ax + dx * t, ay + dy * t), t };
}

/** Distancia mínima (m) de `punto` a la polilínea; `Infinity` si tiene menos de 2 vértices. */
export function distanciaAPolilineaM(punto: Coord, polilinea: readonly Coord[]): number {
  let mejor = Infinity;
  for (let i = 0; i < polilinea.length - 1; i += 1) {
    const { distanciaM } = proyectarEnSegmento(punto, polilinea[i]!, polilinea[i + 1]!);
    if (distanciaM < mejor) mejor = distanciaM;
  }
  return mejor;
}

export interface CircuitoPartido {
  /** Del inicio de la polilínea hasta el punto de corte (incluido). */
  ida: Coord[];
  /** Del punto de corte (incluido) hasta el final de la polilínea. */
  regreso: Coord[];
  /** Índice del segmento (`geometria[i]→geometria[i+1]`) donde cae el corte. */
  indiceCorte: number;
}

/**
 * Parte el circuito cerrado de la línea 16 en ida y regreso por el PC de retorno (Honduras). Ida y
 * regreso comparten calles, así que el retorno se busca desde el INICIO de la polilínea: el corte
 * está en el punto más cercano de la PRIMERA aproximación (primer segmento a ≤ `radioM`; se sigue
 * avanzando por esa racha hasta su mínimo global). Una segunda pasada cerca del retorno (el regreso por la
 * misma calle) no mueve el corte. El punto proyectado se inserta en ambas mitades. `null` si la
 * polilínea nunca pasa a ≤ `radioM` del retorno o si alguna mitad queda sin segmento.
 */
export function partirCircuitoPorRetorno(
  geometria: readonly Coord[],
  coordRetorno: Coord,
  radioM: number = RADIO_CORTE_RETORNO_M,
): CircuitoPartido | null {
  const n = geometria.length - 1; // segmentos
  let k = 0;
  while (k < n) {
    const { distanciaM } = proyectarEnSegmento(coordRetorno, geometria[k]!, geometria[k + 1]!);
    if (distanciaM <= radioM) break;
    k += 1;
  }
  if (k >= n) return null;

  // Mínimo GLOBAL dentro de la primera racha de segmentos a ≤ `radioM` (la racha termina al salir).
  let mejorK = k;
  let mejor = proyectarEnSegmento(coordRetorno, geometria[k]!, geometria[k + 1]!);
  for (let i = k + 1; i < n; i += 1) {
    const actual = proyectarEnSegmento(coordRetorno, geometria[i]!, geometria[i + 1]!);
    if (actual.distanciaM > radioM) break;
    if (actual.distanciaM < mejor.distanciaM) {
      mejorK = i;
      mejor = actual;
    }
  }

  const a = geometria[mejorK]!;
  const b = geometria[mejorK + 1]!;
  const corte: Coord = [a[0] + (b[0] - a[0]) * mejor.t, a[1] + (b[1] - a[1]) * mejor.t];
  const ida = [...geometria.slice(0, mejorK + 1), corte];
  const regreso = [corte, ...geometria.slice(mejorK + 1)];
  // Un corte en un extremo del circuito deja una mitad degenerada (sin recorrido): no hay fases.
  if (haversineMetros(ida[0]!, corte) < 1 || haversineMetros(corte, regreso[regreso.length - 1]!) < 1) {
    return null;
  }
  return { ida, regreso, indiceCorte: mejorK };
}

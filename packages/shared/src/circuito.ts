import { haversineMetros } from './geo.js';

/** [longitud, latitud] — orden GeoJSON. */
type Coord = [number, number];

/** Radio (m) por defecto del PC de retorno para dar por "alcanzada" la primera aproximación. */
export const RADIO_CORTE_RETORNO_M = 150;

const RAD = Math.PI / 180;
const METROS_POR_GRADO = 6_371_008.8 * RAD;

/** Proyección equirectangular local (metros) alrededor de `origen`: sobra a escala de una ruta urbana. */
function aMetros(p: Coord, origen: Coord): [number, number] {
  return [
    (p[0] - origen[0]) * METROS_POR_GRADO * Math.cos(origen[1] * RAD),
    (p[1] - origen[1]) * METROS_POR_GRADO,
  ];
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
  if (
    haversineMetros(ida[0]!, corte) < 1 ||
    haversineMetros(corte, regreso[regreso.length - 1]!) < 1
  ) {
    return null;
  }
  return { ida, regreso };
}

/** Única fuente de la fase: la usan el schema de la query, la API y el móvil. */
export const FASES_CIRCUITO = ['ida', 'regreso'] as const;
export type FaseCircuito = (typeof FASES_CIRCUITO)[number];

/** Un fix con precisión peor que esto (m) proyecta en cualquier lado: no se usa para ubicar a nadie. */
export const PRECISION_MAX_M = 50;

export interface ProgresoCircuito {
  /** Metros recorridos desde el inicio del circuito hasta el punto proyectado. */
  progresoM: number;
  /** Largo total de la polilínea (m). */
  largoM: number;
  /** Distancia (m) del punto al trazado proyectado: mide qué tan "en la ruta" está el fix. */
  distanciaAlTrazadoM: number;
  /** Primer y último vértice a ≤ `RADIO_CORTE_RETORNO_M`: el progreso es módulo `largoM`. */
  circular: boolean;
}

/** Proyección del punto sobre la polilínea: metros desde su inicio, largo total y distancia al trazado. */
function proyectarEnPolilinea(
  punto: Coord,
  polilinea: readonly Coord[],
): { progresoM: number; largoM: number; distanciaM: number } {
  let acumulado = 0;
  let progresoM = 0;
  let distanciaM = Infinity;
  for (let i = 0; i < polilinea.length - 1; i += 1) {
    const a = polilinea[i]!;
    const b = polilinea[i + 1]!;
    const largoSegmento = haversineMetros(a, b);
    const p = proyectarEnSegmento(punto, a, b);
    if (p.distanciaM < distanciaM) {
      distanciaM = p.distanciaM;
      progresoM = acumulado + p.t * largoSegmento;
    }
    acumulado += largoSegmento;
  }
  return { progresoM, largoM: acumulado, distanciaM };
}

/** Circuito listo para proyectar: se calcula una vez por ruta, no por candidato ni por request. */
export interface CircuitoPreparado {
  geometria: readonly Coord[];
  /** `null` sin retorno o si el circuito no se puede partir: no hay fases. */
  partido: CircuitoPartido | null;
  /** Largo de la mitad de ida (m); 0 sin `partido`. */
  largoIdaM: number;
  /** ida + regreso con `partido`; si no, el de toda la polilínea. */
  largoM: number;
  circular: boolean;
}

export function prepararCircuito(
  geometria: readonly Coord[],
  coordRetorno: Coord | null,
): CircuitoPreparado {
  const circular =
    geometria.length >= 2 &&
    haversineMetros(geometria[0]!, geometria[geometria.length - 1]!) <= RADIO_CORTE_RETORNO_M;
  const partido = coordRetorno ? partirCircuitoPorRetorno(geometria, coordRetorno) : null;
  if (!partido) {
    return { geometria, partido: null, largoIdaM: 0, largoM: largoPolilineaM(geometria), circular };
  }
  const largoIdaM = largoPolilineaM(partido.ida);
  return {
    geometria,
    partido,
    largoIdaM,
    largoM: largoIdaM + largoPolilineaM(partido.regreso),
    circular,
  };
}

function largoPolilineaM(polilinea: readonly Coord[]): number {
  let total = 0;
  for (let i = 0; i < polilinea.length - 1; i += 1)
    total += haversineMetros(polilinea[i]!, polilinea[i + 1]!);
  return total;
}

/**
 * Progreso (m) de `punto` a lo largo del circuito. Ida y regreso comparten calles, así que con la
 * fase conocida y el circuito partido se proyecta SOLO en la mitad de esa fase (regreso = largo de
 * la ida + `s`); la proyección global caía en la mitad equivocada. Si el punto está a más de
 * `toleranciaM` de su mitad pero a ≤ `toleranciaM` de la OTRA, se usa la otra: es el análogo sin
 * estado de `evaluarFixFase` (móvil) cuando la fase del servidor quedó atrás (retorno nunca
 * registrado) o adelantada (aún en el radio del PC). Sin fase o sin partir, proyecta en toda la
 * polilínea. `distanciaAlTrazadoM` es la de la mitad realmente usada.
 */
export function progresoEnCircuito(
  punto: Coord,
  circuito: CircuitoPreparado,
  fase: FaseCircuito | null,
  toleranciaM: number,
): ProgresoCircuito {
  const { partido, largoIdaM, largoM, circular } = circuito;
  if (!partido || !fase) {
    const p = proyectarEnPolilinea(punto, circuito.geometria);
    return { progresoM: p.progresoM, largoM, distanciaAlTrazadoM: p.distanciaM, circular };
  }
  let usada = fase;
  let p = proyectarEnPolilinea(punto, partido[fase]);
  if (p.distanciaM > toleranciaM) {
    const otra = fase === 'ida' ? 'regreso' : 'ida';
    const q = proyectarEnPolilinea(punto, partido[otra]);
    if (q.distanciaM <= toleranciaM) {
      usada = otra;
      p = q;
    }
  }
  return {
    progresoM: (usada === 'ida' ? 0 : largoIdaM) + p.progresoM,
    largoM,
    distanciaAlTrazadoM: p.distanciaM,
    circular,
  };
}

/**
 * Posición del otro respecto de mí. Circular: un solo lado, el más corto
 * (`d = (otro − yo) mod L`; `d ≤ L/2` → delante a `d`, si no detrás a `L − d`), así A ve a B delante
 * a X exactamente cuando B ve a A detrás a X. Lineal: delante si está más adelante. `d = 0` va a
 * detrás en ambos casos (convención de siempre: dos vehículos en el mismo punto no son "delante").
 */
export function separacionCircular(
  miProgresoM: number,
  suProgresoM: number,
  largoM: number,
  circular: boolean,
): { lado: 'delante' | 'detras'; distanciaM: number } {
  if (!circular || largoM <= 0) {
    const d = suProgresoM - miProgresoM;
    return d > 0 ? { lado: 'delante', distanciaM: d } : { lado: 'detras', distanciaM: Math.abs(d) };
  }
  const d = (((suProgresoM - miProgresoM) % largoM) + largoM) % largoM;
  // d == L/2 exacto (metros en float) es el único caso no simétrico (ambos "delante"): se acepta.
  if (d === 0) return { lado: 'detras', distanciaM: 0 };
  return d <= largoM / 2
    ? { lado: 'delante', distanciaM: d }
    : { lado: 'detras', distanciaM: largoM - d };
}

import {
  separacionCircular,
  UMBRAL_VECINO_FRESCO_MS,
  type ProgresoCircuito,
  type VecinoRuta,
} from '@quivo/shared';

/**
 * Tiempo de vida de la lista de candidatos de una ruta en memoria. Con N vehículos pidiendo
 * cada 30 s sobre la misma ruta, esto colapsa N consultas pesadas (proyección PostGIS de toda
 * la flota de la ruta) en una cada 15 s. 15 s es mucho menos que la resolución útil de
 * "delante/detrás" (los fixes llegan cada ~20 s con lag de ingesta de minutos).
 */
export const VECINOS_CACHE_TTL_MS = 15_000;

/**
 * Tope de rutas cacheadas a la vez. Acota la memoria del proceso: cada entrada guarda como
 * mucho una fila liviana por vehículo en curso de esa ruta. Al llegar al tope se purgan las
 * expiradas y, si sigue lleno, se descarta la más antigua.
 */
export const VECINOS_CACHE_MAX_RUTAS = 2000;

/**
 * Tiempo de vida de la geometría de la ruta y su PC de retorno. Cambian solo al editar la ruta, y
 * cada recarga trae ~30 KB: mucho más largo que el de los candidatos.
 */
export const VECINOS_GEOMETRIA_TTL_MS = 5 * 60_000;

/** Candidato a vecino: otro vehículo en curso sobre la misma ruta, ya proyectado sobre ella. */
export interface CandidatoVecino {
  sesionId: string;
  vehiculoId: string;
  placa: string;
  numeroInterno: string | null;
  tipo: string;
  marca: string;
  modelo: string;
  color: string;
  colorSecundario: string | null;
  /** Metros recorridos por el último fix bueno del candidato, proyectado en la mitad de su fase. */
  progresoM: number;
  ultimoFixTs: Date;
}

/** Valor cacheado por `(sindicatoId, rutaId)`. */
export interface EntradaRuta {
  candidatos: CandidatoVecino[];
}

/**
 * Mapa con TTL y tope de tamaño. El reloj se inyecta (`ahoraMs`) para poder testearlo sin
 * timers falsos. Los `Map` de JS conservan el orden de inserción: el primero es el más viejo.
 */
export class CacheTtl<V> {
  private readonly entradas = new Map<string, { valor: V; expiraMs: number }>();

  constructor(
    private readonly ttlMs: number = VECINOS_CACHE_TTL_MS,
    private readonly maxEntradas: number = VECINOS_CACHE_MAX_RUTAS,
  ) {}

  /** Devuelve el valor vigente, o `undefined`. Una entrada expirada se borra al acceder. */
  get(clave: string, ahoraMs: number): V | undefined {
    const e = this.entradas.get(clave);
    if (!e) return undefined;
    if (e.expiraMs <= ahoraMs) {
      this.entradas.delete(clave);
      return undefined;
    }
    return e.valor;
  }

  set(clave: string, valor: V, ahoraMs: number): void {
    // Borrar y reinsertar mueve la clave al final (la más nueva).
    this.entradas.delete(clave);
    if (this.entradas.size >= this.maxEntradas) {
      for (const [k, e] of this.entradas) {
        if (e.expiraMs <= ahoraMs) this.entradas.delete(k);
      }
      while (this.entradas.size >= this.maxEntradas) {
        const masVieja = this.entradas.keys().next();
        if (masVieja.done) break;
        this.entradas.delete(masVieja.value);
      }
    }
    this.entradas.set(clave, { valor, expiraMs: ahoraMs + this.ttlMs });
  }

  get size(): number {
    return this.entradas.size;
  }

  clear(): void {
    this.entradas.clear();
  }
}

function aVecino(c: CandidatoVecino, distanciaM: number, ahora: Date): VecinoRuta {
  return {
    placa: c.placa,
    numeroInterno: c.numeroInterno,
    tipo: c.tipo,
    marca: c.marca,
    modelo: c.modelo,
    color: c.color,
    colorSecundario: c.colorSecundario,
    distanciaM,
    // Entero >= 0: un skew de reloj entre Postgres y Node no debe dar edad negativa.
    edadFixS: Math.max(0, Math.floor((ahora.getTime() - c.ultimoFixTs.getTime()) / 1000)),
  };
}

/**
 * Elige el vecino de adelante y el de atrás entre los candidatos de la ruta.
 *
 * - Cada candidato cae en UN solo lado (`separacionCircular`): en un circuito, el más corto; en
 *   una ruta lineal, según su progreso. `delante`/`detras` son los más cercanos de cada lado.
 * - **Empate** (mismo punto que yo, distancia 0): va a `detras`, para que dos vehículos en el
 *   mismo punto no se muestren ambos "delante".
 * - Se excluye mi propia sesión y cualquier otra sesión de mi mismo vehículo.
 * - La frescura se evalúa AQUÍ contra `ahora` (no al armar el caché): una entrada cacheada
 *   sigue descartando a quien se volvió viejo dentro del TTL.
 *
 * Entre candidatos a igual distancia, gana el de fix más reciente.
 */
export function seleccionarVecinos(
  /** Mi progreso, el largo de la polilínea (m) y si es un circuito cerrado (separación por el lado más corto). */
  yo: Pick<ProgresoCircuito, 'progresoM' | 'largoM' | 'circular'>,
  candidatos: readonly CandidatoVecino[],
  miSesionId: string,
  ahora: Date,
  miVehiculoId?: string,
): { delante: VecinoRuta | null; detras: VecinoRuta | null } {
  type Elegido = { c: CandidatoVecino; distanciaM: number };
  const elegidos: Record<'delante' | 'detras', Elegido | null> = { delante: null, detras: null };
  const ahoraMs = ahora.getTime();

  for (const c of candidatos) {
    if (c.sesionId === miSesionId) continue;
    if (miVehiculoId !== undefined && c.vehiculoId === miVehiculoId) continue;
    if (ahoraMs - c.ultimoFixTs.getTime() > UMBRAL_VECINO_FRESCO_MS) continue;

    const { lado, distanciaM } = separacionCircular(
      yo.progresoM,
      c.progresoM,
      yo.largoM,
      yo.circular,
    );
    const mejor = elegidos[lado];
    if (
      !mejor ||
      distanciaM < mejor.distanciaM ||
      (distanciaM === mejor.distanciaM && c.ultimoFixTs > mejor.c.ultimoFixTs)
    ) {
      elegidos[lado] = { c, distanciaM };
    }
  }

  return {
    delante: elegidos.delante
      ? aVecino(elegidos.delante.c, elegidos.delante.distanciaM, ahora)
      : null,
    detras: elegidos.detras ? aVecino(elegidos.detras.c, elegidos.detras.distanciaM, ahora) : null,
  };
}

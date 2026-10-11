import { UMBRAL_VECINO_FRESCO_MS, type VecinoRuta } from '@quivo/shared';

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
  /** `ST_LineLocatePoint` del último fix del candidato sobre la ruta, en [0, 1]. */
  frac: number;
  ultimoFixTs: Date;
}

/** Valor cacheado por `(sindicatoId, rutaId)`. */
export interface EntradaRuta {
  /** Largo de la ruta en metros (`ST_Length` sobre geography). */
  largoM: number;
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

function aVecino(c: CandidatoVecino, miFrac: number, largoM: number, ahora: Date): VecinoRuta {
  return {
    placa: c.placa,
    numeroInterno: c.numeroInterno,
    tipo: c.tipo,
    marca: c.marca,
    modelo: c.modelo,
    color: c.color,
    colorSecundario: c.colorSecundario,
    distanciaM: Math.abs(c.frac - miFrac) * largoM,
    // Entero >= 0: un skew de reloj entre Postgres y Node no debe dar edad negativa.
    edadFixS: Math.max(0, Math.floor((ahora.getTime() - c.ultimoFixTs.getTime()) / 1000)),
  };
}

/**
 * Elige el vecino de adelante y el de atrás entre los candidatos de la ruta.
 *
 * - `delante`: el de MENOR `frac` estrictamente mayor que el mío.
 * - `detras`: el de MAYOR `frac` menor o IGUAL al mío. **Empate** (mismo `frac` que yo): se
 *   asigna a `detras` — convención arbitraria pero determinista, para que dos vehículos en
 *   el mismo punto no se muestren ambos "delante".
 * - Se excluye mi propia sesión y cualquier otra sesión de mi mismo vehículo.
 * - La frescura se evalúa AQUÍ contra `ahora` (no al armar el caché): una entrada cacheada
 *   sigue descartando a quien se volvió viejo dentro del TTL.
 *
 * Entre candidatos con idéntico `frac`, gana el de fix más reciente.
 */
export function seleccionarVecinos(
  miFrac: number,
  candidatos: readonly CandidatoVecino[],
  miSesionId: string,
  largoM: number,
  ahora: Date,
  miVehiculoId?: string,
): { delante: VecinoRuta | null; detras: VecinoRuta | null } {
  let delante: CandidatoVecino | null = null;
  let detras: CandidatoVecino | null = null;
  const ahoraMs = ahora.getTime();

  for (const c of candidatos) {
    if (c.sesionId === miSesionId) continue;
    if (miVehiculoId !== undefined && c.vehiculoId === miVehiculoId) continue;
    if (ahoraMs - c.ultimoFixTs.getTime() > UMBRAL_VECINO_FRESCO_MS) continue;

    if (c.frac > miFrac) {
      if (
        !delante ||
        c.frac < delante.frac ||
        (c.frac === delante.frac && c.ultimoFixTs > delante.ultimoFixTs)
      ) {
        delante = c;
      }
    } else if (
      !detras ||
      c.frac > detras.frac ||
      (c.frac === detras.frac && c.ultimoFixTs > detras.ultimoFixTs)
    ) {
      detras = c;
    }
  }

  return {
    delante: delante ? aVecino(delante, miFrac, largoM, ahora) : null,
    detras: detras ? aVecino(detras, miFrac, largoM, ahora) : null,
  };
}

/**
 * PRNG determinístico (mulberry32) para sembrar el historial de 24 h (recorridos, salidas,
 * novedades, sanciones) — `docs/plan-mock-guion-delegado.md`: "siembra determinística: una
 * PRNG chica tipo mulberry32 con una semilla constante". A propósito NO es `Math.random`: la
 * siembra tiene que dar SIEMPRE el mismo historial para el mismo `now` (mismo día), tanto en
 * tests como en `reiniciarDemo()`.
 */

/** Semilla fija del historial sembrado — cambiarla cambia TODO el historial generado (a
 * propósito arbitraria; no tiene significado más allá de "una constante fija"). */
export const SEMILLA_HISTORIAL = 0x5eed_f10c;

/** `() => number` en `[0, 1)`, con la misma firma que `Math.random` — mismo generador que
 * `elegirAleatorios`/`elegirTipoInfraccion` (`../estado.ts`, hoy `estado/index.ts`) esperan
 * como `rng` inyectable. */
export function mulberry32(semilla: number): () => number {
  let a = semilla >>> 0;
  return function siguiente(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Entero determinístico en `[min, max]` (inclusive) a partir de un `rng` en `[0,1)`. */
export function entreEnteros(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Hash chico y determinístico de un string a un entero 32-bit sin signo — usado por
 * `demanda.ts` para variar la demanda por parada sin depender de `estado` ni de un `rng`
 * externo (tiene que ser una función PURA de `(paradaId, hora)`, no puede leer semilla del
 * historial). */
export function hashString(valor: string): number {
  let h = 2166136261;
  for (let i = 0; i < valor.length; i++) {
    h ^= valor.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Ordena `items` cronológicamente por la fecha ISO que devuelve `fechaDe` — helper genérico
 * (ítem 11 del guion delegado, auditoría de "bad sort helper"): varios paths de siembra iteran
 * `TRUFIS_MOCK` como bucle EXTERNO y el tiempo como bucle INTERNO (`recorridos.ts#sembrarHistorial`,
 * por ejemplo), así que el array resultante queda agrupado POR VEHÍCULO, no en orden
 * cronológico — cualquier selector que asuma "el último del array = el más reciente"
 * (`estado/salidas.ts#proximaProgramadaDe` tenía justo ese bug) se rompe. No MUTA el array de
 * entrada. */
export function ordenarPorFecha<T>(items: T[], fechaDe: (item: T) => string): T[] {
  return [...items].sort((a, b) => Date.parse(fechaDe(a)) - Date.parse(fechaDe(b)));
}

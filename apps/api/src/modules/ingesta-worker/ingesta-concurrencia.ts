const CONCURRENCIA_POR_DEFECTO = 4;

/**
 * `INGESTA_WORKER_CONCURRENCY`: lotes que el worker procesa en paralelo (entero 1–16, default 4).
 * Lanza si el valor es inválido: el worker no debe arrancar con una configuración ambigua.
 */
export function leerConcurrenciaIngesta(valor: string | undefined): number {
  if (valor === undefined || valor.trim() === '') return CONCURRENCIA_POR_DEFECTO;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > 16) {
    throw new Error('INGESTA_WORKER_CONCURRENCY debe ser un entero entre 1 y 16');
  }
  return n;
}

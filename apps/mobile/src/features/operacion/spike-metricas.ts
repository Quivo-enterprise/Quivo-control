/**
 * Spike `ubicación fluida` (S1, `docs/plan-ubicacion-fluida.md`, Fase B): lógica pura del overlay
 * de métricas (`spike-metrics-overlay.tsx`) — separada del componente React para poder testearla
 * con `vitest` sin montar nada de RN.
 */

const MAX_MUESTRAS_CADENCIA = 20;

/**
 * Registra un timestamp nuevo (epoch ms) en la ventana deslizante de muestras — devuelve el
 * array actualizado (no muta `muestras`), acotado a las últimas `MAX_MUESTRAS_CADENCIA` para no
 * crecer sin límite durante un recorrido largo. Ignora timestamps no crecientes (fuera de orden o
 * repetidos) — no deberían pasar con `gps.puntos` (contador monótono), pero un guard barato evita
 * un delta negativo si algún día cambia la fuente.
 */
export function registrarMuestraCadencia(muestras: readonly number[], tsMs: number): number[] {
  const ultima = muestras[muestras.length - 1];
  if (ultima !== undefined && tsMs <= ultima) return [...muestras];
  const actualizado = [...muestras, tsMs];
  return actualizado.length > MAX_MUESTRAS_CADENCIA
    ? actualizado.slice(actualizado.length - MAX_MUESTRAS_CADENCIA)
    : actualizado;
}

/**
 * Cadencia media (ms) entre fixes consecutivos, a partir de una ventana de timestamps — `null`
 * con menos de dos muestras (no hay ningún intervalo que promediar todavía).
 */
export function calcularCadenciaMediaMs(muestras: readonly number[]): number | null {
  if (muestras.length < 2) return null;
  const deltas: number[] = [];
  for (let i = 1; i < muestras.length; i++) {
    const actual = muestras[i];
    const anterior = muestras[i - 1];
    if (actual === undefined || anterior === undefined) continue;
    deltas.push(actual - anterior);
  }
  const suma = deltas.reduce((acc, d) => acc + d, 0);
  return suma / deltas.length;
}

/** Formatea la cadencia para el overlay — `'—'` sin datos todavía, segundos con un decimal en
 * caso contrario (p. ej. "2.3s"). */
export function formatearCadencia(cadenciaMs: number | null): string {
  if (cadenciaMs === null) return '—';
  return `${(cadenciaMs / 1000).toFixed(1)}s`;
}

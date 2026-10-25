/** Cada cuánto el ticker de primer plano intenta correr el latido (ms). */
export const INTERVALO_LATIDO_PRIMER_PLANO_MS = 60_000;
/** Sin latido ni fix de evidencia en este margen, el tick corre. Menor que el intervalo, con holgura para el fix del propio latido. */
export const MARGEN_LATIDO_RECIENTE_MS = 50_000;

/**
 * `true` si el tick debe correr el latido: vehículo parado (sin fix de evidencia en los últimos
 * `MARGEN_LATIDO_RECIENTE_MS`) y ningún latido (SDK o ticker) en ese mismo margen.
 */
export function debeCorrerLatidoPrimerPlano(
  ahora: number,
  ultimoLatidoTs: number,
  ultimoFixTs: number,
): boolean {
  return (
    ahora - ultimoLatidoTs >= MARGEN_LATIDO_RECIENTE_MS &&
    ahora - ultimoFixTs >= MARGEN_LATIDO_RECIENTE_MS
  );
}

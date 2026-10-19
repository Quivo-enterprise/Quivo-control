export const INTERVALO_MIN_RUTA_MS = 15_000;
export const DISTANCIA_MIN_RUTA_M = 50;

/** Throttle de `GET /ruta-a-punto`: pide ruta si el destino cambió o el recorrido acaba de
 * iniciar; si no, solo cuando pasaron >=15 s Y el conductor se movió >=50 m desde el último
 * pedido (con un OR, posiciones a 1 Hz disparaban 4–10 req/min por conductor). */
export function debePedirRuta(args: {
  acabaDeIniciar: boolean;
  /** `null` si todavía no hubo ningún pedido. */
  anterior: { ts: number } | null;
  mismoDestino: boolean;
  ahoraMs: number;
  distanciaM: number;
}): boolean {
  const { acabaDeIniciar, anterior, mismoDestino, ahoraMs, distanciaM } = args;
  if (acabaDeIniciar || !anterior || !mismoDestino) return true;
  return ahoraMs - anterior.ts >= INTERVALO_MIN_RUTA_MS && distanciaM >= DISTANCIA_MIN_RUTA_M;
}

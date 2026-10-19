export const INTERVALO_MIN_RUTA_MS = 15_000;
export const DISTANCIA_MIN_RUTA_M = 50;

/** Throttle de `GET /ruta-a-punto`: pide ruta si el destino cambió o el recorrido acaba de
 * iniciar; si no, solo cuando pasaron >=15 s Y el conductor se movió >=50 m desde el último
 * pedido (con un OR, posiciones a 1 Hz disparaban 4–10 req/min por conductor). Si el último
 * pedido FALLÓ (red/timeout/5xx) reintenta pasados 15 s aunque el conductor esté quieto; una
 * respuesta exitosa sin ruta (OSRM apagado) no reintenta. */
export function debePedirRuta(args: {
  acabaDeIniciar: boolean;
  /** `null` si todavía no hubo ningún pedido. */
  anterior: { ts: number; fallo?: boolean } | null;
  mismoDestino: boolean;
  ahoraMs: number;
  distanciaM: number;
}): boolean {
  const { acabaDeIniciar, anterior, mismoDestino, ahoraMs, distanciaM } = args;
  if (acabaDeIniciar || !anterior || !mismoDestino) return true;
  const pasoElIntervalo = ahoraMs - anterior.ts >= INTERVALO_MIN_RUTA_MS;
  return pasoElIntervalo && (anterior.fallo === true || distanciaM >= DISTANCIA_MIN_RUTA_M);
}

/** La respuesta de un pedido de ruta se aplica solo si sigue siendo el último pedido y su
 * destino es el actual (la posición cambia a 1 Hz; no debe descartar pedidos en vuelo). */
export function respuestaRutaVigente(args: {
  idPedido: number;
  idUltimo: number;
  destinoPedido: [number, number];
  destinoActual: [number, number] | null;
}): boolean {
  const { idPedido, idUltimo, destinoPedido, destinoActual } = args;
  return (
    idPedido === idUltimo &&
    destinoActual !== null &&
    destinoActual[0] === destinoPedido[0] &&
    destinoActual[1] === destinoPedido[1]
  );
}

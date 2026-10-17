const UMBRAL_OBSOLETO_MS = 15_000;

/** `true` cuando pasaron más de 15 s desde el último fix aplicado (`ultimoFixTs`) — el
 * consumidor (Fase C) atenúa el marcador, como el punto gris de Google cuando pierde señal. */
export function estaObsoleto(ultimoFixTs: number, ahora: number): boolean {
  return ahora - ultimoFixTs > UMBRAL_OBSOLETO_MS;
}

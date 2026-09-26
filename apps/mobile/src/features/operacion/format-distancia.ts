export function formatearDistancia(metros: number): string {
  if (metros < 1000) return `${Math.round(metros)} m`;
  return `${(metros / 1000).toFixed(1)} km`;
}

/**
 * ENTREGA 5 (plan post-piloto 2026-09-09): formato para la voz de aproximación, NO para texto
 * en pantalla. Un conductor manejando escuchó ayer "a 104.58484945 metros" (8 decimales del
 * `Speech.speak` de `distanciaM` crudo) y, en el mejor caso post-fix ingenuo, "a 134 metros" —
 * la precisión sobra y se lee como un bug, no como una instrucción. Redondear a MÚLTIPLOS DE
 * 10 (no solo al entero, que ya hace `formatearDistancia`) antes de formatear: "a 130 metros"
 * suena a instrucción hablada real, con la imprecisión que un oyente humano ya da por sentada
 * en cualquier distancia estimada de viva voz. Reusa `formatearDistancia` para el resto del
 * formateo (unidad, corte a km) — solo cambia la granularidad del redondeo, y solo por debajo
 * de 1000 m (arriba, la app ya corta a un decimal de km, que es más grueso que 10 m).
 */
export function formatearDistanciaVoz(metros: number): string {
  const redondeadaADecenas = metros < 1000 ? Math.round(metros / 10) * 10 : metros;
  return formatearDistancia(redondeadaADecenas);
}

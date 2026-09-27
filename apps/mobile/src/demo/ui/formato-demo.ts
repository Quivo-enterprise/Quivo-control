/**
 * Formateo de texto de los indicadores adelante/atrás y del panel demo
 * (`docs/plan-apk-demo-conductor.md`, paso B) — es-BO: coma decimal, metros bajo 1000, km con un
 * decimal desde ahí. Deliberadamente SEPARADO de `../../features/operacion/format-distancia.ts`
 * (que usa punto decimal, formato "en" implícito de la pantalla real) — mezclar los dos formatos
 * en la misma pantalla, aunque sea solo en demo, sería peor que tener dos funciones chicas.
 */
export function formatearDistanciaVecinoDemo(metros: number): string {
  if (metros < 1000) return `${Math.round(metros)} m`;
  const km = (metros / 1000).toFixed(1).replace('.', ',');
  return `${km} km`;
}

/** `HH:MM` en 24h a partir de un epoch ms — usado por "En cola · sale 07:32". */
export function formatearHoraDemo(epochMs: number): string {
  const fecha = new Date(epochMs);
  const horas = String(fecha.getHours()).padStart(2, '0');
  const minutos = String(fecha.getMinutes()).padStart(2, '0');
  return `${horas}:${minutos}`;
}

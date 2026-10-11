/**
 * Reglas de negocio de los puntos de control en el mapa, extraídas a funciones puras (sin React
 * ni `react-native-maps`) para poder testearlas con `vitest`. Portadas de `renderizarPuntosControl`
 * del HTML de Leaflet que ya no existe (paridad: `isPassed`).
 */

export const COLOR_PUNTO_CONTROL = '#3127B1';
export const COLOR_PUNTO_CONTROL_COMPLETADO = '#22C55E';

/** Índice del próximo punto de control dentro de la lista, o `-1` si no hay próximo (`null`) o
 * el id no está en la lista. */
export function indiceProximoPuntoControl(
  ids: readonly string[],
  proximoPuntoControlId: string | null,
): number {
  if (!proximoPuntoControlId) return -1;
  return ids.indexOf(proximoPuntoControlId);
}

/**
 * `true` si el punto `idx` ya fue pasado: solo se marca con el recorrido en seguimiento
 * (`tracking`) y cuando el próximo punto no es el primero (`proximoIdx > 0`) — es decir, todos
 * los anteriores al próximo. Sin `tracking` ningún punto se marca nunca, por diseño: la ruta en
 * espera se muestra "virgen".
 */
export function esPuntoControlPasado(idx: number, proximoIdx: number, tracking: boolean): boolean {
  return tracking && proximoIdx > 0 && idx < proximoIdx;
}

/** Color de relleno del marcador numerado de un punto de control. */
export function colorPuntoControl(pasado: boolean): string {
  return pasado ? COLOR_PUNTO_CONTROL_COMPLETADO : COLOR_PUNTO_CONTROL;
}

/**
 * Fase del control principal de la pantalla de operación (release 13, feature A):
 * - `jornada`: el conductor todavía no declaró su día → botón EMPEZAR DÍA.
 * - `listo`: día declarado, sin recorrido en curso → botón COMENZAR RUTA.
 * - `recorrido`: hay un recorrido GPS activo → FINALIZAR RUTA.
 *
 * `tracking` manda: un recorrido re-enganchado sin declaración (sesiones de antes de esta
 * versión, o declaración perdida por reinstalación) debe mostrar FINALIZAR, nunca EMPEZAR DÍA.
 */
export type FaseControl = 'jornada' | 'listo' | 'recorrido';

export function faseControl(params: { jornadaIniciada: boolean; tracking: boolean }): FaseControl {
  if (params.tracking) return 'recorrido';
  return params.jornadaIniciada ? 'listo' : 'jornada';
}

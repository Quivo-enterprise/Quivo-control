/**
 * Reintento del registro propio del recorrido activo (`recorrido_actual`, ver
 * `db/recorrido-actual.ts`). Si `iniciarRecorridoActual` falla en `iniciar()`, sin este reintento
 * no habría recorrido registrado y la consulta de la vuelta actual (aviso de designación) quedaría
 * muerta todo el recorrido. Se reintenta con `asegurarRecorridoActual` (INSERT OR IGNORE por PK,
 * barato e idempotente) en cada `onLocation`/heartbeat mientras haya tracking activo en foreground.
 * El headless solo LEE el registro (no lo escribe), así que no reintenta.
 *
 * Parte pura: sin SQLite; la escritura real entra por `deps`.
 */

export interface EstadoRegistroRecorrido {
  /** `null`: ningún `iniciar()` real en este proceso (re-enganche): no hay nada que reintentar. */
  eventId: string | null;
  /** `true` una vez que el registro quedó escrito. */
  registrado: boolean;
}

export function crearEstadoRegistroRecorrido(): EstadoRegistroRecorrido {
  return { eventId: null, registrado: false };
}

/** Arranca un intento nuevo (`iniciar()`): fija el `eventId` del recorrido y resetea `registrado`. */
export function reiniciarEstadoRegistroRecorrido(
  estado: EstadoRegistroRecorrido,
  eventId: string,
): void {
  estado.eventId = eventId;
  estado.registrado = false;
}

export interface DependenciasRegistroRecorrido {
  asegurarRecorridoActual: (sesionId: string, recorridoId: string) => Promise<void>;
}

/** No-op si ya está registrado o no hubo `iniciar()`. Si la escritura rechaza, la excepción se
 * propaga (el llamador la reporta y el siguiente evento reintenta). */
export async function asegurarRegistroRecorrido(
  estado: EstadoRegistroRecorrido,
  deps: DependenciasRegistroRecorrido,
  sesionId: string,
): Promise<void> {
  if (estado.registrado || estado.eventId === null) return;
  await deps.asegurarRecorridoActual(sesionId, estado.eventId);
  estado.registrado = true;
}

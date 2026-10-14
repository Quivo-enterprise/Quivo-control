import { abrirPaqueteDiaDb } from './paquete-dia';

/**
 * Registro propio del recorrido ACTIVO de la sesión: una fila por `sesion_id` en la SQLite del
 * paquete del día (tabla `recorrido_actual`, creada en `abrirPaqueteDiaDbNueva`), junto a
 * `vuelta_actual_local`. Lo comparten foreground y headless.
 *
 * - `iniciar()` lo escribe con un id nuevo (`registrarRecorridoActual(..., true)`).
 * - `detener()` lo BORRA (`finalizarRecorridoActual`) antes de apagar `tracking`.
 * - El re-enganche (app reabierta con el tracking restaurado y sin fila) crea uno nuevo
 *   (`registrarRecorridoActual(..., false)`, que también reintenta un registro fallido).
 * - El headless solo lo lee.
 * Lectura por clave primaria, sin scans y sin depender del reloj del teléfono ni del outbox.
 */

export type LecturaRecorridoActual = { ok: true; recorridoId: string | null } | { ok: false };

/** `{ok:true, recorridoId:null}` = no hay recorrido activo. `{ok:false}` = la lectura falló: NO
 * equivale a "sin recorrido" (el llamador conserva el cache y no consulta en ese tick). */
export async function leerRecorridoActual(sesionId: string): Promise<LecturaRecorridoActual> {
  try {
    const db = await abrirPaqueteDiaDb();
    const fila = await db.getFirstAsync<{ recorrido_id: string }>(
      'SELECT recorrido_id FROM recorrido_actual WHERE sesion_id = ?',
      [sesionId],
    );
    return { ok: true, recorridoId: fila?.recorrido_id ?? null };
  } catch {
    return { ok: false };
  }
}

/** Escribe el registro de la sesión con UNA sola sentencia (sin `withTransactionAsync`: la
 * conexión del paquete es compartida con el flujo crítico de GPS/outbox y una transacción acá
 * podría barrer sus sentencias o chocar con las suyas; ver `progreso-vuelta-store.ts`). No limpia
 * filas de otras sesiones: la clave es por `sesion_id`, así que son inertes. `reemplazar: true` =
 * arranque (`iniciar()`): pisa el recorrido anterior (INSERT OR REPLACE). `false` = re-enganche o
 * reintento: crea la fila solo si no existe (INSERT OR IGNORE por PK, idempotente). */
export async function registrarRecorridoActual(
  sesionId: string,
  recorridoId: string,
  reemplazar: boolean,
): Promise<void> {
  const db = await abrirPaqueteDiaDb();
  const sentencia = reemplazar ? 'INSERT OR REPLACE' : 'INSERT OR IGNORE';
  await db.runAsync(
    `${sentencia} INTO recorrido_actual (sesion_id, recorrido_id, iniciado_en) VALUES (?, ?, ?)`,
    [sesionId, recorridoId, new Date().toISOString()],
  );
}

/** Fin del recorrido: borra el registro de la sesión. */
export async function finalizarRecorridoActual(sesionId: string): Promise<void> {
  const db = await abrirPaqueteDiaDb();
  await db.runAsync('DELETE FROM recorrido_actual WHERE sesion_id = ?', [sesionId]);
}

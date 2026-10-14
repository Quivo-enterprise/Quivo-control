import { esperarConTope } from '../vuelta-actual/espera-con-tope';

/**
 * Secuencia de arranque del cierre de un recorrido (`detener()` de `use-gps-operativo.ts`),
 * extraída para poder testear el ORDEN sin montar el hook:
 *
 * 1. esperar un `iniciar()` en vuelo (para que no reescriba el registro después de borrarlo);
 * 2. desarmar el reintento del registro (`suspenderRegistro`) y BORRAR el registro `recorrido_actual` — antes de cualquier await largo (`stop()` nativo) y
 *    antes de apagar `tracking`: así una consulta de la vuelta actual en vuelo no puede
 *    resucitar el cache tras "Finalizar";
 * 3. detener el nativo y sus suscripciones;
 * 4. apagar `tracking`.
 *
 * Si el cierre nativo falla (el tracking sigue activo), se restaura el estado del registro y el
 * error se propaga.
 *
 * Un fallo al borrar el registro se reporta pero NO impide cerrar el recorrido.
 */
export interface PasosCierreRecorrido {
  esperarIniciar: () => Promise<void>;
  /** Pone el estado de reintento del registro en "sin recorrido" (eventId null: los reintentos de
   * `onLocation`/heartbeat no hacen nada) y devuelve la función que lo restaura. */
  suspenderRegistro: () => () => void;
  borrarRegistro: () => Promise<void>;
  detenerNativo: () => Promise<void>;
  apagarTracking: () => void;
  reportar: (error: unknown) => void;
}

/** Tope de espera del borrado del registro: si la SQLite se traba, el cierre sigue igual. */
export const TOPE_BORRADO_REGISTRO_MS = 2000;

export async function cerrarRecorridoLocal(pasos: PasosCierreRecorrido): Promise<void> {
  await pasos.esperarIniciar();
  // Primero se desarma el reintento (si no, un onLocation/heartbeat podría reescribir la fila
  // mientras se cierra) y recién después se borra la fila.
  const restaurarRegistro = pasos.suspenderRegistro();
  // El borrado se espera con tope: si la DB se traba, el GPS nativo igual debe detenerse. La promesa
  // sigue corriendo; su rechazo (antes o después del tope) se reporta sin unhandled rejection.
  const borrado = pasos.borrarRegistro().catch((error: unknown) => pasos.reportar(error));
  const terminoAntesDelTope = await esperarConTope(borrado, TOPE_BORRADO_REGISTRO_MS);
  if (!terminoAntesDelTope) {
    pasos.reportar(
      new Error(`borrarRegistro no terminó en ${TOPE_BORRADO_REGISTRO_MS} ms; se continúa con el cierre del GPS nativo`),
    );
  }
  try {
    await pasos.detenerNativo();
  } catch (error) {
    // `stop()` falló: el tracking sigue activo, así que el recorrido sigue vigente y debe volver a
    // tener su registro (mismo id; el llamador lo reescribe en segundo plano).
    restaurarRegistro();
    throw error;
  }
  pasos.apagarTracking();
}

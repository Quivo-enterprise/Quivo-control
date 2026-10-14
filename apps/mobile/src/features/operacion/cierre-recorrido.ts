/**
 * Secuencia de arranque del cierre de un recorrido (`detener()` de `use-gps-operativo.ts`),
 * extraída para poder testear el ORDEN sin montar el hook:
 *
 * 1. esperar un `iniciar()` en vuelo (para que no reescriba el registro después de borrarlo);
 * 2. BORRAR el registro `recorrido_actual` — antes de cualquier await largo (`stop()` nativo) y
 *    antes de apagar `tracking`: así una consulta de la vuelta actual en vuelo no puede
 *    resucitar el cache tras "Finalizar";
 * 3. detener el nativo y sus suscripciones;
 * 4. apagar `tracking`.
 *
 * Un fallo al borrar el registro se reporta pero NO impide cerrar el recorrido.
 */
export interface PasosCierreRecorrido {
  esperarIniciar: () => Promise<void>;
  borrarRegistro: () => Promise<void>;
  detenerNativo: () => Promise<void>;
  apagarTracking: () => void;
  reportar: (error: unknown) => void;
}

export async function cerrarRecorridoLocal(pasos: PasosCierreRecorrido): Promise<void> {
  await pasos.esperarIniciar();
  try {
    await pasos.borrarRegistro();
  } catch (error) {
    pasos.reportar(error);
  }
  await pasos.detenerNativo();
  pasos.apagarTracking();
}

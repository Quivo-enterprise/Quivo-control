import { haversineMetros, type PuntoControlPaquete } from '@quivo/shared';

export interface DeteccionPuntoControl {
  puntoControlId: string;
  distanciaM: number;
  cumplido: boolean;
}

/**
 * Evalúa una posición contra todos los puntos de control de la ruta activa (RF-64..66,
 * QUI-239). La fuente de verdad auditada es el worker server-side (RF-39, `ST_DWithin`
 * contra `puntos_control.coord`, QUI-241) — esto es detección offline con feedback
 * inmediato al chofer; discrepancias entre lo que detecta la app y lo que valida el worker
 * quedan como observación (RNF-37), no se resuelven acá.
 */
export function detectarPuntosControlCercanos(
  posicion: [number, number],
  puntosControl: PuntoControlPaquete[],
): DeteccionPuntoControl[] {
  return puntosControl.map((pc) => {
    const distanciaM = haversineMetros(posicion, pc.coord.coordinates);
    return { puntoControlId: pc.id, distanciaM, cumplido: distanciaM <= pc.radioToleranciaM };
  });
}

/**
 * Clave con la que se recuerda un cumplimiento ya emitido. Va scopeada por sesión a
 * propósito: el Set del headless task vive a nivel de módulo del contexto JS headless
 * (`headless-task.ts`), que NO se reinicia al cambiar de sesión — sin el `sesionId` en la
 * clave, un punto de control registrado en la ruta A suprime para siempre el
 * `cumplimiento_punto_control` de la ruta B o del turno del día siguiente sobre la misma
 * ruta recurrente, y nada lo re-deriva server-side (el worker solo valida los eventos que
 * recibe): la evidencia de cumplimiento se perdería.
 */
export function claveCumplimiento(sesionId: string, puntoControlId: string): string {
  return `${sesionId}:${puntoControlId}`;
}

/** De todas las detecciones de este tick, cuáles son puntos de control recién cumplidos EN
 * ESTA SESIÓN — evita generar un evento nuevo en cada punto GPS mientras el vehículo
 * permanece parado dentro del radio de tolerancia de un mismo punto de control. */
export function filtrarNuevosCumplimientos(
  yaDetectados: ReadonlySet<string>,
  detecciones: DeteccionPuntoControl[],
  sesionId: string,
): DeteccionPuntoControl[] {
  return detecciones.filter(
    (d) => d.cumplido && !yaDetectados.has(claveCumplimiento(sesionId, d.puntoControlId)),
  );
}

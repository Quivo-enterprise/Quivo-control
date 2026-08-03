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

/** De todas las detecciones de este tick, cuáles son puntos de control recién cumplidos —
 * evita generar un evento nuevo en cada punto GPS mientras el vehículo permanece parado
 * dentro del radio de tolerancia de un mismo punto de control. */
export function filtrarNuevosCumplimientos(
  yaDetectados: ReadonlySet<string>,
  detecciones: DeteccionPuntoControl[],
): DeteccionPuntoControl[] {
  return detecciones.filter((d) => d.cumplido && !yaDetectados.has(d.puntoControlId));
}

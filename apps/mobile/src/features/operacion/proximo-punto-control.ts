import type { PuntoControlPaquete } from '@quivo/shared';

/** Cuál es el próximo punto de control pendiente (por `orden`, QUI-243) — módulo separado y
 * sin dependencias nativas para poder probarlo aislado (mismo criterio que `sync-diff.ts`). */
export function proximoPuntoControlPendiente(
  puntosControl: PuntoControlPaquete[],
  completados: ReadonlySet<string>,
): PuntoControlPaquete | null {
  const ordenados = [...puntosControl].sort((a, b) => a.orden - b.orden);
  return ordenados.find((pc) => !completados.has(pc.id)) ?? null;
}

/**
 * Siguiente estado del Set de "completados" tras una detección nueva (plan §2.5, "reset del
 * próximo punto por vuelta"): antes, `completados` solo crecía (nunca se limpiaba entre
 * vueltas), así que en cuanto se completaba la vuelta 1, `proximoPuntoControlPendiente` — que
 * solo sabe "¿ya vi este id alguna vez?", sin noción de vuelta — se quedaba sin ningún punto
 * pendiente el resto del día.
 *
 * Cuando el tamaño del Set alcanza el total de puntos de la ruta, la vuelta EN CURSO terminó:
 * se reinicia acá mismo para que la próxima detección (ya de la vuelta siguiente) vuelva a
 * apuntar al primer punto por `orden`, en vez de "sin próximo punto".
 *
 * Función PURA y separada del componente (mismo criterio que `proximoPuntoControlPendiente`
 * arriba) para poder probar la lógica de reset sin montar `operation-screen.tsx`. El caller
 * (`OperationScreen`) solo la invoca con `gps.ultimaDeteccion` — que ya viene filtrado por la
 * histéresis de `geofence.ts` (`filtrarNuevosCumplimientos`, multi-vuelta): solo dispara con
 * una pasada NUEVA de verdad, así que este reset nunca ocurre a mitad de una vuelta ni por
 * jitter/reentradas del mismo punto.
 */
export function completadosTrasDeteccion(
  actual: ReadonlySet<string>,
  puntoControlId: string,
  totalPuntosControl: number,
): Set<string> {
  const nuevo = new Set(actual);
  nuevo.add(puntoControlId);
  return totalPuntosControl > 0 && nuevo.size >= totalPuntosControl ? new Set() : nuevo;
}

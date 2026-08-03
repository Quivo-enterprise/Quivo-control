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

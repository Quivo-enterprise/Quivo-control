import type { DeteccionPuntoControl } from '../../gps/geofence';

/**
 * Identidad de la última confirmación mostrada en el toast (`ControlFeedbackToast`),
 * `{ puntoControlId, pasada }` — el mismo par que ya usa el dedupe del sonido de confirmación
 * (`ultimoSonado`, `gps-provider.tsx`). `pasada` siempre viene definida cuando `cumplido` es
 * `true`: todo emisor de una confirmación (`filtrarNuevosCumplimientos`/`confirmarVisitasVencidas`,
 * `geofence.ts`) la completa junto con `cumplido: true`.
 */
export interface IdentidadToastMostrado {
  puntoControlId: string;
  pasada: number;
}

/**
 * ENTREGA 9 (plan post-piloto 2026-09-09, "deduplicar el toast de confirmación", síntoma 11):
 * `control-feedback-toast.tsx` pusheaba a la cola cada vez que cambiaba la REFERENCIA de
 * `ultimaDeteccion`, sin deduplicar por `{puntoControlId, pasada}` — a diferencia de la voz y
 * el sonido, que sí deduplican. Extraída como función pura (sin ref/estado de React) para poder
 * testearla sin `renderHook` (el repo no lo tiene, ver `docs/plan-correccion-post-piloto-
 * 2026-09-09.md` Entrega 9).
 *
 * Decide si `nueva` debe encolarse un nuevo toast, comparando contra la identidad de la ÚLTIMA
 * detección ya encolada (`anterior`, o `null` si todavía no se encoló ninguna). Una pasada NUEVA
 * del mismo punto de control (multi-vuelta) siempre debe mostrarse — por eso se compara `pasada`
 * además de `puntoControlId`, no solo el primero.
 */
export function debeMostrarToast(
  anterior: IdentidadToastMostrado | null,
  nueva: DeteccionPuntoControl | null,
): boolean {
  if (!nueva || !nueva.cumplido) return false;
  // Ver el docblock de `IdentidadToastMostrado`: toda confirmación (`cumplido: true`) trae
  // `pasada` definida. Si por algún motivo no la trajera, no hay identidad estable para
  // deduplicar — no se bloquea el toast (fail-open, igual que el comportamiento previo a esta
  // entrega), pero tampoco se puede comparar de forma confiable.
  if (nueva.pasada === undefined) return true;
  if (!anterior) return true;
  return anterior.puntoControlId !== nueva.puntoControlId || anterior.pasada !== nueva.pasada;
}

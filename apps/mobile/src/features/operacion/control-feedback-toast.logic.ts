import type { DeteccionPuntoControl } from '../../gps/geofence';

/**
 * Identidad de la última confirmación mostrada en el toast (`ControlFeedbackToast`),
 * `{ puntoControlId, pasada }` — el mismo par que ya usa el dedupe del sonido de confirmación
 * (`ultimoSonado`, `gps-provider.tsx`). `pasada` viene definida cuando `cumplido` es `true` en
 * las detecciones que efectivamente llegan a `ultimaDeteccion`: las emite
 * `filtrarNuevosCumplimientos`/`confirmarVisitasVencidas` (`geofence.ts`), que la completan
 * junto con `cumplido: true`. OJO: eso NO es cierto para toda `DeteccionPuntoControl` con
 * `cumplido: true` en general — `detectarPuntosControlCercanos` (chequeo crudo de proximidad,
 * `geofence.ts`) también pone `cumplido: distanciaM <= radio` sin `pasada`, simplemente esa
 * forma cruda no llega hoy a este componente. Ver el fallback fail-open en `debeMostrarToast`.
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

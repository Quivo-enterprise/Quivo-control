/**
 * Decide qué hacer al volver a primer plano cuando el estado React `tracking` (botón
 * "Comenzar"/"Finalizar") puede haberse desincronizado del plugin nativo. Pura: sin React ni SDK.
 *
 * - `reenganchar`: el nativo graba pero la UI muestra "Comenzar" → re-enganchar sin
 *   `inicio_recorrido` nuevo (QUI-247).
 * - `nativo-detenido`: la UI muestra "Finalizar" pero el nativo está parado → solo se reporta;
 *   "Finalizar" sigue funcionando sobre un plugin detenido.
 * - Con un `iniciar()`/`detener()` en vuelo no se toca nada: el estado está en transición.
 */
export type DecisionReconciliacionTracking = 'reenganchar' | 'nativo-detenido' | 'nada';

export function decidirReconciliacionTracking(entrada: {
  nativoActivo: boolean;
  tracking: boolean;
  operacionEnVuelo: boolean;
}): DecisionReconciliacionTracking {
  if (entrada.operacionEnVuelo) return 'nada';
  if (entrada.nativoActivo && !entrada.tracking) return 'reenganchar';
  if (!entrada.nativoActivo && entrada.tracking) return 'nativo-detenido';
  return 'nada';
}

/**
 * ¿Sigue vigente una reconciliación/re-enganche? Compara la generación capturada al empezar con
 * la actual (se incrementa en cada `iniciar()`/`detener()`): el contador de operaciones en vuelo
 * solo no alcanza (ABA: una operación que empieza y termina durante el `await` lo deja en 0).
 */
export function reconciliacionVigente(entrada: {
  montado: boolean;
  generacionCapturada: number;
  generacionActual: number;
  operacionesEnVuelo: number;
}): boolean {
  return (
    entrada.montado &&
    entrada.generacionCapturada === entrada.generacionActual &&
    entrada.operacionesEnVuelo === 0
  );
}

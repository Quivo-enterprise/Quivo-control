/**
 * G2 (merge post-drenado, Entrega 31a — gap de revisión sobre esta misma entrega): decide qué
 * deben terminar valiendo `tracking`/`errorGps` a la salida de `iniciar()`
 * (`use-gps-operativo.ts`), a partir de si el tracking NATIVO
 * (`BackgroundGeolocation.ready()` + `iniciarSeguimientoContinuo`, `gps/seguimiento-continuo.ts`)
 * tuvo éxito y, solo si lo tuvo, si el pipeline LOCAL (semilla + outbox + `inicio_recorrido`)
 * también.
 *
 * Antes de este fix, `tracking` solo se marcaba `true` DESPUÉS de que el outbox local
 * terminara con éxito — si el nativo arrancaba bien pero el outbox fallaba (SQLite sin
 * espacio en disco, handle zombi de `expo-sqlite`), `tracking` se quedaba en `false` PARA
 * SIEMPRE, aunque el SDK siguiera grabando de verdad en su propia base nativa (`persist:
 * true`). `next-control-sheet.tsx` solo ofrece "COMENZAR RUTA" cuando `tracking` es `false` —
 * nunca "FINALIZAR RUTA" — así que el chofer quedaba sin ninguna forma de cerrar un recorrido
 * que sí estaba grabando evidencia GPS.
 *
 * INVARIANTE CENTRAL que esta función encierra (y que el test cubre explícitamente): si el
 * nativo arrancó (`nativoOk: true`), `tracking` es SIEMPRE `true`, sin importar el resultado
 * del outbox — el estado de almacenamiento local se comunica aparte, por `errorGps`, y nunca
 * pisa `tracking`.
 *
 * Pura (sin React, sin el SDK de Transistorsoft, sin SQLite): la orquestación real —qué
 * llamada produce cada booleano, remover suscripciones, reportar a Sentry— sigue viviendo en
 * `use-gps-operativo.ts`; esta función es solo la decisión, testeada aparte sin levantar el
 * hook completo (mismo criterio que las funciones puras de `gps/seguimiento-continuo.ts`).
 */
export interface ResultadoIniciarRecorrido {
  tracking: boolean;
  errorGps: string | null;
}

/** Plan §2.4.4: el nativo (permiso/servicio ya en orden) no pudo arrancar — licencia del
 * plugin, Google Play Services. No hay nada grabándose todavía. */
export const MENSAJE_ERROR_NATIVO =
  'No se pudo activar el GPS en este momento. Volvé a tocar "Iniciar recorrido" para reintentar.';

/** G2: el nativo YA está grabando — este mensaje es de ALMACENAMIENTO local, nunca implica que
 * el recorrido no arrancó. */
export const MENSAJE_ERROR_OUTBOX =
  'El GPS ya está grabando en el dispositivo, pero no se pudo abrir el almacenamiento local. Si persiste, revisa el espacio disponible.';

export function resolverResultadoIniciar(
  nativoOk: boolean,
  outboxOk: boolean,
): ResultadoIniciarRecorrido {
  if (!nativoOk) {
    return { tracking: false, errorGps: MENSAJE_ERROR_NATIVO };
  }
  if (!outboxOk) {
    return { tracking: true, errorGps: MENSAJE_ERROR_OUTBOX };
  }
  return { tracking: true, errorGps: null };
}

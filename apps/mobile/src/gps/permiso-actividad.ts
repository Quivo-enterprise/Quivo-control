/**
 * QUI-P0 (la flecha no se mueve en el mapa): `ACTIVITY_RECOGNITION` es el permiso "dangerous"
 * que Android 10+ (API 29+) exige en runtime para que el SDK pueda usar el Activity Recognition
 * System (acelerómetro + fusión de sensores) al decidir cuándo el dispositivo pasó de
 * estacionario a en-movimiento. Diagnóstico confirmado en Sentry (Samsung Galaxy A71, Android
 * 13): `ACTIVITY_RECOGNITION: not_granted` — y NO podía concederse nunca, porque el permiso ni
 * siquiera estaba declarado en el manifest (`app.config.ts`, antes de este fix). Sin él, el SDK
 * cae a una geocerca estacionaria de 200-500 m (`disableMotionActivityUpdates` en la doc del
 * SDK) — mucho más lenta para detectar que el vehículo arrancó.
 *
 * Este permiso es FAIL-OPEN a propósito (ver `use-gps-operativo.ts`, `iniciar()`): si el
 * conductor lo deniega, el recorrido igual tiene que arrancar y seguir moviéndose — para eso
 * están `changePace(true)` + `disableStopDetection: true` (`seguimiento-continuo.ts`), que no
 * dependen de este permiso. `ACTIVITY_RECOGNITION` solo hace la detección de movimiento MÁS
 * RÁPIDA/RESPONSIVA cuando está concedido, nunca es un requisito para que el tracking funcione.
 *
 * Funciones puras (sin `PermissionsAndroid` ni `Platform` de React Native): la decisión de SI
 * corresponde pedir el permiso y el mapeo del resultado crudo a los tres estados que expone el
 * hook, testeables en Node/vitest — mismo patrón que `permiso-ubicacion.ts`. El pedido en sí
 * (efecto de lado real, `PermissionsAndroid.request(...)`) vive en `use-gps-operativo.ts`.
 */

/** Estado expuesto por el hook para el preflight de la Entrega 26 (QUI-338 continuación) — esta
 * entrega NO construye esa UI, solo deja el dato disponible. `no_solicitado` es el estado
 * inicial y también el que queda si `debeSolicitarPermisoActividad` decide no pedirlo (iOS, o
 * Android < 10). */
export type EstadoPermisoActividad = 'concedido' | 'denegado' | 'no_solicitado';

/**
 * Solo Android 10+ (API 29, donde `ACTIVITY_RECOGNITION` pasó a ser "dangerous" y requiere
 * pedido explícito en runtime) — en versiones previas el permiso se concede solo por estar
 * declarado en el manifest, pedirlo en runtime ahí no hace nada y solo agrega una espera
 * innecesaria antes de "Iniciar recorrido". iOS no tiene este permiso (su equivalente, "Motion &
 * Fitness", lo gestiona el propio módulo nativo del SDK vía `disableMotionActivityUpdates`, sin
 * intervención de esta capa JS) — la app hoy solo builds para Android (`app.config.ts`,
 * `platforms: ['android']`), pero esta función modela ambas plataformas por la misma razón que
 * `permiso-ubicacion.ts`: es el único lugar que decide esto, no debe asumir la plataforma actual.
 */
export function debeSolicitarPermisoActividad(plataforma: 'android' | 'ios', sdkInt: number): boolean {
  return plataforma === 'android' && sdkInt >= 29;
}

/**
 * `PermissionsAndroid.request(...)` (RN 0.81.5, `PermissionsAndroid.js`) resuelve a
 * `'granted' | 'denied' | 'never_ask_again'`. Los dos últimos son el mismo resultado práctico
 * para este flujo fail-open (no hay ninguna acción distinta que ofrecerle al conductor por
 * "nunca más preguntar" — a diferencia del permiso de ubicación, este no bloquea nada), así que
 * se fusionan en `denegado`.
 */
export function estadoPermisoActividadDesde(
  resultado: 'granted' | 'denied' | 'never_ask_again' | string,
): EstadoPermisoActividad {
  return resultado === 'granted' ? 'concedido' : 'denegado';
}

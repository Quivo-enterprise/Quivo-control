/**
 * Shim tipado de `BackgroundGeolocation.watchPosition`.
 *
 * Los tipos instalados (`@transistorsoft/background-geolocation-types@5.2.2/dist/core/api/
 * BackgroundGeolocation.d.ts:89`) declaran `watchPosition(options, locationCallback,
 * errorCallback?): Subscription` (síncrono), pero el runtime (`react-native-background-
 * geolocation@5.4.0`, `src/NativeModule.js:289`) es `static async watchPosition` y devuelve
 * `Promise<{id, remove}>`. Este es el ÚNICO lugar con el cast que reconcilia ambos.
 *
 * Sin `errorCallback` a propósito: el runtime 5.4.0 nunca lo llama (acepta `failure` pero no lo
 * usa); los fallos nativos llegan como RECHAZO de la promesa. Quien llama debe manejar el rechazo.
 */
import BackgroundGeolocation, { type Location } from 'react-native-background-geolocation';

type OpcionesWatch = Parameters<typeof BackgroundGeolocation.watchPosition>[0];

export function watchPositionAsync(
  options: OpcionesWatch,
  onLocation: (location: Location) => void,
): Promise<{ id?: number; remove: () => void }> {
  // `Promise.resolve` normaliza también un mock/versión que devuelva la Subscription sincrónica.
  return Promise.resolve(
    BackgroundGeolocation.watchPosition(options, onLocation) as unknown as
      | { id?: number; remove: () => void }
      | Promise<{ id?: number; remove: () => void }>,
  );
}

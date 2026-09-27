import type { Location } from 'react-native-background-geolocation';
import type { FixVisual } from './tipos';

/**
 * Convierte un `Location` real del SDK de Transistorsoft al `FixVisual` reducido que consume el
 * núcleo de movimiento (`rumbo.ts`, `reducer.ts`). Campos verificados contra el `.d.ts` instalado
 * (`node_modules/.pnpm/@transistorsoft+background-geolocation-types@5.2.2/node_modules/
 * @transistorsoft/background-geolocation-types/dist/core/events/Location.d.ts`, interfaz
 * `Coords`): `heading`/`heading_accuracy`/`speed` son "Only present when location came from GPS.
 * -1 otherwise" — nunca `undefined` en la práctica, pero igual se cubre el caso (mismo criterio
 * que `velocidadKmhDesde` en `use-gps-operativo.ts`: los datos cruzan el bridge nativo y el
 * `.d.ts` no garantiza que todos los dispositivos lo respeten).
 */
export function fixVisualDesdeLocation(location: Location): FixVisual {
  const ts = new Date(location.timestamp).getTime();
  return {
    lat: location.coords.latitude,
    lng: location.coords.longitude,
    ts: Number.isNaN(ts) ? Date.now() : ts,
    speed: typeof location.coords.speed === 'number' ? location.coords.speed : -1,
    heading: typeof location.coords.heading === 'number' ? location.coords.heading : -1,
    headingAccuracy:
      typeof location.coords.heading_accuracy === 'number'
        ? location.coords.heading_accuracy
        : undefined,
    accuracy: typeof location.coords.accuracy === 'number' ? location.coords.accuracy : 0,
  };
}

/**
 * `true` cuando el fix viene del canal visual (`BackgroundGeolocation.watchPosition({extras:
 * {fuente:'visual'}})`, `use-gps-operativo.ts`), no de la suscripción de evidencia (`onLocation`,
 * `distanceFilter: 15`). Extraída a función pura porque testear el hook completo (`useGpsOperativo`)
 * no es viable con la infraestructura de test actual del proyecto (no hay mocks de
 * `react-native-background-geolocation` ni de las suscripciones nativas) — este es el único
 * lugar que decide "¿es un fix visual?", y `onLocation` solo lo consulta.
 *
 * `Location.extras` tipa como `Extras` (`types.d.ts:162`,
 * `{[key: string]: string|null|number|boolean|Extras|...}`) — cualquier valor ahí es dato
 * arbitrario adjuntado por quien pidió el fix (acá, `watchPosition`), nunca algo que el SDK
 * garantice por su cuenta.
 */
export function esFixVisual(location: Pick<Location, 'extras'>): boolean {
  return location.extras?.fuente === 'visual';
}

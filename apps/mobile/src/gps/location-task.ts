import type { Location } from 'react-native-background-geolocation';
import type { PuntoControlPaquete, TipoEventoSync } from '@quivo/shared';
import {
  detectarPuntosControlCercanos,
  filtrarNuevosCumplimientos,
  type DeteccionPuntoControl,
} from './geofence';

/**
 * Lógica pura de construcción de eventos a partir de un punto GPS (QUI-216, RF-67..73): sin
 * dependencias de React ni de módulos nativos (SQLite/SecureStore), por eso es testeable en
 * Node/vitest igual que `geofence.ts` y `battery-gap-monitor.ts`.
 *
 * Existe como módulo separado de `headless-task.ts` porque este último SÍ importa código
 * nativo (`expo-sqlite`, `expo-secure-store` vía `db/outbox.ts` y `sesion-movil-store.ts`) y
 * eso rompe la carga de módulos bajo vitest/Node (falla con `SyntaxError: Unexpected token
 * 'export'` al intentar transformar esos paquetes) — separar la parte pura evita ese
 * problema sin tener que mockear nada.
 *
 * Este mismo módulo alimenta los dos caminos que necesitan procesar un punto GPS:
 * - `useGpsOperativo` (`use-gps-operativo.ts`), cuando la app está viva y React corre.
 * - el headless task de Transistorsoft (`headless-task.ts` + registro en `index.js`), cuando
 *   la app fue terminada por el usuario o el sistema y NO hay árbol de React ni hooks.
 */

/** Estado operativo que el registro de un punto necesita — en la app viva viene de React
 * (props/hooks); en el headless task se reconstruye leyendo el almacenamiento persistente
 * del dispositivo (ver `obtenerContextoUbicacionPersistido` en `headless-task.ts`). */
export interface ContextoUbicacion {
  deviceId: string;
  sesionId: string;
  puntosControl: PuntoControlPaquete[];
}

/** Evento listo para encolar en el outbox — todavía sin persistir; `registrarPuntoGps`
 * (`headless-task.ts`) es quien hace el `encolarEvento` real. */
export interface EventoUbicacionConstruido {
  tipo: TipoEventoSync;
  payload: Record<string, unknown>;
}

export interface ResultadoConstruirEventos {
  eventos: EventoUbicacionConstruido[];
  /** Último punto de control recién cumplido en este tick, o `null` si no hubo ninguno —
   * lo usa `useGpsOperativo` para disparar el aviso por voz (`gps-provider.tsx`). El
   * headless task lo ignora: sin React no hay UI ni `expo-speech` a la que avisar. */
  deteccion: DeteccionPuntoControl | null;
}

/**
 * Construye los eventos de outbox correspondientes a un punto GPS: siempre un `gps_point`
 * (criterio C del spike — la evidencia legal, RF-67..73) y, si el punto cae dentro del radio
 * de algún punto de control aún no detectado en esta sesión, un `cumplimiento_punto_control`
 * adicional (RF-64..66). Muta `puntosControlDetectados` en el sitio para registrar lo
 * detectado — el caller decide de dónde viene ese Set (ver comentario de `ContextoUbicacion`).
 */
export function construirEventosDeUbicacion(
  location: Location,
  contexto: ContextoUbicacion,
  puntosControlDetectados: Set<string>,
): ResultadoConstruirEventos {
  const eventos: EventoUbicacionConstruido[] = [
    {
      tipo: 'gps_point',
      payload: {
        sesionId: contexto.sesionId,
        lat: location.coords.latitude,
        lng: location.coords.longitude,
        accuracy: location.coords.accuracy,
        speed: location.coords.speed,
      },
    },
  ];

  let deteccion: DeteccionPuntoControl | null = null;
  if (contexto.puntosControl.length > 0) {
    const posicion: [number, number] = [location.coords.longitude, location.coords.latitude];
    const detecciones = detectarPuntosControlCercanos(posicion, contexto.puntosControl);
    const nuevos = filtrarNuevosCumplimientos(puntosControlDetectados, detecciones);

    for (const nuevaDeteccion of nuevos) {
      puntosControlDetectados.add(nuevaDeteccion.puntoControlId);
      deteccion = nuevaDeteccion;
      eventos.push({
        tipo: 'cumplimiento_punto_control',
        payload: {
          sesionId: contexto.sesionId,
          puntoControlId: nuevaDeteccion.puntoControlId,
          // lat/lng de la posición que disparó la detección — el worker (QUI-241) necesita
          // la coordenada real para re-validar server-side (ST_DWithin, fuente de verdad
          // RF-39), no solo confiar en `distanciaM` autoreportada.
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          distanciaM: nuevaDeteccion.distanciaM,
          validadoPor: 'app',
        },
      });
    }
  }

  return { eventos, deteccion };
}

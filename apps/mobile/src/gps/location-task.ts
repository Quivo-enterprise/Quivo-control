import type { Location } from 'react-native-background-geolocation';
import type { PuntoControlPaquete, TipoEventoSync } from '@quivo/shared';
import {
  claveCumplimiento,
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
 * Normaliza `location.timestamp` a ISO-8601 con offset — la forma que exigen
 * `PayloadGpsPointSchema.tsFix` / `PayloadCumplimientoPuntoControlSchema.tsFix`
 * (`@quivo/shared`, `z.string().datetime({ offset: true })`).
 *
 * Transistorsoft v4 tipaba `Location.timestamp` como `string` a secas; v5 lo ensanchó a
 * `string | number` (epoch ms en el caso numérico — ver
 * `@transistorsoft/background-geolocation-types`, `Location.d.ts`). Antes de este fix el
 * valor se pasaba tal cual al payload: compilaba igual porque
 * `EventoUbicacionConstruido.payload` es `Record<string, unknown>`, pero un epoch numérico
 * (o cualquier string no-ISO) pierde el `.datetime()` de Zod en `resolverTsFix`
 * (`packages/shared/src/sync/evento.ts`), que cae EN SILENCIO al `ts` de encolado del
 * sobre — exactamente la deformación del recorrido por buffering headless que `tsFix`
 * existe para evitar (hallazgo de revisión).
 *
 * Devuelve `undefined` (nunca `"Invalid Date"`) ante un timestamp ilegible: `tsFix` ya es
 * opcional en el schema, así que un fix inválido cae al mismo camino de retrocompatibilidad
 * que un evento viejo sin `tsFix`, en vez de fabricar una fecha basura que además pasaría el
 * `safeParse` de Zod (`"Invalid Date"` no es ISO válido, pero mejor no arriesgarlo).
 */
function normalizarTsFix(timestamp: Location['timestamp']): string | undefined {
  const fecha = new Date(timestamp);
  return Number.isNaN(fecha.getTime()) ? undefined : fecha.toISOString();
}

/**
 * Construye los eventos de outbox correspondientes a un punto GPS: siempre un `gps_point`
 * (criterio C del spike — la evidencia legal, RF-67..73) y, si el punto cae dentro del radio
 * de algún punto de control aún no detectado en esta sesión, un `cumplimiento_punto_control`
 * adicional (RF-64..66). Muta `puntosControlDetectados` en el sitio para registrar lo
 * detectado — el caller decide de dónde viene ese Set (ver comentario de `ContextoUbicacion`).
 * Las claves de ese Set van scopeadas por sesión (`claveCumplimiento`, ver `geofence.ts`).
 */
export function construirEventosDeUbicacion(
  location: Location,
  contexto: ContextoUbicacion,
  puntosControlDetectados: Set<string>,
): ResultadoConstruirEventos {
  // Normalizado UNA sola vez: `gps_point` y, si aplica, `cumplimiento_punto_control` vienen
  // de la misma `location` — ver `normalizarTsFix` arriba para el porqué (v5 ensanchó
  // `Location.timestamp` a `string | number`).
  const tsFix = normalizarTsFix(location.timestamp);
  const eventos: EventoUbicacionConstruido[] = [
    {
      tipo: 'gps_point',
      payload: {
        sesionId: contexto.sesionId,
        lat: location.coords.latitude,
        lng: location.coords.longitude,
        accuracy: location.coords.accuracy,
        speed: location.coords.speed,
        // Timestamp del FIX GPS, no el del encolado: el sobre del outbox se sella con
        // `new Date()` en `encolarEvento`, y en el camino headless (app terminada) el SDK
        // entrega ubicaciones bufferadas en ráfaga al salir de Doze — sin esto, un tramo
        // entero de manejo se persistiría con timestamps casi idénticos y el recorrido
        // reconstruido quedaría deformado. Contrato + fallback: `PayloadGpsPointSchema` /
        // `resolverTsFix` en `@quivo/shared`.
        tsFix,
      },
    },
  ];

  let deteccion: DeteccionPuntoControl | null = null;
  if (contexto.puntosControl.length > 0) {
    const posicion: [number, number] = [location.coords.longitude, location.coords.latitude];
    const detecciones = detectarPuntosControlCercanos(posicion, contexto.puntosControl);
    const nuevos = filtrarNuevosCumplimientos(
      puntosControlDetectados,
      detecciones,
      contexto.sesionId,
    );

    for (const nuevaDeteccion of nuevos) {
      puntosControlDetectados.add(
        claveCumplimiento(contexto.sesionId, nuevaDeteccion.puntoControlId),
      );
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
          // Mismo timestamp del fix GPS que dispara el `gps_point` de más arriba — misma
          // `location`, mismo defecto de buffering headless. Acá pesa más: la hora de paso
          // por este punto de control es el hecho que sustenta una sanción (RF-64..66).
          // Contrato + fallback: `PayloadCumplimientoPuntoControlSchema` / `resolverTsFix`
          // en `@quivo/shared`.
          tsFix,
        },
      });
    }
  }

  return { eventos, deteccion };
}

/**
 * Reconstruye las claves de cumplimiento ya emitidas a partir de los payloads que siguen en
 * el outbox local. Sirve para SEMBRAR el Set del headless task en su primer tick: scopear la
 * clave por sesión evita que un cumplimiento de la ruta A suprima el de la ruta B, pero no
 * cubre el otro lado del mismo problema — si Android recicla el contexto JS headless a mitad
 * de turno, el Set arranca vacío y el mismo `(sesionId, puntoControlId)` se vuelve a emitir
 * con un `eventId` nuevo. El worker deduplica `cumplimientos_pc` por `eventId` solamente
 * (`skipDuplicates`, `ingesta-worker.service.ts`), así que esa re-emisión SÍ crea una
 * segunda fila para el mismo punto de control — no es inofensiva.
 *
 * Es best-effort a propósito: si el outbox ya purgó los eventos acusados (`purgarAcusadosAntesDe`)
 * la semilla queda incompleta y se puede repetir un cumplimiento. Sigue siendo estrictamente
 * mejor que arrancar siempre vacío, y nunca suprime evidencia de una sesión distinta.
 */
export function clavesCumplimientoDesdePayloads(payloads: Record<string, unknown>[]): Set<string> {
  const claves = new Set<string>();
  for (const payload of payloads) {
    const sesionId = payload['sesionId'];
    const puntoControlId = payload['puntoControlId'];
    if (typeof sesionId === 'string' && typeof puntoControlId === 'string') {
      claves.add(claveCumplimiento(sesionId, puntoControlId));
    }
  }
  return claves;
}

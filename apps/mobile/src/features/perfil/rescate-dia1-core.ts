import type { Location } from 'react-native-background-geolocation';
import { generarUuidV7 } from '@quivo/shared';
import { normalizarTsFix } from '../../gps/location-task';

/**
 * Parte PURA del rescate de emergencia del día 1 (ver `rescate-dia1.ts` para el porqué del
 * rescate en sí): sin `expo-crypto`, `expo-sqlite`, `expo-secure-store` ni
 * `react-native-background-geolocation` en runtime (solo un `import type` de `Location`, que
 * se borra al compilar) — mismo motivo que `gps/location-task.ts` existe separado de
 * `gps/headless-task.ts`: esos módulos nativos rompen la carga bajo vitest/Node
 * (`SyntaxError: Unexpected token 'export'`), así que la parte testeable vive acá.
 *
 * `Sha256Hex` es inyectable a propósito: la implementación real (`rescate-dia1.ts`) usa
 * `expo-crypto`, pero los tests de este módulo pueden pasar el SHA-256 de `node:crypto` — es
 * el MISMO algoritmo estándar, así que el digest de bytes (y por lo tanto el `eventId`
 * derivado) es idéntico sin importar quién lo calcule.
 */
export type Sha256Hex = (input: string) => Promise<string>;

/** Primeros 10 bytes de un digest hex (SHA-256 = 64 chars hex, se descartan los 22 restantes)
 * — `generarUuidV7` solo necesita 10 bytes de "aleatoriedad". */
function primeros10BytesDeHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(10);
  for (let i = 0; i < 10; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * `eventId` determinístico para un punto rescatado (H1.a, hallazgo de revisión CRÍTICO):
 * `BackgroundGeolocation.getLocations()` devuelve TODO lo que el SDK nativo tiene persistido,
 * sin ningún filtro de "ya sincronizado" — un re-run del rescate (segunda corrida a mano,
 * timeout, crash a mitad de camino) volvía a acuñar un `eventId` UUIDv7 NUEVO por cada punto
 * (`encolarEvento` generaba uno con `Crypto.getRandomBytesAsync`), y el dedupe del servidor
 * (`ON CONFLICT (event_id, ts)`, `ingesta-worker.service.ts`) no tenía forma de reconocer que
 * era el mismo punto GPS: cada re-run duplicaba TODO en `gps_points`, que es evidencia legal
 * (RF-67..73).
 *
 * En vez de aleatoriedad nueva, derivamos el `eventId` de `location.uuid` — la identidad
 * ESTABLE que el propio SDK nativo le asigna a cada fix, que no cambia entre llamadas
 * sucesivas a `getLocations()` — así que el MISMO punto produce SIEMPRE el MISMO `eventId`, y
 * el `ON CONFLICT` del servidor lo descarta solo en un re-run.
 */
export async function derivarEventIdRescate(
  location: Pick<Location, 'uuid' | 'timestamp'>,
  sha256Hex: Sha256Hex,
): Promise<string> {
  const digestHex = await sha256Hex(location.uuid);
  const bytes = primeros10BytesDeHex(digestHex);
  return generarUuidV7(bytes, new Date(location.timestamp));
}

export interface EventoRescatado {
  eventId: string;
  tipo: 'gps_point';
  payload: Record<string, unknown>;
}

/**
 * Arma el evento `gps_point` para un punto rescatado, o `null` si el timestamp es ilegible.
 *
 * H6 (hallazgo de revisión, medio): antes, un timestamp ilegible caía en silencio al `ts` del
 * SOBRE (el momento del `encolarEvento`) — que en un rescate es el momento en que se corrió el
 * rescate, no el del fix real. Ese punto aterrizaba en `gps_points` con la fecha de HOY, en la
 * partición equivocada, deformando el `ORDER BY ts` del recorrido reconstruido. Mejor NO
 * encolar ese punto (el caller lo cuenta aparte, en `fallidos`) que encolarlo con una fecha
 * inventada.
 */
export async function construirEventoRescatado(
  location: Location,
  sesionId: string,
  sha256Hex: Sha256Hex,
): Promise<EventoRescatado | null> {
  const tsFix = normalizarTsFix(location.timestamp);
  if (tsFix === undefined) return null;

  const eventId = await derivarEventIdRescate(location, sha256Hex);
  return {
    eventId,
    tipo: 'gps_point',
    payload: {
      sesionId,
      lat: location.coords.latitude,
      lng: location.coords.longitude,
      accuracy: location.coords.accuracy ?? null,
      speed: location.coords.speed ?? null,
      tsFix,
    },
  };
}

/**
 * H1.b (hallazgo de revisión CRÍTICO): solo deja pasar los puntos ANTERIORES al momento en que
 * este build empezó a funcionar (`corte`). Los puntos posteriores ya los encoló el camino
 * normal (`onLocation`/headless, `use-gps-operativo.ts`/`headless-task.ts`), ahora que el
 * outbox anda — re-encolarlos acá sería trabajo redundante que H1.a/H1.c igual absorberían,
 * pero es más simple y más barato no intentarlo.
 *
 * `corte === null` (la clave de `AsyncStorage` todavía no se sembró — caso raro, ver
 * `sembrarPrimerArranqueRescate` en `rescate-dia1.ts`) no filtra nada: dejamos que las otras
 * dos defensas (`eventId` determinístico + confirmación explícita) hagan su trabajo solas.
 */
export function filtrarPuntosRescatables(locations: Location[], corte: Date | null): Location[] {
  if (corte === null) return locations;
  const corteMs = corte.getTime();
  return locations.filter((location) => new Date(location.timestamp).getTime() < corteMs);
}

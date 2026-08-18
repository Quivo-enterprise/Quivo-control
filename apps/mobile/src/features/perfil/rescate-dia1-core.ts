import type { Location } from 'react-native-background-geolocation';
import { generarUuidV7, TOLERANCIA_TS_FIX_PASADO_MS } from '@quivo/shared';
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
 * inventada. En la práctica esta rama ya no debería dispararse desde `rescatarPuntosDia1`
 * (`filtrarPuntosRescatables` excluye los timestamps ilegibles ANTES de llegar acá, ver
 * `ResultadoFiltroRescatables.timestampIlegible`) — se mantiene como defensa redundante ante
 * un caller que no pase por ese filtro (p. ej. un test unitario de este módulo en aislado).
 *
 * M3 (hallazgo de revisión, medio): `origen: 'rescate'` marca explícitamente que este punto
 * NO vino del tracking en vivo, aunque lleve el `sesionId` de la sesión que corrió el rescate
 * (H5 — puede ser una sesión distinta a la del día 1 rescatado). `use-gps-operativo.ts`
 * (`detener()`) lo usa para excluir estos puntos de la ventana de medición del spike: sin
 * esto, rescatar durante un turno y después "Detener" mete puntos del día 1 en el cálculo de
 * huecos/duración de la corrida en vivo, con un NO-GO falso como resultado. `payload` en
 * `EventoSyncSchema` (`@quivo/shared`) es `z.record(z.unknown())` — un campo extra no
 * declarado en `PayloadGpsPointSchema` no rompe la validación del servidor (confirmado:
 * `SyncBatchDto` valida contra `SyncBatchSchema`/`EventoSyncSchema`, sin `.strict()`, y
 * `insertarGpsPoints` solo lee los campos que le interesan del payload).
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
      origen: 'rescate',
    },
  };
}

export interface ResultadoFiltroRescatables {
  /** Puntos que se van a intentar encolar (`construirEventoRescatado`). */
  rescatables: Location[];
  /** C1/M4 (hallazgo de revisión CRÍTICO): puntos con timestamp más viejo que
   * `TOLERANCIA_TS_FIX_PASADO_MS` (`@quivo/shared`) respecto de `ahora` — NO se encolan. */
  omitidosPorAntiguedad: Location[];
  /** Timestamp que ni siquiera se puede parsear (`NaN`) — NO se encolan. */
  timestampIlegible: Location[];
}

/**
 * M2 (hallazgo de revisión, medio — decisión tomada, reemplaza el corte superior de H1.b que
 * vivía acá): este módulo YA NO recibe ni aplica ningún corte "solo puntos anteriores al
 * primer arranque de este build". Esa premisa —"los puntos posteriores ya los encoló el
 * camino normal"— es falsa en tres casos reales, y en los tres el corte los dejaba
 * INALCANZABLES para siempre porque el rescate es la única vía:
 * - `obtenerContextoUbicacionPersistido` devuelve `null` por paquete del día vencido
 *   (`headless-task.ts`) — precisamente el estado de la mañana del día 2, con el SDK
 *   todavía grabando por `stopOnTerminate:false`/`startOnBoot:true`.
 * - sesión cerrada (mismo archivo).
 * - app en foreground sin `iniciar()` — no hay suscripción `onLocation`, nadie encola.
 * La no-duplicación sigue garantizada por H1.a (`eventId` determinístico, este mismo módulo)
 * + H1.c (una sola ejecución con confirmación, `rescate-dia1.ts`) — el corte superior era la
 * ÚNICA de las tres defensas que podía PERDER datos: re-encolar de más es trabajo redundante
 * acotado que `INSERT OR IGNORE` (`db/outbox.ts`) y el `ON CONFLICT` del servidor absorben;
 * perder un punto es irreversible.
 *
 * C1/M4 (hallazgo de revisión CRÍTICO): en su lugar, una cota INFERIOR — la MISMA
 * `TOLERANCIA_TS_FIX_PASADO_MS` que `resolverTsFix` usa server-side (`@quivo/shared`) para
 * decidir si un `tsFix` es usable. Sin esta cota, un rescate de un punto más viejo que la
 * tolerancia igual pasa `resolverTsFix` — que NO rechaza nada, cae en silencio al `ts` de
 * encolado (el momento del RESCATE) — y aterriza en la partición de HOY con un timestamp
 * casi idéntico al de otros puntos rescatados: el recorrido reconstruido queda
 * irreconstruible, se contamina la evidencia del día corriente, y un re-run duplica todo
 * (H1.a deja de proteger porque el `ts` server-side, parte de la PK `(event_id, ts)`, cambia
 * en cada corrida). Esta cota SÍ es segura de aplicar: a diferencia del corte superior, nunca
 * pierde un punto rescatable de verdad — solo evita que el servidor le invente una fecha en
 * silencio a uno que ya está fuera de rango.
 *
 * Separa los tres resultados en vez de descartar en silencio (A3, hallazgo de revisión alto):
 * el caller (`rescatarPuntosDia1`) reporta cada cubo — nunca "se pierden" sin dejar rastro.
 */
export function filtrarPuntosRescatables(locations: Location[], ahora: Date): ResultadoFiltroRescatables {
  const corteInferiorMs = ahora.getTime() - TOLERANCIA_TS_FIX_PASADO_MS;
  const rescatables: Location[] = [];
  const omitidosPorAntiguedad: Location[] = [];
  const timestampIlegible: Location[] = [];

  for (const location of locations) {
    const ms = new Date(location.timestamp).getTime();
    if (Number.isNaN(ms)) {
      timestampIlegible.push(location);
      continue;
    }
    if (ms < corteInferiorMs) {
      omitidosPorAntiguedad.push(location);
      continue;
    }
    rescatables.push(location);
  }

  return { rescatables, omitidosPorAntiguedad, timestampIlegible };
}

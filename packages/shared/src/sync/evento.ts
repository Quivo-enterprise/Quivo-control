import { z } from 'zod';
import { uuidSchema, uuidV7Schema } from '../primitives.js';

/**
 * Tipos de evento que la app móvil produce en el outbox local y sincroniza por lotes
 * (RF-67..73, doc técnico §6/§7). Se consume recién en M3, pero el contrato se fija ahora.
 */
export const TipoEventoSyncSchema = z.enum([
  'gps_point',
  'inicio_recorrido',
  'fin_recorrido',
  'pausa_recorrido',
  'reanudar_recorrido',
  'cumplimiento_punto_control',
  'observacion',
  'inicio_jornada',
]);
export type TipoEventoSync = z.infer<typeof TipoEventoSyncSchema>;

/**
 * Evento idempotente de sync: `eventId` es un UUIDv7 generado en el dispositivo.
 * El worker inserta con `ON CONFLICT (event_id) DO NOTHING` — reenviar el mismo evento
 * N veces no produce duplicados (RF-72, RNF-33/34).
 */
export const EventoSyncSchema = z.object({
  eventId: uuidV7Schema,
  deviceId: z.string().min(1),
  ts: z.string().datetime({ offset: true }),
  tipo: TipoEventoSyncSchema,
  payload: z.record(z.unknown()),
});
export type EventoSync = z.infer<typeof EventoSyncSchema>;

/**
 * Payload del evento `gps_point` — la evidencia legal cruda que sustenta las sanciones
 * (RF-67..73). Ojo con los DOS timestamps que tiene un punto GPS, que no son el mismo:
 * - `EventoSyncSchema.ts` (el sobre): momento en que el evento se ENCOLÓ en el outbox del
 *   dispositivo (`encolarEvento`, `db/outbox.ts`).
 * - `tsFix` (este payload): momento del FIX GPS real, reportado por el API nativo de
 *   ubicación (`Location.timestamp` del SDK de Transistorsoft).
 *
 * Coincidían aproximadamente mientras el único productor era la suscripción `onLocation` en
 * vivo. Con el tracking headless (app terminada, QUI-216) el SDK entrega ubicaciones
 * BUFFERADAS, tarde y en ráfaga al salir de Doze: un tramo entero de manejo se encola en
 * segundos y, sin `tsFix`, se persiste con timestamps casi idénticos — el recorrido
 * reconstruido (`recorridos.service.ts`, `ORDER BY ts`) queda deformado.
 *
 * `tsFix` es OPCIONAL a propósito y no debe volverse obligatorio: cuando esto se despliega
 * puede haber eventos ya encolados en dispositivos con una versión anterior de la app que
 * nunca lo van a traer. Esos siguen siendo válidos y se ingestan con el `ts` de encolado
 * (ver `resolverTsFix`).
 */
export const PayloadGpsPointSchema = z.object({
  sesionId: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number().nullable().optional(),
  speed: z.number().nullable().optional(),
  tsFix: z.string().datetime({ offset: true }).optional(),
});
export type PayloadGpsPoint = z.infer<typeof PayloadGpsPointSchema>;

/**
 * Payload del evento `cumplimiento_punto_control` — mismo defecto de timestamp que
 * `gps_point` (ver comentario de `PayloadGpsPointSchema` arriba), pero acá pesa más: el
 * sobre trae el `ts` de ENCOLADO, no el momento del FIX GPS que disparó la detección del
 * geofence, y bajo tracking headless ese fix puede estar minutos atrás del encolado. La hora
 * de paso por un punto de control es precisamente el hecho que sustenta una SANCIÓN
 * (RF-64..66) — más peso legal que un punto GPS suelto del trazado.
 *
 * `tsFix` es OPCIONAL por la misma razón de retrocompatibilidad que en `gps_point`: eventos
 * ya encolados en dispositivos con una versión anterior de la app nunca lo van a traer, y
 * siguen siendo válidos con el `ts` de encolado (ver `resolverTsFix`).
 *
 * `pasada` (multi-vuelta, plan §2.3): número de pasada por este punto de control dentro de
 * la sesión (contador incremental desde 1, calculado en el móvil por la máquina de estados
 * con histéresis de `filtrarNuevosCumplimientos`, `apps/mobile/src/gps/geofence.ts`) — sin
 * esto, el servidor no puede distinguir "cumplió y se cuenta como la vuelta 3" de "cumplió
 * una vez más y se perdió el evento". OPCIONAL a propósito, igual que `tsFix`: APKs
 * anteriores a este cambio nunca lo van a mandar, y esos eventos siguen siendo válidos sin
 * él (se persisten con `pasada: null`, nunca se rechazan).
 *
 * `distanciaEntradaM`/`distanciaMinAproximacionM` (ENTREGA 6, plan post-piloto 2026-09-09):
 * la máquina de estados ya NO emite el evento en el instante de ENTRADA al radio de
 * detección — lo difiere hasta el "mínimo local" (el fix más cercano al punto real de la
 * visita en curso, detectado cuando la distancia empieza a crecer de nuevo; ver el comentario
 * largo de "mínimo local" en `filtrarNuevosCumplimientos`). `distanciaEntradaM` conserva el
 * dato que antes viajaba como `distanciaM` (la distancia del fix que hizo `cumplido=true`);
 * `distanciaMinAproximacionM` es la distancia real mínima observada. Server-side esto es
 * SOLO evidencia adicional — `procesarCumplimientoEnTx` (`ingesta-worker.service.ts`) sigue
 * revalidando con `ST_DWithin` contra `lat`/`lng` y `radioToleranciaM`, sin leer estos campos
 * (el mínimo local SIEMPRE cae dentro del radio, así que la revalidación sigue pasando sin
 * cambios). AMBOS opcionales por el mismo motivo que `pasada`: retrocompatibilidad con APKs
 * anteriores a esta entrega.
 */
export const PayloadCumplimientoPuntoControlSchema = z.object({
  sesionId: z.string().min(1),
  puntoControlId: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
  tsFix: z.string().datetime({ offset: true }).optional(),
  pasada: z.number().int().positive().optional(),
  distanciaEntradaM: z.number().nonnegative().optional(),
  distanciaMinAproximacionM: z.number().nonnegative().optional(),
});
export type PayloadCumplimientoPuntoControl = z.infer<typeof PayloadCumplimientoPuntoControlSchema>;

/**
 * Payload del evento `inicio_jornada` — declaración "hoy trabajo" del conductor, previa a
 * salir a ruta (release 13). No lleva ubicación y NO cambia `recorridoEstado`: solo marca que
 * el vehículo inició su día, para que el panel lo distinga de "sin iniciar".
 */
export const PayloadInicioJornadaSchema = z.object({
  sesionId: uuidSchema,
});
export type PayloadInicioJornada = z.infer<typeof PayloadInicioJornadaSchema>;

// Solo valida la forma `{ tsFix?: string }` — el resto de las claves del payload (que
// difieren entre `gps_point` y `cumplimiento_punto_control`) se ignoran (`safeParse` de zod
// descarta claves no declaradas en vez de rechazarlas), así que sirve tal cual para cualquier
// payload que declare un `tsFix` opcional, no solo el de `gps_point` de donde se extrajo.
const TsFixSchema = PayloadGpsPointSchema.pick({ tsFix: true });

/**
 * Margen de reloj admitido para que `tsFix` se considere "del futuro" respecto del encolado.
 * OJO: `tsFix` y el `ts` del sobre NO vienen del mismo reloj (a diferencia de lo que decía
 * antes este comentario). `tsFix` es `location.timestamp`, que el SDK de Transistorsoft
 * documenta como provisto por el API nativo de ubicación (derivado del fix GNSS/satelital) —
 * de hecho el propio SDK expone `location.age` (ver
 * `node_modules/.../react-native-background-geolocation/.../Location.d.ts`) precisamente
 * porque `timestamp + age = reloj de sistema del dispositivo`: son dos fuentes distintas por
 * diseño, no la misma. El `ts` del sobre, en cambio, sale de `new Date().toISOString()` sobre
 * el reloj de sistema, en `encolarEvento` (`db/outbox.ts`). Esta tolerancia existe para
 * absorber la deriva normal entre esas dos fuentes y las correcciones de NTP a mitad de
 * camino — no porque compartan reloj.
 *
 * Deuda anotada, no cubierta acá: un teléfono con el RTC descargado arranca con la fecha de
 * build del firmware, y ahí un `tsFix` GNSS correcto puede parecer "del futuro" respecto de
 * ese reloj de sistema atrasado; reconstruirlo con `location.age` es trabajo aparte.
 */
const TOLERANCIA_TS_FIX_FUTURO_MS = 60_000;

/**
 * Piso de reloj admitido para `tsFix` (hallazgo de revisión QUI-216): sin esto, un `tsFix`
 * corrupto — p. ej. un dispositivo con el RTC descargado que arranca con la fecha de
 * fábrica/build — pasa el `safeParse` de Zod sin problema (cualquier string ISO-8601 válido
 * cuenta, no importa cuán absurdo el año) y `gps_points` está particionada por día SIN
 * partición `DEFAULT` (verificado: 0 hits en las migraciones). Solo existen particiones para
 * `[fecha_de_deploy - 1, hoy + 5]`, así que un `ts` fuera de ese rango levanta `23514 no
 * partition of relation "gps_points" found for row` — y como `insertarGpsPoints`
 * (`ingesta-worker.service.ts`) arma un solo `INSERT ... VALUES` con hasta 500 filas, ese
 * error tira el lote entero (los 499 puntos sanos incluidos) a `sync_errors`, que hoy no
 * tiene reproceso: pérdida definitiva de evidencia. El buffer de Doze de Transistorsoft se
 * mide en horas, no en años; 7 días es generoso y no castiga ningún caso legítimo de
 * buffering headless.
 *
 * Exportada (hallazgo de revisión C1, rescate del día 1): el rescate de emergencia
 * (`apps/mobile/src/features/perfil/rescate-dia1-core.ts`) necesita esta MISMA cifra para su
 * propia cota inferior — un punto rescatado más viejo que esta tolerancia igual pasaría
 * `resolverTsFix` (que cae en silencio al `ts` de encolado, sin rechazar nada), así que el
 * único lugar donde tiene sentido cortarlo es ANTES de encolar, del lado del móvil. Si el
 * móvil tuviera su propia copia del número, las dos tolerancias podrían desincronizarse con
 * el tiempo (alguien sube esta y se olvida de la otra) sin que ningún test lo detecte.
 */
export const TOLERANCIA_TS_FIX_PASADO_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Timestamp con el que un evento con `tsFix` opcional debe persistirse: el del fix GPS
 * (`payload.tsFix`) si viene y es usable, y si no el `ts` de encolado del sobre.
 * Retrocompatibilidad explícita — un evento viejo sin `tsFix`, o con un `tsFix` ilegible o
 * fuera del rango admitido (futuro o pasado) respecto del encolado, NUNCA se rechaza: cae al
 * comportamiento anterior en vez de perder evidencia.
 *
 * Antes se llamaba `resolverTsGpsPoint` — se generalizó (y renombró) porque el mismo defecto
 * de buffering headless afecta a `cumplimiento_punto_control` (RF-64..66): el fix que disparó
 * la detección del geofence es el hecho que sustenta una sanción, y sin esto la hora de paso
 * por el punto de control quedaría corrida al momento del encolado, igual que le pasaba al
 * `gps_point` suelto. La función en sí no cambió — solo mira `payload.tsFix`, le es
 * indiferente de qué tipo de evento viene.
 */
export function resolverTsFix(payload: unknown, tsEncolado: string): string {
  const parsed = TsFixSchema.safeParse(payload);
  const tsFix = parsed.success ? parsed.data.tsFix : undefined;
  if (tsFix === undefined) return tsEncolado;

  const msFix = Date.parse(tsFix);
  if (Number.isNaN(msFix)) return tsEncolado;

  const msEncolado = Date.parse(tsEncolado);
  if (!Number.isNaN(msEncolado)) {
    if (msFix > msEncolado + TOLERANCIA_TS_FIX_FUTURO_MS) return tsEncolado;
    if (msFix < msEncolado - TOLERANCIA_TS_FIX_PASADO_MS) return tsEncolado;
  }
  return new Date(msFix).toISOString();
}

/** Payload de `POST /v1/sync/batches` (hasta ~500 eventos por request, doc técnico §7). */
export const SyncBatchSchema = z.object({
  eventos: z.array(EventoSyncSchema).min(1).max(500),
});
export type SyncBatch = z.infer<typeof SyncBatchSchema>;

/**
 * Respuesta de `POST /v1/sync/batches` (RF-69..72, RNF-33/34, QUI-240): `aceptados` son los
 * `eventId` que quedaron encolados para el worker de ingesta (QUI-241) — el cliente móvil
 * SOLO debe marcar como sincronizado (`acusado`, QUI-238) lo que aparezca acá. Reenviar el
 * mismo lote N veces no duplica nada (idempotencia por UUIDv7 en el worker).
 */
export const SyncBatchResponseSchema = z.object({
  aceptados: z.array(uuidV7Schema),
});
export type SyncBatchResponse = z.infer<typeof SyncBatchResponseSchema>;

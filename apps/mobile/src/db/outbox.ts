import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import * as Sentry from '@sentry/react-native';
import { generarUuidV7, type TipoEventoSync } from '@quivo/shared';
// FIX POST-REVISIÓN (bug 5): el DDL vive en su propio módulo SIN imports (`outbox-ddl.ts`) para
// que `db/outbox-ddl.test.ts` pueda importarlo bajo vitest sin arrastrar `react-native`
// (transitivo de `expo-sqlite`/`@sentry/react-native`, que este archivo SÍ necesita) — ver el
// docblock de cabecera de `outbox-ddl.ts` para el porqué completo.
import { OUTBOX_DDL_SQL } from './outbox-ddl';

/**
 * Outbox local (RF-67..73, doc técnico §6): todo evento nace con `event_id` UUIDv7 +
 * `device_id` + `ts` de dispositivo, y se persiste ANTES de cualquier intento de red
 * (perder internet no debe perder evidencia, RNF-09). Estados:
 * - `pendiente`: recién creado, nunca se intentó enviar (o el intento anterior falló/venció).
 * - `enviado`: el lote que lo contiene salió por red, esperando el 202 de QUI-240.
 * - `acusado`: el servidor confirmó ese `event_id` puntual — sincronizado de verdad.
 * Reenviar un lote entero cuando solo algunos `event_id` fueron acusados no duplica nada
 * (idempotencia por UUIDv7 en el worker, QUI-241) — por eso el estado se actualiza por
 * `event_id`, no por lote completo.
 */
export interface EventoOutboxNuevo {
  deviceId: string;
  tipo: TipoEventoSync;
  payload: Record<string, unknown>;
  /**
   * H1.a (hallazgo de revisión, rescate del día 1): `eventId` explícito, en vez de acuñar uno
   * nuevo con `Crypto.getRandomBytesAsync`. Lo usa el rescate de emergencia
   * (`rescate-dia1.ts`) para derivar un `eventId` DETERMINÍSTICO desde `location.uuid`, de
   * forma que un re-run del rescate produzca los MISMOS `eventId` y el `ON CONFLICT (event_id,
   * ts)` del servidor los descarte solo, en vez de duplicar evidencia. Sin este campo,
   * comportamiento intacto (se genera uno nuevo, camino normal).
   */
  eventId?: string;
}

export type EstadoOutbox = 'pendiente' | 'enviado' | 'acusado';

export interface EventoOutboxRow {
  eventId: string;
  deviceId: string;
  ts: string;
  tipo: TipoEventoSync;
  payload: Record<string, unknown>;
  estado: EstadoOutbox;
}

interface OutboxRowCruda {
  event_id: string;
  device_id: string;
  ts: string;
  tipo: string;
  payload: string;
  estado: string;
}

const OUTBOX_DB_PATH = 'quivo-outbox.db';

/**
 * Regresión de `expo-sqlite@16.0.10` (16.0.10 es la última publicada — actualizar no
 * resuelve nada, el bug sigue ahí): `NativeDatabase.sharedObjectDidRelease()` destruye el
 * `sqlite3*` de C++ sin chequear refcount, así que el primer GC de Hermes sobre CUALQUIER
 * objeto JS viejo de `quivo-outbox.db` mata el handle nativo compartido. Del lado Kotlin
 * (`SQLiteModule.kt:110`), `openDatabaseAsync` cachea por `(databasePath, options)` y
 * devuelve esa instancia — ya zombi, con `isClosed == false` para siempre — mientras
 * `!options.useNewConnection` sea cierto. `abrirOutbox()` se llamaba antes CIENTOS de veces
 * por jornada (una por punto GPS): cada llamada abría/soltaba un objeto JS nuevo, cada uno
 * candidato a GC, cada GC candidato a gatillar el bug. Este singleton a nivel de módulo es
 * PARTE DEL FIX, no una optimización — mantiene vivo el único objeto JS registrado para este
 * path, así que Hermes nunca tiene un objeto viejo de esta base que colectar.
 */
let outboxPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let outboxAbiertoAlgunaVez = false;

async function abrirOutboxNueva(useNewConnection: boolean): Promise<SQLite.SQLiteDatabase> {
  // Breadcrumb en CADA apertura (no solo la primera): un "apertura #847 de quivo-outbox.db"
  // habría gritado la causa raíz (frecuencia de apertura) desde el primer minuto del piloto.
  const esPrimeraApertura = !outboxAbiertoAlgunaVez;
  outboxAbiertoAlgunaVez = true;
  Sentry.addBreadcrumb({
    category: 'sqlite',
    message: `Apertura de ${OUTBOX_DB_PATH}`,
    level: 'info',
    data: { path: OUTBOX_DB_PATH, esPrimeraApertura, useNewConnection },
  });

  const db = await SQLite.openDatabaseAsync(
    OUTBOX_DB_PATH,
    useNewConnection ? { useNewConnection: true } : undefined,
  );
  // DDL dentro de la promesa cacheada: corre una sola vez por proceso, nunca en el path de
  // escritura caliente (`encolarEvento`, hasta cientos de llamadas por jornada).
  await db.execAsync(OUTBOX_DDL_SQL);
  return db;
}

/**
 * Punto único de apertura de `quivo-outbox.db`: cachea la promesa a nivel de módulo (ver
 * comentario de `outboxPromise` arriba) en vez de abrir una conexión por llamada.
 * NO usa `useNewConnection: true` — con el singleton no aporta nada en el camino normal y
 * arriesga una segunda conexión concurrente al mismo archivo (`SQLITE_BUSY`). Ese flag es
 * exclusivo del escape hatch de abajo.
 */
export function abrirOutbox(): Promise<SQLite.SQLiteDatabase> {
  if (!outboxPromise) {
    // H8 (hallazgo de revisión, bajo): capturamos la referencia de ESTA promesa antes de
    // instalarla en `outboxPromise`, para que el `.catch` de abajo solo la limpie si sigue
    // siendo la promesa vigente. Sin esto, un rechazo TARDÍO de una apertura lenta que quedó en
    // vuelo puede anular una conexión buena que `reabrirOutboxTrasFalloNativo()` ya instaló
    // mientras tanto — el `??=` de arriba solo evita pisar una promesa ya cacheada al ENTRAR,
    // no protege el `outboxPromise = null` de un `.catch` que corre después.
    const promesaEnCurso: Promise<SQLite.SQLiteDatabase> = abrirOutboxNueva(false).catch((error) => {
      if (outboxPromise === promesaEnCurso) outboxPromise = null; // no cachear un rechazo: el próximo intento reintenta
      throw error;
    });
    outboxPromise = promesaEnCurso;
  }
  return outboxPromise;
}

/**
 * M1 (hallazgo de revisión, medio): handles que `reabrirOutboxTrasFalloNativo` reemplazó y
 * dejó de cachear en `outboxPromise` — ver el comentario de la función. El comentario de
 * `outboxPromise` de arriba declara la invariante del fix: "mantiene vivo el único objeto JS
 * registrado, así que Hermes nunca tiene un objeto viejo de esta base que colectar". Pero
 * pisar `outboxPromise` con la conexión nueva, sin más, ROMPE esa invariante para el handle
 * viejo: queda sin ninguna referencia, Hermes lo colecta en el próximo GC, y
 * `sharedObjectDidRelease()` corre una SEGUNDA vez sobre el mismo `sqlite3*` que el fallo
 * nativo ya destruyó — riesgo de crash nativo no determinista, justo en el camino ya
 * degradado que este escape hatch existe para sanar. Retenerlo acá (sin usarlo para nada más
 * — `closeAsync` sobre él también lanza NPE, ver el comentario de la función) cuesta unos
 * bytes por reapertura, que son raras.
 */
const handlesAbandonados: SQLite.SQLiteDatabase[] = [];

/**
 * Escape hatch para cuando el handle cacheado ya está muerto (NPE nativo, `code:
 * 'ERR_UNEXPECTED'`, ver comentario de `outboxPromise`): el cache del lado Kotlin sirve esa
 * misma instancia zombi para siempre mientras `useNewConnection` sea falsy — es la ÚNICA
 * forma de saltear ese cache, porque el predicado de `SQLiteModule.kt:110` exige
 * `!options.useNewConnection` para reusar la entrada cacheada.
 *
 * NO llama `closeAsync` sobre el handle viejo antes de reemplazarlo: sobre un handle muerto
 * también lanza NPE, porque `closeDatabase` (`SQLiteModule.kt:513-521`) hace
 * `sqlite3_finalize_all_statement()` (JNI) contra el `sqlite3*` ya destruido. No hay nada
 * seguro que hacer con él del lado JS más que retenerlo (`handlesAbandonados`, M1) para que
 * Hermes no lo colecte y dispare un segundo `sharedObjectDidRelease()`.
 */
export function reabrirOutboxTrasFalloNativo(): Promise<SQLite.SQLiteDatabase> {
  // M1: si `outboxPromise` ya resolvió a un handle (vivo o muerto, da igual — el punto es que
  // deje de estar referenciado desde acá), lo retenemos ANTES de pisarlo. Si la promesa vieja
  // nunca resolvió (una apertura que quedó en vuelo y falló), no hay handle nativo del que
  // preocuparse — `.catch` vacío a propósito.
  const promesaVieja = outboxPromise;
  if (promesaVieja) {
    promesaVieja.then((dbVieja) => handlesAbandonados.push(dbVieja)).catch(() => {});
  }

  // H8: mismo criterio que `abrirOutbox()` arriba — el `.catch` solo limpia `outboxPromise` si
  // sigue siendo ESTA promesa, no una que otra llamada haya instalado después.
  const promesaEnCurso: Promise<SQLite.SQLiteDatabase> = abrirOutboxNueva(true).catch((error) => {
    if (outboxPromise === promesaEnCurso) outboxPromise = null; // no cachear un rechazo: el próximo intento reintenta
    throw error;
  });
  outboxPromise = promesaEnCurso;
  return promesaEnCurso;
}

/** `code` que expone `expo-modules-core` en los `CodedException` que cruzan el bridge nativo
 * (ver `node_modules/expo-sqlite/android/.../SQLExceptions.kt` y el `UnexpectedException`
 * genérico de expo-modules-core para NPEs no tipados). Solo `ERR_UNEXPECTED` identifica un
 * handle nativo muerto (el bug de arriba) — vale la pena reintentar. Los otros dos NO:
 * - `ERR_INTERNAL_SQLITE_ERROR`: el propio SQLite rechazó el SQL (constraint, sintaxis, etc.)
 *   — reintentar con una conexión nueva ejecuta el mismo SQL roto y falla igual.
 * - `ERR_ACCESS_CLOSED_RESOURCE`: la base está cerrada a propósito (nadie en este código llama
 *   `closeAsync` sobre el outbox, pero el chequeo queda documentado por si cambia).
 */
function esHandleNativoMuerto(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = 'code' in error ? (error as { code?: unknown }).code : undefined;

  if (code === 'ERR_UNEXPECTED') return true;

  // Estos dos códigos SÍ vienen tipados desde el lado nativo (ver el comentario de arriba) y
  // NUNCA deben tratarse como handle muerto, aunque el `message` matchee NPE por casualidad —
  // reintentar acá no arregla nada (SQL roto sigue roto, base cerrada sigue cerrada).
  if (code === 'ERR_INTERNAL_SQLITE_ERROR' || code === 'ERR_ACCESS_CLOSED_RESOURCE') return false;

  // H9 (hallazgo de revisión, bajo): el predicado original solo miraba `code ===
  // 'ERR_UNEXPECTED'`. Si el NPE nativo aflora con otro `code` (o sin `code` ninguno) según la
  // ruta exacta del crash del lado Kotlin, el chequeo de arriba es un pass-through: el
  // reintento no dispara y el fix entero (singleton + escape hatch) queda de adorno. El
  // `message` SÍ es un indicio confiable acá: es la firma de la excepción nativa concreta que
  // dispara el bug (`sharedObjectDidRelease()` sobre un handle ya destruido).
  const message = 'message' in error ? (error as { message?: unknown }).message : undefined;
  return typeof message === 'string' && /NullPointerException/i.test(message);
}

/**
 * H3 (hallazgo de revisión, alto): reabre SOLO si nadie más ya está reabriendo para el MISMO
 * handle que acaba de morir. Si otra llamada concurrente (p. ej. el rescate del día 1
 * encolando miles de puntos, o el sync automático corriendo en paralelo) ya detectó el mismo
 * handle muerto y disparó la reapertura primero, reusamos esa MISMA promesa en vez de abrir
 * OTRA con `useNewConnection: true` al lado.
 *
 * A1 (hallazgo de revisión, alto, sobre esta misma función): la versión original leía
 * `outboxPromise` y hacía `await` sobre ella para decidir si hacía falta reabrir — ese `await`
 * es una ventana de UN MICROTASK en la que dos o tres fallos del mismo tick
 * (`sincronizarPendientes`, el poll de `use-sync-status.ts` y el `onLocation` del hook son
 * cadenas async independientes que pueden fallar juntas cuando el handle compartido muere)
 * pasan el chequeo A LA VEZ — cada una todavía ve el `outboxPromise` viejo (nadie lo reemplazó
 * TODAVÍA, la primera reapertura recién está en curso) y cada una dispara la suya: la misma
 * tormenta de conexiones `useNewConnection: true` que este mecanismo existe para eliminar,
 * solo que estrechada a una ventana más chica en vez de cerrada del todo.
 *
 * El fix: el guard se instala SINCRÓNICAMENTE, ANTES de cualquier `await`, keyeado por
 * identidad del handle muerto (`dbMuerta`) — no por un booleano genérico "hay algo en curso",
 * para que una reapertura POSTERIOR sobre una generación distinta de la conexión no reuse por
 * error la promesa de una reapertura vieja ya resuelta.
 */
let reaperturaEnCurso: { muerta: SQLite.SQLiteDatabase; promesa: Promise<SQLite.SQLiteDatabase> } | null =
  null;

function reabrirSoloSiSigueMuerto(dbMuerta: SQLite.SQLiteDatabase): Promise<SQLite.SQLiteDatabase> {
  if (reaperturaEnCurso?.muerta === dbMuerta) return reaperturaEnCurso.promesa; // sin await antes de esto

  const promesa = reabrirOutboxTrasFalloNativo().finally(() => {
    // No retener esta entrada más allá de la reapertura que la originó: una vez resuelta
    // (éxito o fallo), el próximo handle muerto que llegue es, por definición, una generación
    // distinta de la conexión y nunca va a matchear `dbMuerta` de todos modos — limpiar acá
    // evita dejar colgada una referencia obsoleta indefinidamente.
    if (reaperturaEnCurso?.muerta === dbMuerta) reaperturaEnCurso = null;
  });
  reaperturaEnCurso = { muerta: dbMuerta, promesa };
  return promesa;
}

/**
 * Ejecuta una operación contra `db` y, si el handle está muerto (ver `esHandleNativoMuerto`),
 * reabre la conexión (`reabrirSoloSiSigueMuerto`) y reintenta la MISMA operación UNA sola vez
 * con el handle nuevo. Cualquier otro `code` (SQL roto, base cerrada) se propaga tal cual —
 * reintentar no arregla nada ahí.
 */
async function conReintentoSiHandleMuerto<T>(
  db: SQLite.SQLiteDatabase,
  operacion: (db: SQLite.SQLiteDatabase) => Promise<T>,
): Promise<T> {
  try {
    return await operacion(db);
  } catch (error) {
    if (!esHandleNativoMuerto(error)) throw error;
    const dbNueva = await reabrirSoloSiSigueMuerto(db);
    return operacion(dbNueva);
  }
}

async function generarEventId(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(10);
  return generarUuidV7(bytes);
}

/** Persiste un evento nuevo en estado `pendiente` — ver el contrato en el comentario de
 * arriba: esto debe ocurrir antes de cualquier intento de red, nunca después.
 * Este es EL path de escritura caliente (hasta cientos de llamadas por jornada, una por
 * punto GPS) — por eso pasa por `conReintentoSiHandleMuerto`: si `db` es un handle zombi
 * (ver comentario de `outboxPromise`), reintenta una vez con una conexión nueva en vez de
 * perder el punto GPS entero.
 *
 * H1.a (hallazgo de revisión CRÍTICO): con `evento.eventId` explícito (rescate del día 1, ver
 * el comentario de `EventoOutboxNuevo`), el `event_id` puede repetirse entre corridas — la
 * tabla local `outbox` tiene `event_id TEXT PRIMARY KEY`, así que un re-run del rescate
 * chocaría contra esa PK y `runAsync` lanzaría `SQLITE_CONSTRAINT`. `INSERT OR IGNORE` evita
 * eso, pero SOLO cuando el `eventId` vino dado: en el camino normal (sin `eventId`, uno nuevo
 * por llamada) un choque de PK sería un bug real que preferimos que siga reventando.
 *
 * B1 (hallazgo de revisión, bajo): devuelve también `insertado` — si `result.changes === 0`,
 * `INSERT OR IGNORE` descartó la fila porque el `eventId` ya estaba en el outbox (un re-run
 * del rescate, H1.a). Antes esta función devolvía solo el `eventId` sin mirar `changes`, así
 * que un caller no tenía forma de distinguir "encolé un punto nuevo" de "esto ya estaba" —
 * `rescate-dia1.ts` reportaba (y persistía como registro de auditoría, `guardarResultadoRescate`)
 * "3000 encolados" en un re-run que en realidad escribió 0 filas nuevas.
 */
/**
 * R2 (hallazgo de revisión SERIO, atomicidad de `encolarEventoYLimpiarVisita`): cuerpo RAW del
 * INSERT — SIN su propio `conReintentoSiHandleMuerto` — para que `encolarEventoYLimpiarVisita`
 * pueda correrlo DENTRO de una transacción cuya recuperación de handle envuelve la transacción
 * ENTERA (ver el docblock de esa función). Si esta función tuviera su propia recuperación, un
 * handle que muere A MITAD de esa transacción reabriría una conexión NUEVA solo para el INSERT
 * — corriendo FUERA de la transacción abierta en la conexión vieja (ahora zombi) — mientras el
 * `DELETE` de al lado podría (o no) terminar en una tercera conexión: exactamente la ruptura de
 * atomicidad que R2 existe para cerrar. `encolarEvento` (abajo) es el único wrapper con
 * recuperación propia, para el camino simple (sin transacción) que no tiene este riesgo.
 */
async function insertarEventoRaw(
  dbActiva: SQLite.SQLiteDatabase,
  evento: EventoOutboxNuevo,
): Promise<{ eventId: string; insertado: boolean }> {
  const eventIdProvisto = evento.eventId !== undefined;
  const eventId = evento.eventId ?? (await generarEventId());
  const sql = eventIdProvisto
    ? "INSERT OR IGNORE INTO outbox (event_id, device_id, ts, tipo, payload, estado) VALUES (?, ?, ?, ?, ?, 'pendiente')"
    : "INSERT INTO outbox (event_id, device_id, ts, tipo, payload, estado) VALUES (?, ?, ?, ?, ?, 'pendiente')";
  const result = await dbActiva.runAsync(sql, [
    eventId,
    evento.deviceId,
    new Date().toISOString(),
    evento.tipo,
    JSON.stringify(evento.payload),
  ]);
  return { eventId, insertado: result.changes > 0 };
}

export async function encolarEvento(
  db: SQLite.SQLiteDatabase,
  evento: EventoOutboxNuevo,
): Promise<{ eventId: string; insertado: boolean }> {
  return conReintentoSiHandleMuerto(db, (dbActiva) => insertarEventoRaw(dbActiva, evento));
}

/**
 * ENTREGA 7 (plan post-piloto 2026-09-09): registra que el anuncio (sonido + vibración +
 * notificación) de una CONFIRMACIÓN de punto de control ya salió, y devuelve si esta llamada
 * fue la que lo registró por primera vez. `clave` es `${sesionId}:${puntoControlId}:${pasada}`
 * (`claveAnuncio`, `features/operacion/anuncio-punto-control.ts`) — la MISMA tripleta que
 * identifica una pasada evidenciada en `filtrarNuevosCumplimientos` (`gps/geofence.ts`), así
 * que dos ticks que terminen confirmando la MISMA pasada (headless recicla el contexto JS
 * justo después de escribir el evento pero antes de anunciar, por ejemplo) anuncian una sola
 * vez.
 *
 * Mismo patrón que `encolarEvento` arriba (B1): `INSERT OR IGNORE` + `changes > 0`, no un
 * SELECT-luego-INSERT — con la PK como único gate no hay ventana de TOCTOU entre leer "¿ya
 * está?" y escribir, que sí existiría con dos pasos separados y dos ticks concurrentes.
 */
export async function registrarAnuncioSiNuevo(
  db: SQLite.SQLiteDatabase,
  clave: string,
): Promise<boolean> {
  const result = await conReintentoSiHandleMuerto(db, (dbActiva) =>
    dbActiva.runAsync('INSERT OR IGNORE INTO anuncios_punto_control (clave, ts) VALUES (?, ?)', [
      clave,
      new Date().toISOString(),
    ]),
  );
  return result.changes > 0;
}

/** Fila de la tabla `visitas_pendientes` — ver su comentario de DDL arriba. Espejo (en
 * `camelCase`) de `VisitaPendienteSembrable` (`gps/location-task.ts`), que es la forma que
 * `combinarConVisitasPendientes` (pura, sin SQLite) sabe consumir. */
export interface VisitaPendienteRow {
  clave: string;
  sesionId: string;
  puntoControlId: string;
  pasadasPrevias: number;
  radioToleranciaM: number;
  minDistanciaM: number;
  distanciaEntradaM: number;
  candidatoLat: number;
  candidatoLng: number;
  candidatoTsFixMs: number;
  ultimoEmitidoMs: number;
  fixesDentroSinConfirmar: number;
}

interface VisitaPendienteRowCruda {
  clave: string;
  sesion_id: string;
  punto_control_id: string;
  pasadas_previas: number;
  radio_tolerancia_m: number;
  min_distancia_m: number;
  distancia_entrada_m: number;
  candidato_lat: number;
  candidato_lng: number;
  candidato_ts_fix_ms: number;
  ultimo_emitido_ms: number;
  fixes_dentro_sin_confirmar: number;
}

function toVisitaPendienteRow(row: VisitaPendienteRowCruda): VisitaPendienteRow {
  return {
    clave: row.clave,
    sesionId: row.sesion_id,
    puntoControlId: row.punto_control_id,
    pasadasPrevias: row.pasadas_previas,
    radioToleranciaM: row.radio_tolerancia_m,
    minDistanciaM: row.min_distancia_m,
    distanciaEntradaM: row.distancia_entrada_m,
    candidatoLat: row.candidato_lat,
    candidatoLng: row.candidato_lng,
    candidatoTsFixMs: row.candidato_ts_fix_ms,
    ultimoEmitidoMs: row.ultimo_emitido_ms,
    fixesDentroSinConfirmar: row.fixes_dentro_sin_confirmar,
  };
}

/**
 * FIX POST-REVISIÓN (bug 5): persiste (o actualiza) el candidato de UNA visita en curso —
 * llamado desde `registrarPuntoGpsInterno` (`gps/headless-task.ts`) por cada fix que la
 * máquina de estados deja `dentro: true, confirmado: false` (entrada o mejora del mínimo, ver
 * `filtrarNuevosCumplimientos`, `gps/geofence.ts`). `ON CONFLICT... DO UPDATE` (no
 * `INSERT OR REPLACE`) a propósito: `REPLACE` borra e re-inserta la fila entera, lo que en
 * SQLite dispara los triggers de `DELETE`+`INSERT` en vez de un `UPDATE` — no hay triggers hoy,
 * pero `DO UPDATE` es semánticamente lo que se quiere decir ("actualizá esta fila") y cuesta
 * lo mismo.
 */
export async function guardarVisitaPendiente(
  db: SQLite.SQLiteDatabase,
  visita: VisitaPendienteRow,
): Promise<void> {
  await conReintentoSiHandleMuerto(db, (dbActiva) =>
    dbActiva.runAsync(
      `INSERT INTO visitas_pendientes (
         clave, sesion_id, punto_control_id, pasadas_previas, radio_tolerancia_m,
         min_distancia_m, distancia_entrada_m, candidato_lat, candidato_lng,
         candidato_ts_fix_ms, ultimo_emitido_ms, fixes_dentro_sin_confirmar, actualizado_ts
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(clave) DO UPDATE SET
         pasadas_previas = excluded.pasadas_previas,
         radio_tolerancia_m = excluded.radio_tolerancia_m,
         min_distancia_m = excluded.min_distancia_m,
         distancia_entrada_m = excluded.distancia_entrada_m,
         candidato_lat = excluded.candidato_lat,
         candidato_lng = excluded.candidato_lng,
         candidato_ts_fix_ms = excluded.candidato_ts_fix_ms,
         ultimo_emitido_ms = excluded.ultimo_emitido_ms,
         fixes_dentro_sin_confirmar = excluded.fixes_dentro_sin_confirmar,
         actualizado_ts = excluded.actualizado_ts`,
      [
        visita.clave,
        visita.sesionId,
        visita.puntoControlId,
        visita.pasadasPrevias,
        visita.radioToleranciaM,
        visita.minDistanciaM,
        visita.distanciaEntradaM,
        visita.candidatoLat,
        visita.candidatoLng,
        visita.candidatoTsFixMs,
        visita.ultimoEmitidoMs,
        visita.fixesDentroSinConfirmar,
        new Date().toISOString(),
      ],
    ),
  );
}

/** R2: cuerpo RAW del DELETE — SIN su propia recuperación de handle, mismo motivo que
 * `insertarEventoRaw` (ver su docblock): `encolarEventoYLimpiarVisita` lo corre dentro de una
 * transacción cuya recuperación envuelve la transacción entera. */
async function eliminarVisitaPendienteRaw(
  dbActiva: SQLite.SQLiteDatabase,
  clave: string,
): Promise<void> {
  await dbActiva.runAsync('DELETE FROM visitas_pendientes WHERE clave = ?', [clave]);
}

/** Borra la fila de una visita que ya no está pendiente (confirmada o re-armada sin confirmar,
 * B5 en `geofence.ts`). Llamarla con una `clave` que no tiene fila es un no-op seguro
 * (`DELETE ... WHERE` sin matches). */
export async function eliminarVisitaPendiente(
  db: SQLite.SQLiteDatabase,
  clave: string,
): Promise<void> {
  await conReintentoSiHandleMuerto(db, (dbActiva) => eliminarVisitaPendienteRaw(dbActiva, clave));
}

/** Lee las visitas pendientes de una sesión (o de todas, sin filtro) — usada al sembrar
 * (`asegurarSemillaCumplimientos`/`sembrarCumplimientos`) para superponerlas sobre el estado
 * derivado de los eventos confirmados vía `combinarConVisitasPendientes`
 * (`gps/location-task.ts`). */
export async function obtenerVisitasPendientes(
  db: SQLite.SQLiteDatabase,
  sesionId?: string,
): Promise<VisitaPendienteRow[]> {
  const rows = await conReintentoSiHandleMuerto(db, (dbActiva) =>
    sesionId !== undefined
      ? dbActiva.getAllAsync<VisitaPendienteRowCruda>(
          'SELECT * FROM visitas_pendientes WHERE sesion_id = ?',
          [sesionId],
        )
      : dbActiva.getAllAsync<VisitaPendienteRowCruda>('SELECT * FROM visitas_pendientes'),
  );
  return rows.map(toVisitaPendienteRow);
}

/**
 * FIX POST-REVISIÓN (bug 5, requisito del diseño C: "al emitir se borra en la misma
 * transacción que encola el evento"): encola el `cumplimiento_punto_control` y borra la fila
 * de `visitas_pendientes` correspondiente dentro de UNA transacción SQLite
 * (`withTransactionAsync`) — así ninguna de las dos puede quedar a medias. Sin esto, un crash
 * entre las dos escrituras dejaría el evento YA encolado (la evidencia está a salvo) pero la
 * fila de `visitas_pendientes` todavía viva: al sembrar de nuevo, `combinarConVisitasPendientes`
 * la superpondría como "visita en curso" sobre un estado que YA tiene esa pasada confirmada —
 * la máquina de estados la re-evaluaría desde cero y, en el peor caso, terminaría emitiendo la
 * MISMA pasada una segunda vez con un `eventId` nuevo (el plan deja `pasada` fuera de la clave
 * de idempotencia del servidor — el único gate real es el `eventId` por evento, así que un
 * segundo `encolarEvento` para la misma pasada SÍ duplicaría evidencia server-side).
 *
 * `claveVisitaPendiente === undefined` (evento sin visita pendiente asociada, no debería
 * ocurrir para un `cumplimiento_punto_control` pero se contempla por completitud) encola sin
 * abrir transacción — no hay nada que borrar.
 *
 * FIX POST-REVISIÓN (R2, hallazgo de revisión SERIO — "atomicidad rota por recuperación de
 * handle"): la transacción (`withTransactionAsync`) ahora se abre DENTRO de
 * `conReintentoSiHandleMuerto`, no al revés. Antes, `db.withTransactionAsync` corría sobre el
 * handle recibido (`db`) mientras el INSERT/DELETE de adentro llamaban a `encolarEvento`/
 * `eliminarVisitaPendiente` — cada uno con su PROPIA recuperación de handle. Si `db` moría a
 * mitad de la transacción, esa recuperación interna abría una conexión NUEVA (`dbNueva`) y
 * corría el INSERT (o el DELETE) ahí — FUERA de la transacción abierta en la conexión vieja
 * (ya zombi) — mientras el `COMMIT` implícito de `withTransactionAsync`, al final, seguía
 * apuntando al handle MUERTO y fallaba. Resultado real: el INSERT y el DELETE podían quedar
 * autocommiteados por separado en `dbNueva` (sin ninguna atomicidad entre sí) mientras el
 * caller recibía una EXCEPCIÓN (el `COMMIT` fallido) como si nada se hubiera escrito — un
 * reintento aguas arriba podía volver a encolar el mismo cumplimiento con un `eventId` nuevo
 * (mitigado, no eliminado, por el eventId determinístico — ver `derivarEventIdDeterministico`,
 * `@quivo/shared`) sobre una fila de `visitas_pendientes` que ya no correspondía.
 *
 * Con la transacción entera envuelta en `conReintentoSiHandleMuerto`, un handle que muere en
 * CUALQUIER punto (BEGIN, INSERT, DELETE o COMMIT) hace que la función reintente la operación
 * COMPLETA una vez, desde cero, contra una ÚNICA conexión fresca (`dbActiva`) — nunca mezcla
 * dos conexiones dentro de la misma transacción. `insertarEventoRaw`/`eliminarVisitaPendienteRaw`
 * (sin su propia recuperación) son justamente lo que hace esto seguro: si tuvieran la suya
 * propia, podrían reabrir POR SU CUENTA a mitad de la transacción externa, reintroduciendo el
 * mismo bug un nivel más adentro. Reintentar la transacción completa es seguro aunque ya haya
 * corrido parte del INSERT: si el `COMMIT` no se confirmó, SQLite garantiza que nada de la
 * transacción quedó persistido (rollback implícito de la conexión muerta).
 */
export async function encolarEventoYLimpiarVisita(
  db: SQLite.SQLiteDatabase,
  evento: EventoOutboxNuevo,
  claveVisitaPendiente: string | undefined,
): Promise<{ eventId: string; insertado: boolean }> {
  if (claveVisitaPendiente === undefined) return encolarEvento(db, evento);

  return conReintentoSiHandleMuerto(db, async (dbActiva) => {
    let resultado: { eventId: string; insertado: boolean } | undefined;
    await dbActiva.withTransactionAsync(async () => {
      resultado = await insertarEventoRaw(dbActiva, evento);
      await eliminarVisitaPendienteRaw(dbActiva, claveVisitaPendiente);
    });
    // `withTransactionAsync` solo resuelve si `task` resolvió sin lanzar — `resultado` siempre
    // queda asignado en ese caso. El `as` documenta esa garantía en vez de forzar un chequeo de
    // `undefined` que nunca puede ser `true` en este punto.
    return resultado as { eventId: string; insertado: boolean };
  });
}

/** H4 (hallazgo de revisión, medio): pasa por `conReintentoSiHandleMuerto` igual que los
 * caminos de escritura. Antes de este fix, cada llamada abría una conexión nueva por su
 * cuenta y se auto-sanaba sola ante un handle muerto; con el singleton, un handle zombi deja
 * ESTE camino de lectura colgado para siempre — con el tracking detenido, nada dispara la
 * reapertura porque no se intenta ninguna escritura (`sincronizarPendientes` quedaría
 * bloqueado acá mismo, el badge de pendientes de `use-sync-status.ts` se congela). */
export async function contarEventosPendientes(db: SQLite.SQLiteDatabase): Promise<number> {
  const row = await conReintentoSiHandleMuerto(db, (dbActiva) =>
    dbActiva.getFirstAsync<{ total: number }>(
      "SELECT COUNT(*) as total FROM outbox WHERE estado != 'acusado'",
    ),
  );
  return row?.total ?? 0;
}

/** Toma hasta `limite` eventos `pendiente` (los más viejos primero) para armar el próximo
 * lote de `POST /v1/sync/batches` (QUI-240, hasta ~500 eventos por request).
 * H4: ver el comentario de `contarEventosPendientes` arriba — sin `conReintentoSiHandleMuerto`
 * acá, `sincronizarPendientes` queda tirando para siempre contra un handle zombi. */
export async function obtenerLotePendiente(
  db: SQLite.SQLiteDatabase,
  limite = 500,
): Promise<EventoOutboxRow[]> {
  const rows = await conReintentoSiHandleMuerto(db, (dbActiva) =>
    dbActiva.getAllAsync<OutboxRowCruda>(
      "SELECT event_id, device_id, ts, tipo, payload, estado FROM outbox WHERE estado = 'pendiente' ORDER BY ts ASC LIMIT ?",
      [limite],
    ),
  );
  return rows.map(toEventoOutboxRow);
}

export interface EventoOutboxTsPayload {
  ts: string;
  payload: Record<string, unknown>;
}

/**
 * `ts` del sobre + payload de todos los eventos de un tipo que siguen en el outbox (en
 * cualquier estado, no solo `pendiente`). Dos consumidores:
 * - El detector de huecos del spike (`use-gps-operativo.ts`, hallazgo de revisión A1), que
 *   reconstruye la ventana MEDIDA desde lo persistido en vez de un `useRef` en memoria que el
 *   headless task nunca alimenta (no hay hook, no hay React): sin esto, un chofer que mata la
 *   app a mitad de turno y la reabre deja `detectarHuecos` evaluando solo el tramo en vivo
 *   final, reportando "0 huecos" sobre una ventana que en realidad no se midió.
 * - `clavesCumplimientoDesdePayloads` (`gps/location-task.ts`), que siembra el estado de
 *   histéresis del geofence (multi-vuelta, plan §2.3) al arrancar `iniciar()`/el headless
 *   task. Necesita el `ts` del sobre (no solo el payload) porque usa `resolverTsFix`
 *   (`@quivo/shared`) — el `ts` del sobre es el fallback cuando el payload no trae `tsFix`
 *   (eventos de una versión anterior de la app).
 *
 * `sesionId`, si se pasa, filtra los eventos a esa sesión únicamente (plan §2.1, "poda del
 * outbox": sin este filtro, `obtenerEventosPorTipo` leía la tabla entera sin importar cuántas
 * sesiones/días acumulara el dispositivo — la semilla de cumplimientos de la sesión ACTUAL no
 * necesita ver eventos de sesiones anteriores, y filtrarlos temprano evita cargarlos en JS
 * solo para descartarlos después). El filtro es en JS (no en el `SELECT`, que no puede mirar
 * dentro del `payload` sin `json_extract`) — mismo patrón que ya usaba `detener()` para
 * `gps_point` antes de este cambio. Ignora filas con payload corrupto en vez de romper la
 * lectura entera.
 */
export async function obtenerEventosPorTipo(
  db: SQLite.SQLiteDatabase,
  tipo: TipoEventoSync,
  sesionId?: string,
): Promise<EventoOutboxTsPayload[]> {
  // H4: ver el comentario de `contarEventosPendientes` — mismo motivo para envolver la lectura.
  const rows = await conReintentoSiHandleMuerto(db, (dbActiva) =>
    dbActiva.getAllAsync<{ ts: string; payload: string }>(
      'SELECT ts, payload FROM outbox WHERE tipo = ?',
      [tipo],
    ),
  );
  const eventos: EventoOutboxTsPayload[] = [];
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload) as Record<string, unknown>;
      if (sesionId !== undefined && payload['sesionId'] !== sesionId) continue;
      eventos.push({ ts: row.ts, payload });
    } catch {
      // Fila ilegible: se ignora — un consumidor best-effort (la semilla de cumplimientos) no
      // debe romperse por esto, y el detector de huecos ya filtraba timestamps inválidos.
    }
  }
  return eventos;
}

export async function marcarEnviados(db: SQLite.SQLiteDatabase, eventIds: string[]): Promise<void> {
  await actualizarEstado(db, eventIds, 'enviado');
}

/** El servidor acusó estos `event_id` puntuales (202 de QUI-240) — quedan sincronizados de
 * verdad. Los que no vengan en el acuse (rechazados o simplemente no llegaron a procesarse)
 * quedan como estaban para reintentar en el próximo lote. */
export async function marcarAcusados(db: SQLite.SQLiteDatabase, eventIds: string[]): Promise<void> {
  await actualizarEstado(db, eventIds, 'acusado');
}

/** Reintento tras fallo de red/timeout del lote completo: vuelve `enviado` -> `pendiente`
 * para que el próximo ciclo de sync los tome de nuevo (con backoff, ver QUI-240). */
export async function revertirAPendiente(
  db: SQLite.SQLiteDatabase,
  eventIds: string[],
): Promise<void> {
  await actualizarEstado(db, eventIds, 'pendiente');
}

/** Tipo de evento cuya evidencia local se preserva mientras la sesión siga activa: es el único
 * del que se RECONSTRUYE estado a partir del outbox (`clavesCumplimientoDesdePayloads`,
 * `gps/location-task.ts`, deriva de acá el contador de pasadas de la multi-vuelta). Ver
 * `purgarAcusadosAntesDe`. */
const TIPO_PRESERVADO_SESION_ACTIVA: TipoEventoSync = 'cumplimiento_punto_control';

/**
 * SQL de la purga, aislado como función pura para poder testear el predicado sin un módulo
 * nativo de por medio (`expo-sqlite` no corre bajo vitest/Node). Ver `purgarAcusadosAntesDe`
 * para el porqué de cada condición.
 */
export function construirPurgaAcusados(
  antesDe: Date,
  sesionIdActiva?: string,
): { sql: string; params: (string | number)[] } {
  if (!sesionIdActiva) {
    return {
      sql: "DELETE FROM outbox WHERE estado = 'acusado' AND ts < ?",
      params: [antesDe.toISOString()],
    };
  }
  return {
    sql:
      "DELETE FROM outbox WHERE estado = 'acusado' AND ts < ? " +
      "AND NOT (tipo = ? AND COALESCE(json_extract(payload, '$.sesionId'), '') = ?)",
    params: [antesDe.toISOString(), TIPO_PRESERVADO_SESION_ACTIVA, sesionIdActiva],
  };
}

/** Limpieza de eventos ya acusados y viejos — evita que el outbox crezca sin límite en un
 * dispositivo que queda encendido semanas. No borra nada que no esté `acusado`.
 *
 * M2 (hallazgo de revisión, medio, complementario — el fix principal es
 * `Math.max(maxPasadaEnPayloads, cantidadDeFilas)` en `clavesCumplimientoDesdePayloads`,
 * `gps/location-task.ts`): `sesionIdActiva`, si se pasa, EXCLUYE de la purga los
 * `cumplimiento_punto_control` de esa sesión — `restaurarSesion` (`use-auth-movil.ts`) mantiene
 * viva la misma `sesionId` mientras el refresh token siga vigente (30 días por default), así
 * que una sesión operativa puede seguir "activa" bastante después de que la ventana de purga
 * (7 días) empiece a comerse sus cumplimientos más viejos, haciendo retroceder el contador de
 * pasadas que la semilla reconstruye.
 *
 * M4 (hallazgo de revisión, medio): esa exclusión está acotada a `tipo =
 * 'cumplimiento_punto_control'`, NO a todo evento de la sesión. Los `gps_point` también llevan
 * `sesionId` en el payload (`gps/location-task.ts`), y con la misma `sesionId` viva 30 días,
 * excluirlos a todos dejaba a la purga sin poder borrar NADA de la sesión activa: ~8.600 filas
 * de `gps_point` ya acusadas por día acumulándose para siempre — justo el crecimiento sin techo
 * que esta función existe para evitar. De un `gps_point` acusado no se reconstruye ningún
 * estado local (ya está en el servidor, que es la fuente de verdad auditada): una vez acusado y
 * fuera de la ventana, se puede borrar aunque la sesión siga abierta.
 */
export async function purgarAcusadosAntesDe(
  db: SQLite.SQLiteDatabase,
  antesDe: Date,
  sesionIdActiva?: string,
): Promise<number> {
  const { sql, params } = construirPurgaAcusados(antesDe, sesionIdActiva);
  const result = await conReintentoSiHandleMuerto(db, (dbActiva) => dbActiva.runAsync(sql, params));
  return result.changes;
}

async function actualizarEstado(
  db: SQLite.SQLiteDatabase,
  eventIds: string[],
  estado: EstadoOutbox,
): Promise<void> {
  if (eventIds.length === 0) return;
  const placeholders = eventIds.map(() => '?').join(',');
  await conReintentoSiHandleMuerto(db, (dbActiva) =>
    dbActiva.runAsync(`UPDATE outbox SET estado = ? WHERE event_id IN (${placeholders})`, [
      estado,
      ...eventIds,
    ]),
  );
}

function toEventoOutboxRow(row: OutboxRowCruda): EventoOutboxRow {
  return {
    eventId: row.event_id,
    deviceId: row.device_id,
    ts: row.ts,
    tipo: row.tipo as TipoEventoSync,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    estado: row.estado as EstadoOutbox,
  };
}

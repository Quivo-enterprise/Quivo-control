import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import * as Sentry from '@sentry/react-native';
import { generarUuidV7, type TipoEventoSync } from '@quivo/shared';

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

/**
 * DDL de creación (tablas + índice) — todo con `IF NOT EXISTS`, que SÍ es sintaxis SQLite
 * válida para `CREATE TABLE`/`CREATE INDEX` (a diferencia de `ALTER TABLE ... ADD COLUMN IF
 * NOT EXISTS`, que NO existe en SQLite — ver `MIGRACIONES_COLUMNAS_OUTBOX` más abajo para el
 * porqué esa migración va aparte). Constante pura, sin ningún `await` de por medio, para
 * poder correrla contra SQLite real (`node:sqlite`) sin pasar por `expo-sqlite` — ver
 * `outbox-ddl.test.ts`.
 */
export const DDL_OUTBOX = `
  CREATE TABLE IF NOT EXISTS outbox (
    event_id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    ts TEXT NOT NULL,
    tipo TEXT NOT NULL,
    payload TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'pendiente'
  );
  CREATE INDEX IF NOT EXISTS outbox_estado_idx ON outbox(estado);
  CREATE TABLE IF NOT EXISTS sync_lease (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    expira_at INTEGER NOT NULL
  );
  -- REDISEÑO (anuncio de puntos de control, 2026-09-25): dedupe/estado PERSISTIDO del anuncio
  -- de "llegaste" (vibración + notificación) por {sesionId, puntoControlId, pasada} — un
  -- useRef de React no sobrevive al contexto headless. estado: 'pendiente' (reclamado, sin
  -- intentar programar todavía) -> 'programando' (intento en vuelo, con ultimo_intento_ts +
  -- intentos) -> 'programado' (schedule confirmado). Ver marcarAnuncioProgramando/
  -- obtenerAnunciosPendientesDeProgramar más abajo.
  CREATE TABLE IF NOT EXISTS anuncios_punto_control (
    clave TEXT PRIMARY KEY,
    ts TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'programado',
    motivo TEXT,
    sesion_id TEXT,
    punto_control_id TEXT,
    pasada INTEGER,
    intentos INTEGER NOT NULL DEFAULT 0,
    ultimo_intento_ts TEXT
  );
  CREATE INDEX IF NOT EXISTS anuncios_punto_control_estado_idx ON anuncios_punto_control(estado);
  -- Copia durable del candidato (fix más cercano observado) de CADA visita en curso, por
  -- {sesionId, puntoControlId} — combinarConVisitasPendientes (gps/location-task.ts) la
  -- superpone sobre el Map derivado de los eventos ya confirmados al sembrar. Se borra en la
  -- MISMA transacción que encola el evento de confirmación (encolarEventoYLimpiarVisita).
  CREATE TABLE IF NOT EXISTS visitas_pendientes (
    clave TEXT PRIMARY KEY,
    sesion_id TEXT NOT NULL,
    punto_control_id TEXT NOT NULL,
    pasadas_previas INTEGER NOT NULL,
    radio_tolerancia_m REAL NOT NULL,
    min_distancia_m REAL NOT NULL,
    distancia_entrada_m REAL NOT NULL,
    candidato_lat REAL NOT NULL,
    candidato_lng REAL NOT NULL,
    candidato_ts_fix_ms REAL NOT NULL,
    ultimo_emitido_ms REAL NOT NULL,
    fixes_dentro_sin_confirmar INTEGER NOT NULL,
    actualizado_ts TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS visitas_pendientes_sesion_idx ON visitas_pendientes(sesion_id);
`;

interface MigracionColumna {
  tabla: string;
  columna: string;
  tipo: string;
}

/**
 * 🔴 Hallazgo 1 CRÍTICO (code review): esta migración vivía como
 * `ALTER TABLE outbox ADD COLUMN IF NOT EXISTS enviado_at TEXT;` dentro del `execAsync` de
 * `abrirOutboxNueva` — pero `ADD COLUMN IF NOT EXISTS` es sintaxis de POSTGRES, no de SQLite.
 * Contra SQLite 3.45.1 (la que embebe `expo-sqlite`) tira `near "EXISTS": syntax error` — y
 * como estaba en el MISMO `execAsync` que crea las tablas base, CADA `abrirOutbox()` fallaba
 * entero: `registrarPuntoGps` no llegaba a escribir un solo punto GPS, en foreground ni en
 * headless, en ninguna instalación (nueva o vieja). Sacar el `IF NOT EXISTS` sin más tampoco
 * alcanza: la segunda apertura del proceso (o cualquier instalación que ya tuviera la
 * columna) rompería con `duplicate column name: enviado_at`.
 *
 * El fix real: `agregarColumnasFaltantes` (abajo) consulta `PRAGMA table_info` y SOLO corre el
 * `ALTER TABLE` — sin `IF NOT EXISTS`, que ahí tampoco existe — cuando la columna todavía no
 * está. Lista (no un solo campo) para que una migración de columna futura se agregue acá sin
 * tocar la lógica de aplicación.
 */
export const MIGRACIONES_COLUMNAS_OUTBOX: readonly MigracionColumna[] = [
  // Momento en que una fila pasó a 'enviado' -- NO es lo mismo que ts (la hora del FIX
  // GPS/evento, que puede ser mucho más vieja que el intento de envío que la marcó).
  // Necesaria para poder distinguir "recién se marcó enviado, el POST todavía puede estar en
  // vuelo" de "quedó huérfana" -- ver recuperarEnviadosHuerfanos más abajo.
  { tabla: 'outbox', columna: 'enviado_at', tipo: 'TEXT' },
  // REDISEÑO (anuncio de puntos de control): anuncios_punto_control nació con 2 columnas
  // (clave, ts) -- instalaciones ya en producción con esa tabla vieja necesitan estas 7
  // columnas nuevas para el estado 'pendiente'/'programando'/'programado' con intención
  // durable (ver marcarAnuncioProgramando/obtenerAnunciosPendientesDeProgramar más abajo).
  { tabla: 'anuncios_punto_control', columna: 'estado', tipo: "TEXT NOT NULL DEFAULT 'programado'" },
  { tabla: 'anuncios_punto_control', columna: 'motivo', tipo: 'TEXT' },
  { tabla: 'anuncios_punto_control', columna: 'sesion_id', tipo: 'TEXT' },
  { tabla: 'anuncios_punto_control', columna: 'punto_control_id', tipo: 'TEXT' },
  { tabla: 'anuncios_punto_control', columna: 'pasada', tipo: 'INTEGER' },
  { tabla: 'anuncios_punto_control', columna: 'intentos', tipo: 'INTEGER NOT NULL DEFAULT 0' },
  { tabla: 'anuncios_punto_control', columna: 'ultimo_intento_ts', tipo: 'TEXT' },
];

/** `ALTER TABLE` plano (sin `IF NOT EXISTS`, que SQLite no soporta ahí) — pura, testeable sin
 * `expo-sqlite`. El nombre de tabla/columna sale de `MIGRACIONES_COLUMNAS_OUTBOX` (constante
 * interna, nunca de input de usuario), así que no hay riesgo de inyección al interpolarlo. */
export function construirAgregarColumna(tabla: string, columna: string, tipo: string): string {
  return `ALTER TABLE ${tabla} ADD COLUMN ${columna} ${tipo}`;
}

/** ¿Falta esta columna? Compara contra los nombres que devuelve `PRAGMA table_info(tabla)` —
 * pura, no toca la base. */
export function faltaColumna(columnasExistentes: string[], columna: string): boolean {
  return !columnasExistentes.includes(columna);
}

/**
 * R2 (hallazgo de `/codex-debug verify-fix` sobre `757af20`, ALTO): ¿este error es SQLite
 * rechazando un `ALTER TABLE ... ADD COLUMN` porque la columna YA EXISTE? El mensaje que tira
 * SQLite (y que `expo-sqlite`/`node:sqlite` propagan tal cual en `error.message`) es
 * `duplicate column name: <columna>` — no viene tipado con un `code` propio (a diferencia de
 * `esHandleNativoMuerto`, que sí puede apoyarse en `error.code`), así que el mensaje es la
 * única señal disponible. Pura para poder testearla sin un error real de SQLite de por medio.
 */
export function esErrorColumnaDuplicada(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const message = 'message' in error ? (error as { message?: unknown }).message : undefined;
  return typeof message === 'string' && /duplicate column name/i.test(message);
}

/**
 * Aplica `MIGRACIONES_COLUMNAS_OUTBOX` una por una: por cada columna, lee `PRAGMA
 * table_info(tabla)` y corre el `ALTER TABLE` SOLO si `faltaColumna` dice que no está — así
 * es segura de llamar en CADA apertura del proceso (`abrirOutbox()` puede correr más de una
 * vez por instalación, ver el comentario de `outboxPromise`) sin repetir un `ALTER TABLE`
 * sobre una columna que ya existe (`duplicate column name`).
 *
 * R2 (hallazgo de `/codex-debug verify-fix`, ALTO — el guard de arriba NO alcanza): `PRAGMA
 * table_info` + `ALTER TABLE` no son atómicos entre sí, y `abrirOutbox()` puede correr en dos
 * CONTEXTOS JS a la vez (headless vs. foreground, ver el comentario de `outboxPromise`) sobre
 * el MISMO archivo `quivo-outbox.db`. Si ambos leen el `PRAGMA` ANTES de que cualquiera de los
 * dos corra su `ALTER TABLE`, los dos ven la columna ausente y los dos intentan agregarla — el
 * segundo `ALTER TABLE` en llegar choca con `duplicate column name`, aunque el guard de arriba
 * sea correcto (cada uno, por su cuenta, SÍ vio la columna ausente en el instante que consultó).
 * No es una ventana teórica: es EXACTAMENTE el escenario que este archivo ya documenta para
 * `abrirOutbox()`/`outboxPromise` — dos contextos abriendo la base en simultáneo.
 *
 * Fix: atrapar específicamente `duplicate column name` (`esErrorColumnaDuplicada`) y tratarlo
 * como ÉXITO — la columna existe, que es justo la postcondición que este paso busca, sin
 * importar QUIÉN la haya agregado. Cualquier otro error (SQL roto, tabla inexistente, etc.) se
 * propaga tal cual — no hay nada seguro que asumir ahí.
 */
async function agregarColumnasFaltantes(db: SQLite.SQLiteDatabase): Promise<void> {
  for (const migracion of MIGRACIONES_COLUMNAS_OUTBOX) {
    // FIX POST-REVISIÓN (hallazgo 9, code review del anuncio de puntos de control — "una
    // migración rota tumba TODO abrirOutbox, perdiendo evidencia"): cada migración corre en su
    // PROPIO try/catch, reportado a Sentry y NUNCA relanzado — ni siquiera un error real (SQL
    // roto, tabla bloqueada, disco lleno) en, por ejemplo, la migración de
    // `anuncios_punto_control` (una tabla secundaria de UX) debe poder impedir que
    // `abrirOutboxNueva` devuelva un handle usable para `gps_point`/evidencia legal
    // (RF-67..73). El peor caso de que una columna puntual no se agregue es que la función que
    // la usa (`marcarAnuncioProgramando`, `recuperarEnviadosHuerfanos`, etc.) falle después —
    // ya capturado en sus propios `try/catch`; perder TODO el outbox no lo es.
    try {
      const columnas = await db.getAllAsync<{ name: string }>(
        `PRAGMA table_info(${migracion.tabla})`,
      );
      if (faltaColumna(columnas.map((columna) => columna.name), migracion.columna)) {
        try {
          await db.execAsync(
            construirAgregarColumna(migracion.tabla, migracion.columna, migracion.tipo),
          );
        } catch (error) {
          if (!esErrorColumnaDuplicada(error)) throw error;
          // Otro contexto ganó la carrera y ya la agregó entre nuestro `PRAGMA` y este
          // `ALTER TABLE` — la postcondición ("la columna existe") ya se cumple, seguimos.
        }
      }
    } catch (error) {
      Sentry.captureException(error, {
        tags: { contexto: 'outbox', paso: 'agregar-columna-faltante' },
        extra: { tabla: migracion.tabla, columna: migracion.columna },
      });
      // Nunca relanza — ver el docblock de la función.
    }
  }
}

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
  await db.execAsync(DDL_OUTBOX);
  // Migraciones de columna APARTE del `execAsync` de arriba (Hallazgo 1, ver el docblock de
  // `MIGRACIONES_COLUMNAS_OUTBOX`): necesitan leer `PRAGMA table_info` antes de decidir si
  // corren, algo que un solo `execAsync` de sentencias fijas no puede condicionar.
  await agregarColumnasFaltantes(db);
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
 * (más abajo) pueda correrlo DENTRO de una transacción cuya recuperación de handle envuelve la
 * transacción ENTERA. Si esta función tuviera su propia recuperación, un handle que muere A
 * MITAD de esa transacción reabriría una conexión NUEVA solo para el INSERT — corriendo FUERA
 * de la transacción abierta en la conexión vieja (ahora zombi) — mientras el `DELETE` de al
 * lado podría (o no) terminar en una tercera conexión: exactamente la ruptura de atomicidad
 * que R2 existe para cerrar. `encolarEvento` (abajo) es el único wrapper con recuperación
 * propia, para el camino simple (sin transacción) que no tiene este riesgo.
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
 * Fórmula ÚNICA de la clave PK de `anuncios_punto_control` — usada tanto acá como en
 * `features/operacion/anuncio-punto-control.ts` (como fallback ANTES de que
 * `reclamarIntencionAnuncio` resuelva, y como clave de su mapa de reclamos fallidos) — un
 * cambio de formato en uno sin el otro desincronizaría silenciosamente la identidad reclamada
 * de la que ejecuta.
 */
export function claveAnuncio(sesionId: string, puntoControlId: string, pasada: number): string {
  return `${sesionId}:${puntoControlId}:${pasada}`;
}

/**
 * REDISEÑO (decisión del CTO, ronda posterior al veredicto `partial` de Codex `verify-fix` del
 * 2026-09-23, punto 3 del brief — "intención durable ANTES de programar"): reclama ATÓMICAMENTE
 * la INTENCIÓN de anunciar "llegaste" para una visita — `INSERT OR IGNORE` en estado
 * `'pendiente'`, ANTES de intentar `scheduleNotificationAsync` (`anunciarLlegadaPuntoControl`,
 * `features/operacion/anuncio-punto-control.ts`). `clave` (`claveAnuncio`, arriba) es la PK, así
 * que dos decisiones concurrentes para la MISMA visita (dos ticks que terminan decidiendo el
 * mismo motivo, o un reintento superpuesto) solo dejan que UNA reclame — la otra ve
 * `reclamado: false` y no debe programar nada.
 */
export async function reclamarIntencionAnuncio(
  db: SQLite.SQLiteDatabase,
  sesionId: string,
  puntoControlId: string,
  pasada: number,
  motivo: string,
): Promise<{ reclamado: boolean; clave: string }> {
  const clave = claveAnuncio(sesionId, puntoControlId, pasada);
  const result = await conReintentoSiHandleMuerto(db, (dbActiva) =>
    dbActiva.runAsync(
      `INSERT OR IGNORE INTO anuncios_punto_control
         (clave, ts, estado, motivo, sesion_id, punto_control_id, pasada)
       VALUES (?, ?, 'pendiente', ?, ?, ?, ?)`,
      [clave, new Date().toISOString(), motivo, sesionId, puntoControlId, pasada],
    ),
  );
  return { reclamado: result.changes > 0, clave };
}

/** Marca una intención YA reclamada (`reclamarIntencionAnuncio`) como `'programado'` — tras
 * `scheduleNotificationAsync` con éxito. Si esto falla (SQLite ocupada), la fila queda
 * `'programando'` (ver `marcarAnuncioProgramando`) y `obtenerAnunciosPendientesDeProgramar` la
 * vuelve a ofrecer una vez que ese intento quede viejo (ver `ANUNCIO_PROGRAMANDO_STALE_MS`). */
export async function marcarAnuncioProgramado(db: SQLite.SQLiteDatabase, clave: string): Promise<void> {
  await conReintentoSiHandleMuerto(db, (dbActiva) =>
    dbActiva.runAsync("UPDATE anuncios_punto_control SET estado = 'programado' WHERE clave = ?", [
      clave,
    ]),
  );
}

/**
 * FIX POST-REVISIÓN (hallazgo 1, code review del anuncio de puntos de control — "'pendiente'
 * mezcla dos significados"): marca la fila como `'programando'`, con la marca de tiempo del
 * intento y el contador de intentos incrementado — se llama justo ANTES de intentar
 * `scheduleNotificationAsync`, tanto en el primer intento (`anunciarLlegadaPuntoControl`) como
 * en cada reintento (`reintentarAnunciosLlegadaPendientes`, `anuncio-punto-control.ts`).
 * Mientras la fila sigue `'programando'` con un intento FRESCO (menos de
 * `ANUNCIO_PROGRAMANDO_STALE_MS`), `obtenerAnunciosPendientesDeProgramar` NO la vuelve a
 * ofrecer — sin esto, un reintento concurrente (headless y foreground compitiendo por la MISMA
 * visita, o dos ticks seguidos de la cola) podía reclamar un intento que YA estaba en vuelo y
 * disparar la vibración/notificación una SEGUNDA vez para el mismo "llegaste".
 */
export async function marcarAnuncioProgramando(db: SQLite.SQLiteDatabase, clave: string): Promise<void> {
  await conReintentoSiHandleMuerto(db, (dbActiva) =>
    dbActiva.runAsync(
      `UPDATE anuncios_punto_control
         SET estado = 'programando', ultimo_intento_ts = ?, intentos = intentos + 1
       WHERE clave = ?`,
      [new Date().toISOString(), clave],
    ),
  );
}

export interface AnuncioLlegadaPendienteRow {
  clave: string;
  sesionId: string;
  puntoControlId: string;
  pasada: number;
  motivo: string;
}

/** Ventana máxima que una fila `'programando'` puede quedar sin reintentarse antes de tratarse
 * como abandonada (el intento anterior murió sin marcar ni `'programado'` ni volver a
 * `'programando'`) — ver el docblock de `marcarAnuncioProgramando`. Holgada respecto del
 * intervalo de fixes/heartbeats (10-60 s) para no competir con un intento genuinamente en curso. */
export const ANUNCIO_PROGRAMANDO_STALE_MS = 2 * 60 * 1000;

/** FIX POST-REVISIÓN (hallazgo 5, "el reintento no filtra por sesión/antigüedad/intentos"):
 * antigüedad máxima (desde `reclamarIntencionAnuncio`, columna `ts`) de una fila que todavía vale
 * la pena reintentar. Pasada esta ventana, `obtenerAnunciosPendientesDeProgramar` la PURGA en vez
 * de seguir ofreciéndola — sin esto, una intención reclamada un día y nunca programada (proceso
 * matado antes de programar, o un fallo persistente) se reintentaba PARA SIEMPRE, sesión tras
 * sesión, mientras el dispositivo siguiera encendido. */
export const ANUNCIO_TTL_MS = 24 * 60 * 60 * 1000;

/** FIX POST-REVISIÓN (hallazgo 5): techo de reintentos — una notificación que sigue fallando
 * `ANUNCIO_MAX_INTENTOS` veces seguidas (canal roto, permiso revocado a mitad de turno) deja de
 * ofrecerse: mejor un "llegaste" perdido después de varios intentos genuinos que un reintento sin
 * fin que nunca va a tener éxito. */
export const ANUNCIO_MAX_INTENTOS = 5;

/** Intenciones reclamadas (`reclamarIntencionAnuncio`) cuya notificación NUNCA se programó con
 * éxito — el próximo tick de la cola las reintenta. Filtra por `sesionId` (hallazgo 5 — nunca
 * reintenta anuncios de una sesión distinta a la que está corriendo AHORA) y purga, ANTES de
 * listar, las filas vencidas por antigüedad (`ANUNCIO_TTL_MS`) o por intentos agotados
 * (`ANUNCIO_MAX_INTENTOS`) sin importar la sesión — esa purga sí es global, para que el outbox no
 * acumule filas de sesiones viejas para siempre. Una fila `'programando'` solo se ofrece de nuevo
 * cuando su último intento quedó viejo (`ANUNCIO_PROGRAMANDO_STALE_MS`, hallazgo 1) — mientras
 * sigue fresca, otro intento ya está (o podría estar) en vuelo. Filas incompletas (legado de la
 * tabla de 2 columnas previa al rediseño, migradas sin identidad reconstruible) se descartan en
 * vez de reventar: nunca fueron reclamadas por este mecanismo, no hay nada que reintentar. */
export async function obtenerAnunciosPendientesDeProgramar(
  db: SQLite.SQLiteDatabase,
  sesionId: string,
  ahoraMs: number = Date.now(),
): Promise<AnuncioLlegadaPendienteRow[]> {
  const vencidoIso = new Date(ahoraMs - ANUNCIO_TTL_MS).toISOString();
  const staleIso = new Date(ahoraMs - ANUNCIO_PROGRAMANDO_STALE_MS).toISOString();

  // Purga best-effort — un fallo acá no debe impedir listar lo que sigue siendo válido; el
  // próximo tick vuelve a intentar la purga.
  try {
    await conReintentoSiHandleMuerto(db, (dbActiva) =>
      dbActiva.runAsync('DELETE FROM anuncios_punto_control WHERE ts < ? OR intentos >= ?', [
        vencidoIso,
        ANUNCIO_MAX_INTENTOS,
      ]),
    );
  } catch (error) {
    Sentry.captureException(error, {
      tags: { contexto: 'outbox', paso: 'purgar-anuncios-vencidos' },
    });
  }

  const rows = await conReintentoSiHandleMuerto(db, (dbActiva) =>
    dbActiva.getAllAsync<{
      clave: string;
      sesion_id: string | null;
      punto_control_id: string | null;
      pasada: number | null;
      motivo: string | null;
    }>(
      `SELECT clave, sesion_id, punto_control_id, pasada, motivo FROM anuncios_punto_control
       WHERE sesion_id = ?
         AND (estado = 'pendiente' OR (estado = 'programando' AND (ultimo_intento_ts IS NULL OR ultimo_intento_ts < ?)))`,
      [sesionId, staleIso],
    ),
  );
  const resultado: AnuncioLlegadaPendienteRow[] = [];
  for (const row of rows) {
    if (
      row.sesion_id === null ||
      row.punto_control_id === null ||
      row.pasada === null ||
      row.motivo === null
    ) {
      continue;
    }
    resultado.push({
      clave: row.clave,
      sesionId: row.sesion_id,
      puntoControlId: row.punto_control_id,
      pasada: row.pasada,
      motivo: row.motivo,
    });
  }
  return resultado;
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
 * La transacción (`withTransactionAsync`) se abre DENTRO de `conReintentoSiHandleMuerto`, no al
 * revés (R2, hallazgo de revisión SERIO — "atomicidad rota por recuperación de handle"): si
 * `db` muere a mitad de la transacción, esa recuperación interna reabría una conexión NUEVA y
 * correría el INSERT (o el DELETE) ahí — FUERA de la transacción abierta en la conexión vieja
 * (ya zombi) — mientras el `COMMIT` implícito de `withTransactionAsync`, al final, seguía
 * apuntando al handle MUERTO y fallaba. Con la transacción entera envuelta en
 * `conReintentoSiHandleMuerto`, un handle que muere en CUALQUIER punto (BEGIN, INSERT, DELETE o
 * COMMIT) hace que la función reintente la operación COMPLETA una vez, desde cero, contra una
 * ÚNICA conexión fresca (`dbActiva`) — nunca mezcla dos conexiones dentro de la misma
 * transacción. `insertarEventoRaw`/`eliminarVisitaPendienteRaw` (sin su propia recuperación)
 * son justamente lo que hace esto seguro.
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

/** Distinto de `actualizarEstado` (usado por `marcarAcusados` abajo): además del estado, sella
 * `enviado_at` con el momento REAL de este intento — lo que `recuperarEnviadosHuerfanos`
 * necesita para decidir si una fila `enviado` es un POST todavía en vuelo o una huérfana
 * (hallazgo 3, ver esa función). */
export async function marcarEnviados(db: SQLite.SQLiteDatabase, eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return;
  const placeholders = eventIds.map(() => '?').join(',');
  await conReintentoSiHandleMuerto(db, (dbActiva) =>
    dbActiva.runAsync(
      `UPDATE outbox SET estado = 'enviado', enviado_at = ? WHERE event_id IN (${placeholders})`,
      [new Date().toISOString(), ...eventIds],
    ),
  );
}

/** El servidor acusó estos `event_id` puntuales (202 de QUI-240) — quedan sincronizados de
 * verdad. Los que no vengan en el acuse (rechazados o simplemente no llegaron a procesarse)
 * quedan como estaban para reintentar en el próximo lote. */
export async function marcarAcusados(db: SQLite.SQLiteDatabase, eventIds: string[]): Promise<void> {
  await actualizarEstado(db, eventIds, 'acusado');
}

/**
 * SQL de la reversión con GUARDA DE ESTADO, aislado como función pura para poder testearlo sin
 * un módulo nativo de por medio (mismo patrón que `construirPurgaAcusados`, arriba).
 *
 * 🔴 BUG DE PRODUCCIÓN que este guard corrige: `sincronizarPendientes`
 * (`features/operacion/sync-outbox.ts`) marca el lote entero `enviado`, lo manda, y en su
 * `catch` (fallo de red/timeout) revertía el LOTE ENTERO a `pendiente` sin mirar qué pasó con
 * cada `event_id` puntual. Si el POST llegó al servidor y se procesó (202 de QUI-240) pero la
 * RESPUESTA se perdió en el camino de vuelta (timeout de 20 s, red boliviana), el servidor YA
 * tiene esos eventos — pero el cliente, sin este guard, los devolvía a `pendiente` igual y los
 * reenviaba PARA SIEMPRE, sin que nada los volviera a marcar `acusado` (el próximo acuse del
 * servidor no vuelve a mencionar un `event_id` que ya procesó antes). `acusado` es un estado
 * TERMINAL — es el contrato de QUI-238 ("`acusado` = confirmado por el servidor") — y nada debe
 * sacarlo de ahí. El `AND estado = 'enviado'` hace que solo los eventos que de verdad siguen en
 * vuelo (nadie los acusó todavía) vuelvan a `pendiente`; un `event_id` que ya está `acusado` no
 * matchea la condición y la fila queda intacta.
 */
export function construirRevertirAPendiente(
  eventIds: string[],
): { sql: string; params: string[] } {
  const placeholders = eventIds.map(() => '?').join(',');
  return {
    sql: `UPDATE outbox SET estado = 'pendiente' WHERE event_id IN (${placeholders}) AND estado = 'enviado'`,
    params: [...eventIds],
  };
}

/** Reintento tras fallo de red/timeout del lote completo: vuelve `enviado` -> `pendiente` para
 * que el próximo ciclo de sync los tome de nuevo (con backoff, ver QUI-240). Ver
 * `construirRevertirAPendiente` para el porqué del guard de estado — a diferencia de
 * `marcarEnviados`/`marcarAcusados` (que pasan por `actualizarEstado` sin condición, porque ahí
 * el estado de origen no importa), esta función NUNCA debe poder pisar un `acusado`. */
export async function revertirAPendiente(
  db: SQLite.SQLiteDatabase,
  eventIds: string[],
): Promise<void> {
  if (eventIds.length === 0) return;
  const { sql, params } = construirRevertirAPendiente(eventIds);
  await conReintentoSiHandleMuerto(db, (dbActiva) => dbActiva.runAsync(sql, params));
}

/**
 * Hallazgo 3 (code review, MEDIO — `sincronizarPendientes`, `features/operacion/sync-outbox.ts`):
 * marca el lote `enviado` ANTES del POST, y solo lo revierte a `pendiente` en su propio
 * `catch` (fallo de red visible). Si Android mata la tarea headless A MITAD del POST (el
 * proceso muere entero, ningún `catch` de JS llega a correr), o el POST queda colgado más
 * allá del TTL de 60 s del lease (`docs/handoff.md` documenta que en Android, con la Activity
 * pausada, OkHttp puede no respetar ningún timeout propio), esas filas quedan `enviado` PARA
 * SIEMPRE — nadie las revierte y `obtenerLotePendiente` solo mira `estado = 'pendiente'`. El
 * comentario original de `drenaje-oportunista.ts` ("colgado hasta el próximo intento") era
 * falso: sin este reproceso, ES pérdida definitiva de evidencia legal (RF-67..73), no una
 * demora.
 *
 * Reenviar es SEGURO por construcción: la ingesta del servidor es idempotente por `eventId`
 * (`ON CONFLICT (event_id, ts) DO NOTHING`, ver el comentario de cabecera de este archivo) —
 * si el POST huérfano en realidad SÍ llegó a procesarse del lado del servidor antes de que el
 * proceso muriera, reenviarlo no duplica nada, solo repite trabajo ya hecho.
 *
 * `antesDe` la decide el caller según SU contexto (el umbral tiene que ser mayor que el
 * timeout del request Y que el TTL del lease de drenado — ver
 * `UMBRAL_RECUPERACION_ENVIADOS_MS`, `drenaje-oportunista.ts` — para no reclamar como
 * "huérfano" un POST que en realidad sigue vivo y a punto de resolver).
 *
 * `COALESCE(enviado_at, ts)`: filas `enviado` de una instalación de ANTES de esta columna (o
 * de una corrida que falló entre el `ALTER TABLE` y el primer `marcarEnviados` tras
 * actualizar) no tienen `enviado_at` — se usa `ts` (la hora de creación del evento, siempre
 * más vieja que cuando se marcó `enviado`) como piso conservador: una fila sin `enviado_at`
 * es, como mínimo, tan vieja como parece por su `ts`, así que cae del lado seguro de la
 * recuperación en vez de quedar bloqueada para siempre por falta de dato.
 *
 * Guarda respetada (Entrega 1): solo transiciona `estado = 'enviado'` — un `acusado` nunca
 * matchea esta condición, exactamente igual que `construirRevertirAPendiente`.
 */
export function construirRecuperarEnviadosHuerfanos(
  antesDe: Date,
): { sql: string; params: string[] } {
  return {
    sql: "UPDATE outbox SET estado = 'pendiente' WHERE estado = 'enviado' AND COALESCE(enviado_at, ts) < ?",
    params: [antesDe.toISOString()],
  };
}

/** Aplica `construirRecuperarEnviadosHuerfanos` — ver su docblock. Devuelve la cantidad de
 * filas recuperadas (0 en el caso común: nada quedó huérfano). */
export async function recuperarEnviadosHuerfanos(
  db: SQLite.SQLiteDatabase,
  antesDe: Date,
): Promise<number> {
  const { sql, params } = construirRecuperarEnviadosHuerfanos(antesDe);
  const result = await conReintentoSiHandleMuerto(db, (dbActiva) => dbActiva.runAsync(sql, params));
  return result.changes;
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

/**
 * Lease de exclusión mutua para el drenado oportunista del outbox en background (Entrega 2,
 * `docs/plan-correccion-post-piloto-2026-09-09.md`). Vive en la propia SQLite del outbox —NO
 * en un `let` de módulo— porque el mutex tiene que cruzar CONTEXTOS JS: la tarea headless de
 * Transistorsoft y el hook de foreground pueden correr en procesos/contextos JS distintos en
 * Android (a diferencia de la cola en memoria de `headless-task.ts`, que sí puede asumir un
 * único contexto para `registrarPuntoGps` porque ese SÍ está documentado como compartido —
 * ver `HeadlessTaskManager.java:184-206` citado en `docs/handoff.md`). Un `let` de módulo NO
 * cubre ese caso: cada contexto JS tiene su propia copia, así que dos "mutex" en memoria
 * distintos nunca se ven entre sí y el mismo lote se drenaría dos veces en paralelo.
 *
 * Una sola fila por `id` (`sync_lease.id` es PK) sirve DOS propósitos con el mismo mecanismo:
 * - **Mutex entre contextos**: mientras `expira_at` esté en el futuro, la fila está "tomada" y
 *   nadie más puede adquirirla.
 * - **Piso de 10 s entre intentos + backoff**: `liberarLeaseConCooldown` no borra la fila al
 *   terminar — la deja "tomada" hasta `ahora + cooldown`. Un éxito libera con el piso fijo
 *   (10 s); un fallo libera con el backoff exponencial vigente. El próximo intento, sea del
 *   mismo contexto o del otro, encuentra la fila todavía vigente y desiste sin tocar la red.
 *
 * El TTL es OBLIGATORIO (ver `adquirirLease`): si el proceso muere a mitad de un drenado (la
 * app es matada por Android, un crash) sin llegar a liberar, la fila queda "tomada" con el
 * `expira_at` que se le puso AL ADQUIRIR (el TTL de la operación, no el del cooldown) — pasado
 * ese punto cualquier intento nuevo la recupera solo. Sin este TTL, un lease huérfano
 * bloquearía el drenado para siempre y el outbox nunca más se vaciaría en background.
 */
export const ID_LEASE_DRENAJE = 'drenaje-outbox';

/**
 * Piso duro entre intentos EXITOSOS del drenado oportunista (Entrega 2) — evita que un GPS a
 * alta frecuencia (`distanceFilter` 15 m ≈ cada pocos segundos a velocidad de calle) dispare
 * un POST por cada fix. Vive ACÁ (no en `drenaje-oportunista.ts`, su dueño original) porque
 * `sync-outbox.ts` también lo necesita para su propia variante con lease (hallazgo 6, code
 * review: `iniciarSyncAutomatico` llamaba a `sincronizarPendientes` SIN pasar por el lease) —
 * `sync-outbox.ts` no puede importar de `drenaje-oportunista.ts` sin crear un ciclo, porque
 * `drenaje-oportunista.ts` ya importa `sincronizarPendientes` DESDE `sync-outbox.ts`.
 */
export const PISO_ENTRE_INTENTOS_DRENAJE_MS = 10_000;

/** TTL del lease en sí (distinto del cooldown de arriba) — ver el comentario de
 * `ID_LEASE_DRENAJE`. Mismo motivo de ubicación que `PISO_ENTRE_INTENTOS_DRENAJE_MS`. */
export const TTL_LEASE_DRENAJE_MS = 60_000;

/**
 * G1 (hallazgo de `/codex-debug verify-fix`, ALTO, sobre `ea3d84e`/`fe36953`): mismo mutex
 * entre contextos JS que `ID_LEASE_DRENAJE`, pero para el REFRESH de tokens en vez del
 * drenado. `reconciliarConDisco` (`use-auth-movil.ts`) releía SecureStore antes de intentar,
 * pero eso solo cierra la ventana DENTRO de un mismo contexto (el single-flight en memoria,
 * `refrescosEnVuelo`, tampoco cruza contextos) — foreground y headless corren en contextos JS
 * DISTINTOS en Android, y pueden leer el MISMO refresh token T0 antes de que ninguno de los
 * dos lo rote. Con la fila `sync_lease` reutilizada bajo este `id` distinto, solo un contexto
 * puede estar releyendo+refrescando+persistiendo a la vez — el otro espera (o, si el que
 * tiene el lease ya rotó, relee disco al entrar y adopta el token nuevo SIN tocar la red — ver
 * `ejecutarRefresh` en `use-auth-movil.ts`).
 */
export const ID_LEASE_REFRESH_SESION = 'refresh-sesion';

/**
 * TTL del lease de refresh — holgado sobre `REQUEST_TIMEOUT_MS` (12 s, `auth-movil-api.ts`),
 * la única llamada de red que corre bajo este lease. G1 (hallazgo de `/codex-debug verify-fix`
 * ronda 4, ALTO): el margen anterior (3 s) no dejaba lugar a que el `setTimeout` del request
 * (que NO acota una suspensión del runtime, solo el tiempo de red una vez que el JS corre) más
 * las relecturas de SecureStore/escritura final se completaran antes de que el TTL venciera.
 * Subido a 8 s de margen (20 s total): cubre esas relecturas/escritura con holgura real bajo
 * carga, sin pretender ser una garantía — la garantía de fondo NO es este margen, es el
 * compare-and-set de `ejecutarRefresh` (`renovarLease` justo antes de persistir, en
 * `use-auth-movil.ts`): si el margen igual no alcanza y el lease se pierde después de que el
 * servidor ya rotó, ese chequeo detecta la pérdida y aborta la persistencia insegura en vez de
 * arriesgar pisar el estado de otro contexto — ver su docblock para el caso aceptado
 * explícitamente que queda (el próximo 401 exige un login limpio).
 */
export const TTL_LEASE_REFRESH_SESION_MS = 20_000;

/**
 * Punto 4 (code review 2026-09-25): mutex propio para la colección de revocaciones pendientes
 * (`REVOCACIONES_PENDIENTES_KEY`, `sesion-movil-store.ts`) — `guardarRevocacionPendiente`/
 * `borrarRevocacionPendientePorId` hacen relectura+escritura sobre esa clave de SecureStore sin
 * ninguna sincronización, y foreground/headless pueden pisarse (una entrada que
 * `ejecutarLogout` acaba de agregar desaparece si una pasada de `intentarRevocacionesPendientes`
 * ya había releído la colección ANTES de esa escritura).
 *
 * Deliberadamente UN `id` de lease DISTINTO a `ID_LEASE_REFRESH_SESION`, no el mismo (aunque el
 * hallazgo original lo sugería): `ejecutarLogout` (`use-auth-movil.ts`) llama a
 * `guardarRevocacionPendiente`/`borrarRevocacionPendientePorId` MIENTRAS ya tiene tomado
 * `ID_LEASE_REFRESH_SESION` para sí mismo — reusar ese mismo lease acá autobloquearía esa
 * escritura contra su propio dueño (el mismo contexto JS, pero un `token` distinto no es
 * reentrante para este mecanismo). Un lease separado, de vida brevísima (solo cubre leer +
 * escribir un blob JSON chico de SecureStore, nunca una llamada de red), evita ese
 * autobloqueo sin perder la propiedad que importa: exclusión mutua entre CONTEXTOS JS
 * distintos sobre la MISMA colección.
 */
export const ID_LEASE_REVOCACIONES_PENDIENTES = 'revocaciones-pendientes';

/** TTL brevísimo a propósito (ver el comentario de `ID_LEASE_REVOCACIONES_PENDIENTES`): la
 * sección crítica que cubre es solo leer+parsear+escribir SecureStore, nunca una llamada de
 * red — unos pocos cientos de ms de margen alcanzan de sobra, y un TTL corto hace que un
 * lease huérfano (proceso matado a mitad de la escritura) se libere solo rápido. */
export const TTL_LEASE_REVOCACIONES_PENDIENTES_MS = 3_000;

/**
 * Hallazgo 4 (code review, BAJO — reloj de pared sin cota superior): `adquirirLease` compara
 * `expira_at` contra `Date.now()` con reloj de PARED, sin ninguna cota — si el reloj del
 * teléfono estaba adelantado y salta hacia atrás (corrección NTP, o el chofer lo ajusta a
 * mano) en X ms, una fila escrita bajo el reloj VIEJO (adelantado) queda con `expira_at` hasta
 * X ms en el futuro DEL RELOJ NUEVO — `adquirirLease` la ve "tomada" y falla todo ese tiempo,
 * aunque nadie esté drenando de verdad y el dueño original ya haya terminado (o muerto) hace
 * rato.
 *
 * Fix: tratar el lease como libre TAMBIÉN si `expira_at` está a más de esta cota en el futuro
 * — ningún camino LEGÍTIMO de este lease (adquisición con `TTL_LEASE_DRENAJE_MS`, liberación
 * con el piso fijo de `PISO_ENTRE_INTENTOS_DRENAJE_MS` o con el backoff exponencial de
 * `drenaje-oportunista.ts`/`sync-outbox.ts`, que topea en 60 s en los dos) escribe, bajo un
 * reloj ESTABLE, un `expira_at` más de `TTL_LEASE_DRENAJE_MS` (60 s) en el futuro. El doble de
 * margen sobre ese peor caso (120 s en vez de 60 s) es a propósito: un lease legítimo recién
 * adquirido nunca se acerca a esa cota, así que nunca se libera de más por error — solo un
 * salto de reloj hacia atrás mayor a 60 s produce un `expira_at` que la cruza.
 *
 * Duplicado acá en vez de importado desde `drenaje-oportunista.ts`/`sync-outbox.ts` (que YA
 * importan de `outbox.ts` — un import en sentido contrario crearía un ciclo).
 *
 * R (hallazgo de `/codex-debug verify-fix`, regresión evaluada, NO corregida a propósito):
 * `ID_LEASE_REFRESH_SESION` reutiliza el MISMO `construirAdquirirLease`/esta misma cota, con un
 * TTL propio menor (`TTL_LEASE_REFRESH_SESION_MS`, 15 s). La cota queda fija en
 * `TTL_LEASE_DRENAJE_MS + 60_000` (120 s) para AMBOS leases — más holgada de lo estrictamente
 * necesario para el de refresh, pero eso solo hace el margen de seguridad más grande, nunca más
 * chico: un salto de reloj hacia atrás sigue necesitando superar 120 s para colar un
 * `expira_at` fantasma, igual que en el lease de drenado. La ventana de drenados/refrescos
 * concurrentes que ese salto podría abrir (documentada arriba) queda acotada por el TTL de
 * CADA lease — 15 s en el de refresh, más angosta que los 60 s del de drenado — y no se cierra
 * del todo por diseño: la cota es una red de seguridad contra un lease huérfano, no una prueba
 * de reloj monótono. Aceptado tal cual, sin cambios, para esta entrega.
 */
export const COTA_SANIDAD_LEASE_MS = TTL_LEASE_DRENAJE_MS + 60_000;

/**
 * UPSERT atómico con guarda temporal: adquiere la fila `id` SOLO si no existe todavía, si su
 * `expira_at` ya pasó (`ahoraMs`), o si `expira_at` está tan lejos en el futuro que solo puede
 * explicarse por un salto de reloj hacia atrás (Hallazgo 4, `COTA_SANIDAD_LEASE_MS`) — soporta
 * desde SQLite 3.35 (UPSERT con cláusula `WHERE` en `DO UPDATE`, muy por debajo de lo que
 * embebe `expo-sqlite`). `changes > 0` es la señal de "adquirido": si la fila existe y ninguna
 * de las dos condiciones matchea, la cláusula `WHERE` del `DO UPDATE` no matchea y SQLite
 * trata el statement entero como no-op (0 filas afectadas, sin lanzar ningún error de
 * constraint) — un solo `runAsync` resuelve "¿está libre (o parece corrupta)? si sí, tomala"
 * sin ventana entre el chequeo y la toma, que es exactamente lo que dos contextos JS
 * compitiendo por el mismo lease necesitan.
 *
 * `token` identifica a ESTE intento puntual (no al proceso ni al contexto) — ver
 * `construirLiberarLeaseConCooldown` para el porqué: solo el dueño legítimo puede liberar.
 */
export function construirAdquirirLease(
  id: string,
  token: string,
  ahoraMs: number,
  expiraAtMs: number,
): { sql: string; params: (string | number)[] } {
  return {
    sql: `
      INSERT INTO sync_lease (id, owner, expira_at) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, expira_at = excluded.expira_at
      WHERE sync_lease.expira_at <= ? OR sync_lease.expira_at > ?
    `,
    params: [id, token, expiraAtMs, ahoraMs, ahoraMs + COTA_SANIDAD_LEASE_MS],
  };
}

/**
 * Intenta tomar el lease `id` para `token`. `ttlMs` es el techo de seguridad de ESTA operación
 * (no el cooldown post-éxito, ver `liberarLeaseConCooldown`): generoso a propósito (cubre un
 * `POST /v1/sync/batches` completo + el reintento de handle muerto de
 * `conReintentoSiHandleMuerto`) para no expirar un drenado que sigue vivo y legítimo, pero
 * finito — es la única red de seguridad contra un lease huérfano si el proceso muere a mitad
 * de la operación sin liberar.
 */
export async function adquirirLease(
  db: SQLite.SQLiteDatabase,
  id: string,
  token: string,
  ahoraMs: number,
  ttlMs: number,
): Promise<boolean> {
  const { sql, params } = construirAdquirirLease(id, token, ahoraMs, ahoraMs + ttlMs);
  const result = await conReintentoSiHandleMuerto(db, (dbActiva) => dbActiva.runAsync(sql, params));
  return result.changes > 0;
}

/**
 * Condicionado por `owner = token` (no solo por `id`): entre que un contexto ADQUIERE el lease
 * (con un TTL holgado, arriba) y lo LIBERA, otro contexto puede haber reclamado la misma fila
 * como huérfana si el TTL alcanzó a vencer mientras el primero seguía trabajando (más lento de
 * lo previsto, pero sin haber muerto). Sin el filtro por `owner`, la liberación tardía del
 * primero pisaría el lease del segundo, que en ese momento sigue legítimamente en vuelo — dos
 * drenados concurrentes, justo lo que el lease existe para impedir. Con el filtro, una
 * liberación tardía sobre un lease que ya cambió de dueño simplemente no afecta ninguna fila
 * (`changes === 0`), silenciosamente — no hay nada que reportar, el nuevo dueño sigue su curso.
 */
export function construirLiberarLeaseConCooldown(
  id: string,
  token: string,
  ahoraMs: number,
  cooldownMs: number,
): { sql: string; params: (string | number)[] } {
  return {
    sql: 'UPDATE sync_lease SET expira_at = ? WHERE id = ? AND owner = ?',
    params: [ahoraMs + cooldownMs, id, token],
  };
}

/**
 * Libera el lease dejándolo "tomado" hasta `ahoraMs + cooldownMs` — nunca lo borra, porque ese
 * cooldown ES el piso de 10 s / backoff entre intentos (ver el comentario de `ID_LEASE_DRENAJE`
 * arriba). El próximo `adquirirLease`, en cualquier contexto, ve `expira_at` todavía en el
 * futuro y desiste sin tocar la red hasta que venza.
 */
export async function liberarLeaseConCooldown(
  db: SQLite.SQLiteDatabase,
  id: string,
  token: string,
  ahoraMs: number,
  cooldownMs: number,
): Promise<void> {
  const { sql, params } = construirLiberarLeaseConCooldown(id, token, ahoraMs, cooldownMs);
  await conReintentoSiHandleMuerto(db, (dbActiva) => dbActiva.runAsync(sql, params));
}

/**
 * R1 (hallazgo de `/codex-debug verify-fix` sobre `5379e00`/`cf1601f`, ALTO): renueva el lease
 * `id` para `token`, empujando `expira_at` a `ahoraMs + ttlMs` — MISMO SQL que
 * `construirLiberarLeaseConCooldown` (un `UPDATE` condicionado por `owner = token`), pero
 * llamado ANTES de cada lote de un drenado encadenado (`drenarLotesConLease`,
 * `features/operacion/sync-outbox.ts`), no solo al liberar al final.
 *
 * Sin esto, un encadenado de hasta `TOPE_LOTES_POR_CICLO_DRENAJE` lotes (hasta 10k eventos)
 * podía superar el TTL de 60 s del lease SIN renovarlo — la fila quedaba "tomada" según el
 * `expira_at` de la ADQUISICIÓN original mientras el drenado real seguía en curso mucho más
 * allá de ese instante. Pasado el TTL, cualquier otro contexto (headless vs. foreground) ve la
 * fila como huérfana y la toma — dos drenados concurrentes, justo lo que el lease existe para
 * impedir.
 *
 * Devuelve si la renovación tuvo efecto: `changes > 0` (`true`) significa "sigo siendo el
 * dueño, renovado"; `0` (`false`) significa que la fila YA NO ES MÍA — o bien otro contexto la
 * tomó porque mi TTL alcanzó a vencer entre lotes, o bien un salto de reloj hacia atrás la hizo
 * pasar la cota de sanidad (`COTA_SANIDAD_LEASE_MS`) y algún tercero la reclamó como huérfana.
 * El caller (`drenarLotesConLease`) debe cortar el bucle DE INMEDIATO ante `false`, SIN llamar
 * a `liberarLeaseConCooldown` — liberar acá pisaría el lease legítimo del nuevo dueño. Acota
 * (no elimina del todo) el hallazgo R3 de la misma verificación: un dueño desplazado por la
 * cota de reloj lo detecta a más tardar en el lote SIGUIENTE (nunca sigue enviando a ciegas
 * indefinidamente), y como la ingesta del servidor es idempotente por `eventId`
 * (`ON CONFLICT ... DO NOTHING`), a lo sumo el lote que estaba en vuelo en ese instante se
 * solapa con el que arranca el nuevo dueño — nunca pérdida ni duplicación permanente.
 */
export async function renovarLease(
  db: SQLite.SQLiteDatabase,
  id: string,
  token: string,
  ahoraMs: number,
  ttlMs: number,
): Promise<boolean> {
  const { sql, params } = construirLiberarLeaseConCooldown(id, token, ahoraMs, ttlMs);
  const result = await conReintentoSiHandleMuerto(db, (dbActiva) => dbActiva.runAsync(sql, params));
  return result.changes > 0;
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

/**
 * DDL de `quivo-outbox.db`, aislado en su propio módulo SIN NINGÚN IMPORT — a propósito.
 *
 * FIX POST-REVISIÓN (bug 5, requisito "SQL de SQLite" del brief): `outbox.ts` importa
 * `expo-sqlite`/`@sentry/react-native`, que arrastran `react-native` de forma transitiva
 * (el propio paquete `react-native/index.js` usa sintaxis Flow, `import typeof * as ...`, que
 * el parser de Vite/Rollup que usa vitest no puede parsear) — así que ningún test puede
 * importar `outbox.ts` directo bajo vitest (mismo motivo por el que `location-task.ts`/
 * `geofence.ts` documentan explícitamente que se mantienen SIN dependencia de `expo-sqlite`,
 * para seguir siendo testeables). Sacar el DDL a este módulo aparte — sin un solo `import` —
 * es lo que permite que `db/outbox-ddl.test.ts` lo ejecute contra SQLite real (`node:sqlite`)
 * sin arrastrar `react-native` al proceso de vitest. `outbox.ts` reexporta `OUTBOX_DDL_SQL`
 * desde acá para que el resto del código siga viéndolo como si fuera parte de ese módulo.
 *
 * Todo `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` — idempotente por
 * construcción, sin ningún `ALTER TABLE` (no hace falta: son tablas nuevas). Otra rama tuvo un
 * bug CRÍTICO por usar `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, que NO es SQLite válido
 * (SQLite no soporta `IF NOT EXISTS` en `ADD COLUMN`) — este archivo, y el test que lo
 * acompaña, existen para que ese error de sintaxis nunca vuelva a llegar sin que un test lo
 * agarre primero.
 */
export const OUTBOX_DDL_SQL = `
    CREATE TABLE IF NOT EXISTS outbox (
      event_id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      ts TEXT NOT NULL,
      tipo TEXT NOT NULL,
      payload TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'pendiente'
    );
    CREATE INDEX IF NOT EXISTS outbox_estado_idx ON outbox(estado);
    -- ENTREGA 7 (plan post-piloto 2026-09-09, "anuncio desde headless"): dedupe PERSISTIDO del
    -- anuncio de confirmación (sonido + vibración + notificación) por
    -- {sesionId, puntoControlId, pasada} — un useRef de React (como el que dedupea la
    -- voz/sonido en el GpsProvider de hoy) no sobrevive al contexto headless, que puede
    -- reevaluarse en una invocación de motor JS distinta a la que anunció la primera vez. Vive
    -- en esta MISMA base (no un archivo .db nuevo): ya hay una conexión abierta y saneada
    -- (conReintentoSiHandleMuerto), y un segundo archivo SQLite sería otra superficie para el
    -- bug de expo-sqlite@16.0.10 documentado en outbox.ts (outboxPromise). Ver
    -- registrarAnuncioSiNuevo en outbox.ts para el porqué de "clave" como PK en vez de las tres
    -- columnas por separado. (Nota: sin comillas invertidas acá a propósito — este bloque es
    -- un TEMPLATE LITERAL de JS, y una comilla invertida sin escapar lo cierra a mitad de
    -- camino y rompe el parseo de TODO el archivo con errores TS1005 crípticos y lejanos.)
    --
    -- REDISEÑO (decisión del CTO, ronda posterior al veredicto "partial" de Codex verify-fix del
    -- 2026-09-23, punto 3 del brief): columnas nuevas para reclamar la INTENCION de anunciar
    -- (estado 'pendiente') ANTES de programar la notificacion, y para poder reintentar sin
    -- parsear "clave" (sesion_id/punto_control_id/pasada por separado). Instalaciones YA EN
    -- PRODUCCION (con la tabla vieja de 2 columnas) las reciben via outbox-migraciones.ts, que
    -- outbox.ts corre despues de este DDL en cada apertura.
    CREATE TABLE IF NOT EXISTS anuncios_punto_control (
      clave TEXT PRIMARY KEY,
      ts TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'programado',
      motivo TEXT,
      sesion_id TEXT,
      punto_control_id TEXT,
      pasada INTEGER
    );
    -- FIX POST-REVISIÓN (bug 5, "reabrir la app a mitad de visita pierde la pasada"): la visita
    -- EN CURSO (dentro del radio, todavía sin confirmar por "mínimo local" — ver el docblock de
    -- filtrarNuevosCumplimientos, gps/geofence.ts) vivía SOLO en memoria (el Map de
    -- EstadoPuntoControl, un useRef en foreground / una variable de módulo en headless). Un
    -- chofer que mata y reabre la app a mitad de una visita, o Android reciclando el contexto
    -- JS headless en el medio, perdía esa visita sin dejar rastro. Esta tabla es la copia
    -- durable del candidato (el fix más cercano observado) de CADA visita en curso, por
    -- {sesionId, puntoControlId} — combinarConVisitasPendientes (gps/location-task.ts) la
    -- superpone sobre el Map derivado de los eventos ya confirmados al sembrar (foreground o
    -- headless nuevo), así que una visita pendiente SIEMPRE vuelve como pendiente, nunca como
    -- confirmada. Se actualiza en cada fix que mejora el mínimo (ver guardarVisitaPendiente en
    -- outbox.ts) y se borra en la MISMA transacción que encola el evento de confirmación (ver
    -- encolarEventoYLimpiarVisita en outbox.ts) — nunca hay una ventana donde el evento ya
    -- salió pero la fila sigue viva (que reabriría una visita fantasma y podría duplicar la
    -- pasada).
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

-- docs/plan-en-vivo-resumen-sesion.md — resumen por sesión para el mapa en vivo.
--
-- Causa raíz medida (plan §1): `listarHoy`/`obtenerPosiciones`
-- (apps/api/src/modules/reportes/en-vivo.service.ts) resolvían `ultimoFixTs`/
-- `ultimoIngresoTs`/`totalPuntos` con un `LEFT JOIN LATERAL` que agrega TODOS los puntos de
-- la jornada de cada sesión — O(puntos del día de la flota) por request, no O(sesiones).
-- Con 1.000 sesiones y ~6,7M filas en `gps_points`, 10+ segundos por endpoint (EXPLAIN
-- ANALYZE en `scripts/experimentos/gps/carga-envivo/`, ver handoff de esta rama).
--
-- Esta tabla es el agregado PRE-CALCULADO, una fila por (sesion_id, jornada boliviana),
-- mantenido por `insertarGpsPoints` (apps/api/src/modules/ingesta-worker/ingesta-worker.service.ts)
-- en el MISMO statement que inserta la evidencia (`WITH ins AS (INSERT ... RETURNING) INSERT
-- INTO gps_sesion_resumen ... ON CONFLICT DO UPDATE`) — nunca con un trigger ni un job
-- aparte: así los reenvíos idempotentes (RF-72) no inflan `total_puntos` (el `RETURNING` de
-- un `INSERT ... ON CONFLICT DO NOTHING` solo trae las filas efectivamente insertadas) y
-- queda atómico con la evidencia (misma transacción, mismo commit).
--
-- Deliberadamente SIN modelo Prisma, mismo criterio que `gps_points` (comentario en
-- `schema.prisma` junto al bloque M3): el upsert agregado de `insertarGpsPoints` necesita
-- control fino del `ON CONFLICT DO UPDATE` (comparar `EXCLUDED` contra la fila existente
-- fix por fix) que el `createMany`/`upsert` de Prisma no expresa en una sola sentencia — se
-- maneja 100% con `$queryRaw`/`$executeRaw`, igual que las lecturas de `gps_points`.
--
-- `sesion_id` SIN FK propia a `sesiones_operativas` — mismo motivo que `gps_points.sesion_id`
-- (ver `20260802160000_ingesta_gps_worker`): evita el costo de mantener esa FK en el statement
-- caliente de ingesta. `"sindicatoId"` SÍ es NOT NULL con FK, para que la policy de abajo
-- pueda aislar por tenant sin depender de un join.
CREATE TABLE gps_sesion_resumen (
  sesion_id           UUID NOT NULL,
  jornada             DATE NOT NULL,
  "sindicatoId"       TEXT NOT NULL,
  total_puntos        INTEGER NOT NULL DEFAULT 0,
  ultimo_fix_ts       TIMESTAMPTZ NOT NULL,
  ultimo_ingreso_ts   TIMESTAMPTZ NOT NULL,
  lat                 DOUBLE PRECISION NOT NULL,
  lng                 DOUBLE PRECISION NOT NULL,
  accuracy            DOUBLE PRECISION,
  speed               DOUBLE PRECISION,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- PK con `"sindicatoId"` (code-review HIGH/MEDIUM — cross-tenant poisoning): `sesion_id`
  -- llega en `payload.sesionId`, que el cliente controla, y `insertarGpsPoints` corre como
  -- `admin_quivo` (bypass explícito de RLS). Si dos tenants distintos alguna vez escriben
  -- resumen para el mismo `(sesion_id, jornada)` (un dispositivo del sindicato A mandando un
  -- `sesionId` que en realidad pertenece a una sesión del sindicato B), una PK de solo 2
  -- columnas los haría colisionar en el mismo `ON CONFLICT DO UPDATE`: el total/última
  -- posición de un tenant se mezclaría con los del otro, y como el `DO UPDATE` no toca
  -- `"sindicatoId"`, la fila quedaría "pegada" al tenant que escribió primero — escondiendo
  -- para siempre el resumen real del otro (su propia RLS ya no la vería). Con `"sindicatoId"`
  -- en la PK, cada tenant tiene su propia fila `(sesion_id, jornada, sindicatoId)`: no hay
  -- colisión posible entre tenants, y las lecturas (`en-vivo.service.ts`) además cierran el
  -- join con `so."sindicatoId"` para no depender solo de esta PK.
  CONSTRAINT gps_sesion_resumen_pkey PRIMARY KEY (sesion_id, jornada, "sindicatoId")
);

ALTER TABLE gps_sesion_resumen
  ADD CONSTRAINT gps_sesion_resumen_sindicatoid_fkey FOREIGN KEY ("sindicatoId")
  REFERENCES sindicatos(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Bypass de RLS para el backfill (code-review HIGH): `gps_points` tiene FORCE ROW LEVEL
-- SECURITY (`20260829180000_reconciliar_gps_points_sindicato_rls`) y el rol que corre
-- `prisma migrate deploy` en Cloud SQL (`postgres`, dueño de las tablas) NO tiene
-- BYPASSRLS — confirmado en producción (`docs/handoff.md`, "database-url NO es un rol
-- BYPASSRLS"): `pg_roles.rolbypassrls = false` tanto para `postgres` como para `quivo_app`.
-- Sin este `set_config`, el `SELECT FROM gps_points` de abajo no tiene `app.rol` ni
-- `app.sindicato_id` seteados → la policy `tenant_isolation` (`current_setting('app.rol',
-- true) = 'admin_quivo' OR "sindicatoId" = current_setting('app.sindicato_id', true)`)
-- evalúa `NULL OR (... = NULL)` → false para TODAS las filas: el backfill "corre bien", sin
-- error, y deja `gps_sesion_resumen` vacía — exactamente el modo de falla silencioso que ya
-- mordió a esta rama en producción una vez (ver el handoff).
--
-- `false` (sesión, no transaction-local): Prisma Migrate para Postgres NO garantiza que
-- todo `migration.sql` corra dentro de una única transacción (prisma/prisma#3774: "migrations
-- are not wrapped inside a transaction" por diseño — algunos ambientes agrupan los
-- statements de un mismo archivo en una transacción implícita del protocolo simple de
-- Postgres, pero no es un contrato estable ni documentado). Un `set_config(..., true)`
-- (equivalente a `SET LOCAL`) se perdería en cuanto el motor ejecute el `SELECT` de abajo
-- como un statement/transacción separado del `set_config` — `false` persiste a nivel de
-- sesión y sobrevive ese límite en cualquiera de los dos escenarios. Se resetea
-- explícitamente apenas termina el backfill (no antes: `ENABLE`/`FORCE ROW LEVEL SECURITY` y
-- `CREATE POLICY`, más abajo, son DDL que no evalúa la policy — no necesitan el bypass).
SELECT set_config('app.rol', 'admin_quivo', false);

-- Backfill desde `gps_points` existente: una sola agregación, ejecutada una vez por esta
-- migración. `jornada` se calcula bit a bit igual que `fechaActualBolivia`
-- (apps/api/src/common/tiempo/jornada.ts:13-16, Bolivia = UTC-4 fijo, sin horario de
-- verano): la fecha calendario de `ts - 4h` en UTC.
--
-- `ts AT TIME ZONE 'UTC'` ANTES de restar el intervalo y castear a `date` (code-review
-- MEDIUM): `ts` es `timestamptz`; castear un `timestamptz` a `date` directamente (`(ts -
-- interval '4 hours')::date`, la versión original) NO es una operación de solo aritmética —
-- Postgres primero convierte el instante al **TimeZone de la sesión** antes de extraer la
-- fecha. Con una sesión de migraciones que no fije `TimeZone = 'UTC'` explícitamente (a
-- diferencia de `crear_particion_gps_points`, que sí lo hace con `SET TimeZone = 'UTC'` en
-- su definición), el resultado dependería del TimeZone que traiga la conexión — pudiendo
-- correr distinto en cada entorno y no coincidir bit a bit con `fechaActualBolivia` (que es
-- aritmética pura en UTC, sin tocar el TimeZone del proceso Node). `ts AT TIME ZONE 'UTC'`
-- convierte primero a un `timestamp` (sin zona) que representa la hora de pared UTC —
-- restarle el intervalo y castear ESE resultado a `date` es aritmética pura, sin ninguna
-- conversión de zona horaria de por medio, sin importar el TimeZone de la sesión que corre
-- la migración.
--
-- `agregados` agrupa también por `"sindicatoId"` (code-review MEDIUM, cross-tenant
-- poisoning — mismo motivo que la PK de 3 columnas de arriba): si `gps_points` ya tuviera
-- filas de 2 tenants distintos bajo el mismo `sesion_id`/jornada (el mismo escenario que la
-- PK previene hacia adelante), agrupar solo por `(sesion_id, jornada)` mezclaría el
-- `total_puntos`/`ultimo_fix_ts`/`ultimo_ingreso_ts` de ambos tenants en una sola fila. Con
-- `"sindicatoId"` en el `GROUP BY`, cada tenant backfillea su propia fila, igual que el
-- upsert en caliente de `insertarGpsPoints`. `ultimo_punto` (DISTINCT ON, misma tripleta de
-- expresiones repetida a propósito en el ORDER BY — Postgres exige que el ORDER BY arranque
-- con las mismas expresiones del DISTINCT ON) trae lat/lng/accuracy/speed de la fila con el
-- `ts` más reciente de cada grupo `(sesion_id, jornada, sindicatoId)`. El join final combina
-- ambos por los 3 campos y el `ON CONFLICT DO NOTHING` es solo una red de seguridad (esta
-- tabla nace vacía, no debería haber conflicto real) para que la migración sea segura de
-- reintentar si fallara a mitad de camino.
WITH agregados AS (
  SELECT
    sesion_id,
    ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date AS jornada,
    "sindicatoId",
    count(*)::int AS total_puntos,
    max(ts) AS ultimo_fix_ts,
    max(received_at) AS ultimo_ingreso_ts
  FROM gps_points
  GROUP BY sesion_id, ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date, "sindicatoId"
),
ultimo_punto AS (
  SELECT DISTINCT ON (sesion_id, ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date, "sindicatoId")
    sesion_id,
    ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date AS jornada,
    "sindicatoId",
    lat,
    lng,
    accuracy,
    speed
  FROM gps_points
  ORDER BY sesion_id, ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date, "sindicatoId", ts DESC
)
INSERT INTO gps_sesion_resumen
  (sesion_id, jornada, "sindicatoId", total_puntos, ultimo_fix_ts, ultimo_ingreso_ts, lat, lng, accuracy, speed, updated_at)
SELECT
  a.sesion_id, a.jornada, a."sindicatoId", a.total_puntos, a.ultimo_fix_ts, a.ultimo_ingreso_ts,
  u.lat, u.lng, u.accuracy, u.speed, now()
FROM agregados a
JOIN ultimo_punto u ON u.sesion_id = a.sesion_id AND u.jornada = a.jornada AND u."sindicatoId" = a."sindicatoId"
-- Deterministic ORDER BY (code-review LOW — deadlock entre batches concurrentes): esta
-- agregación en particular corre una sola vez (migración, sin concurrencia real), pero se
-- deja el mismo orden que el upsert en caliente de `insertarGpsPoints` por consistencia y
-- para que un reintento de esta migración (ON CONFLICT DO NOTHING, ver arriba) tome las
-- filas siempre en el mismo orden.
ORDER BY a.sesion_id, a.jornada, a."sindicatoId"
ON CONFLICT (sesion_id, jornada, "sindicatoId") DO NOTHING;

-- Reset inmediato del rol elevado (code-review HIGH, parte 2): no dejarlo pegado a la
-- conexión de migraciones más tiempo del necesario. Lo que sigue (`ENABLE`/`FORCE ROW LEVEL
-- SECURITY`, `CREATE POLICY`) es DDL — no evalúa la policy de RLS, así que no necesita
-- `app.rol` elevado.
SELECT set_config('app.rol', '', false);

-- RLS (mismo patrón que `gps_points`/`cumplimientos_pc`, QUI-218): tabla NO particionada, así
-- que a diferencia de `gps_points` alcanza con `ENABLE`+`FORCE`+policy una sola vez, sin el
-- loop por partición que pide `20260815120000_gps_points_sindicato_rls`.
ALTER TABLE gps_sesion_resumen ENABLE ROW LEVEL SECURITY;
ALTER TABLE gps_sesion_resumen FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gps_sesion_resumen
  USING (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  )
  WITH CHECK (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  );

-- Sin GRANT explícito: `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ... TO quivo_app`
-- (`20260730152500_rls_multi_tenant`) ya cubre cualquier tabla nueva creada por el rol de
-- migraciones (mismo motivo por el que `gps_points`/`cumplimientos_pc`/etc. tampoco repiten
-- el GRANT acá).

-- Retención (plan §2, RNF-37): el archivado de particiones de `gps_points`
-- (`RetencionGpsService`/`retencion-gps.service.ts`) NO toca esta tabla — el resumen es
-- evidencia agregada y sobrevive al archivado/drop de la partición fría de origen. Anotado
-- también en `docs/runbooks/retencion-gps.md`.

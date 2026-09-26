BEGIN;

-- Bypass de RLS (gps_points tiene FORCE ROW LEVEL SECURITY): conectar con un rol que NO
-- tenga BYPASSRLS (el mismo modo de falla que el backfill de la migración, ver el handoff)
-- requiere este set_config antes del SELECT. `true` (SET LOCAL): este bloque SÍ corre
-- explícitamente dentro de un BEGIN/COMMIT propio, así que el alcance de transacción es
-- correcto acá (a diferencia de la migración, donde Prisma Migrate no garantiza una
-- transacción única).
SELECT set_config('app.rol', 'admin_quivo', true);

-- Race con el worker en vivo (code-review, hallazgo del despliegue): `insertarGpsPoints`
-- (apps/api/src/modules/ingesta-worker/ingesta-worker.service.ts) hace upsert a
-- `gps_sesion_resumen` con `total_puntos = gps_sesion_resumen.total_puntos +
-- EXCLUDED.total_puntos` en el MISMO statement que el INSERT a `gps_points` (una sola
-- transacción, un solo `INSERT ... ON CONFLICT DO UPDATE`). Este recompute, en cambio, hace
-- `DO UPDATE SET total_puntos = EXCLUDED.total_puntos` (reemplazo, no suma): si el snapshot
-- de `gps_points` que arma el `SELECT` de abajo queda tomado ANTES de que un upsert del
-- worker haga commit, pero ese commit del worker sucede ANTES de que este `INSERT ...
-- SELECT` haga su propio commit, el `total_puntos` recién sumado por el worker queda
-- pisado por el valor viejo del snapshot — undercount permanente (el worker no vuelve a
-- corregirlo, solo suma sobre lo que ya haya).
--
-- El `LOCK TABLE ... IN SHARE ROW EXCLUSIVE MODE` de abajo cierra esa ventana: choca
-- exactamente con el `ROW EXCLUSIVE` que el worker toma al hacer su upsert (SHARE ROW
-- EXCLUSIVE es incompatible con ROW EXCLUSIVE y viceversa, ver tabla de modos de lock de
-- Postgres), así que el `LOCK TABLE` espera a que termine de hacer commit cualquier
-- transacción del worker que ya esté en vuelo, y bloquea a cualquier upsert nuevo del
-- worker hasta el `COMMIT` de este script. Bajo `READ COMMITTED` (default), el `INSERT ...
-- SELECT` de abajo toma su snapshot de `gps_points` al INICIO del statement, es decir
-- DESPUÉS de adquirir este lock — para ese momento, todo upsert del worker que ya haya
-- hecho commit quedó reflejado en `gps_points`, y ningún upsert nuevo puede colarse hasta
-- que este script libere el lock en el `COMMIT` final. El worker solo ESPERA (no pierde
-- datos: su statement sigue en la cola de locks y corre normalmente apenas este script
-- libera la tabla) y este script solo LEE `gps_points` (`ACCESS SHARE`, un modo compatible
-- con cualquier otro lock), así que no hay ciclo posible → no hay deadlock, solo espera.
--
-- `SET LOCAL lock_timeout` ANTES del `LOCK TABLE`: sin esto, una transacción del worker
-- trabada (o cualquier otra sesión con un lock previo sobre esta tabla) dejaría a este
-- script esperando indefinidamente. Si no consigue el lock en 30s, el `LOCK TABLE` falla,
-- la transacción aborta, el wrapper en JS hace ROLLBACK y sale con exit 1 — seguro
-- reintentar (el recompute es idempotente, ver runbook).
SET LOCAL lock_timeout = '30s';
LOCK TABLE gps_sesion_resumen IN SHARE ROW EXCLUSIVE MODE;

-- Jornada boliviana explícita (code-review, hallazgo del despliegue): `CURRENT_DATE`
-- depende del TimeZone de la SESIÓN/conexión (Cloud SQL en prod corre en UTC), mientras que
-- `jornada` se calcula acá abajo como `((ts AT TIME ZONE 'UTC') - interval '4 hours')::date`
-- (Bolivia = UTC-4 fijo, igual que `fechaActualBolivia`,
-- apps/api/src/common/tiempo/jornada.ts). Entre las 20:00 y las 24:00 hora boliviana,
-- `CURRENT_DATE` (todavía HOY en UTC) ya es MAÑANA en jornada boliviana: filtrar por
-- `IN (CURRENT_DATE, CURRENT_DATE - 1)` en esa ventana trae la jornada de mañana (vacía) y
-- la de hoy, mientras que la jornada boliviana real de "ayer" (la que sigue activa hasta las
-- 4am UTC) queda afuera del recompute. Se reemplaza `CURRENT_DATE` por la MISMA expresión de
-- jornada aplicada a `now()`, para que el filtro y el cálculo de `jornada` usen exactamente
-- el mismo reloj y el mismo huso — sin depender del TimeZone de sesión.
WITH hoy AS (
  SELECT ((now() AT TIME ZONE 'UTC') - interval '4 hours')::date AS jornada
),
agregados AS (
  SELECT
    sesion_id,
    ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date AS jornada,
    "sindicatoId",
    count(*)::int AS total_puntos,
    max(ts) AS ultimo_fix_ts,
    max(received_at) AS ultimo_ingreso_ts
  FROM gps_points, hoy
  WHERE ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date IN (hoy.jornada, hoy.jornada - 1)
  GROUP BY sesion_id, ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date, "sindicatoId"
),
ultimo_punto AS (
  SELECT DISTINCT ON (sesion_id, ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date, "sindicatoId")
    sesion_id,
    ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date AS jornada,
    "sindicatoId",
    lat, lng, accuracy, speed
  FROM gps_points, hoy
  WHERE ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date IN (hoy.jornada, hoy.jornada - 1)
  ORDER BY sesion_id, ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date, "sindicatoId", ts DESC
)
INSERT INTO gps_sesion_resumen
  (sesion_id, jornada, "sindicatoId", total_puntos, ultimo_fix_ts, ultimo_ingreso_ts, lat, lng, accuracy, speed, updated_at)
SELECT
  a.sesion_id, a.jornada, a."sindicatoId", a.total_puntos, a.ultimo_fix_ts, a.ultimo_ingreso_ts,
  u.lat, u.lng, u.accuracy, u.speed, now()
FROM agregados a
JOIN ultimo_punto u ON u.sesion_id = a.sesion_id AND u.jornada = a.jornada AND u."sindicatoId" = a."sindicatoId"
ORDER BY a.sesion_id, a.jornada, a."sindicatoId"
ON CONFLICT (sesion_id, jornada, "sindicatoId") DO UPDATE SET
  total_puntos = EXCLUDED.total_puntos,
  ultimo_fix_ts = EXCLUDED.ultimo_fix_ts,
  ultimo_ingreso_ts = EXCLUDED.ultimo_ingreso_ts,
  lat = EXCLUDED.lat,
  lng = EXCLUDED.lng,
  accuracy = EXCLUDED.accuracy,
  speed = EXCLUDED.speed,
  updated_at = now();

SELECT set_config('app.rol', '', true);

COMMIT;

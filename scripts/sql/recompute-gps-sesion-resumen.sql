BEGIN;

-- Bypass de RLS (gps_points tiene FORCE ROW LEVEL SECURITY): conectar con un rol que NO
-- tenga BYPASSRLS (el mismo modo de falla que el backfill de la migración, ver el handoff)
-- requiere este set_config antes del SELECT. `true` (SET LOCAL): este bloque SÍ corre
-- explícitamente dentro de un BEGIN/COMMIT propio, así que el alcance de transacción es
-- correcto acá (a diferencia de la migración, donde Prisma Migrate no garantiza una
-- transacción única).
SELECT set_config('app.rol', 'admin_quivo', true);

WITH agregados AS (
  SELECT
    sesion_id,
    ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date AS jornada,
    "sindicatoId",
    count(*)::int AS total_puntos,
    max(ts) AS ultimo_fix_ts,
    max(received_at) AS ultimo_ingreso_ts
  FROM gps_points
  WHERE ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date IN (CURRENT_DATE, CURRENT_DATE - 1)
  GROUP BY sesion_id, ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date, "sindicatoId"
),
ultimo_punto AS (
  SELECT DISTINCT ON (sesion_id, ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date, "sindicatoId")
    sesion_id,
    ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date AS jornada,
    "sindicatoId",
    lat, lng, accuracy, speed
  FROM gps_points
  WHERE ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date IN (CURRENT_DATE, CURRENT_DATE - 1)
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

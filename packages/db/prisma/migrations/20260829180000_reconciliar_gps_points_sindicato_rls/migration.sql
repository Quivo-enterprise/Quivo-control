-- Reconciliación post-merge de dos líneas de trabajo que arreglaron la misma condición de
-- carrera en `crear_particion_gps_points` por separado: `20260815120000_gps_points_sindicato_rls`
-- + `20260817130000_particion_gps_points_idempotente` (QUI-358: sindicatoId + RLS en
-- `gps_points`, cada partición existente y futura) contra `20260818164500_gps_partition_idempotency`
-- (advisory lock, sin ninguna noción de sindicatoId/RLS). Ambas quedaron en el repo tras el
-- merge y, aplicadas en orden por timestamp, la segunda pisa la función de la primera —
-- revirtiendo en silencio el aislamiento multi-tenant de QUI-358 en toda partición nueva.
--
-- El código de aplicación ya asume la columna: `insertarGpsPoints` (ingesta-worker.service.ts)
-- inserta `sindicatoId` en cada INSERT a `gps_points` desde antes del merge, así que sin este
-- fix el worker de ingesta no puede escribir un solo punto GPS.
--
-- Esta migración está escrita para ser segura sin importar de cuál de las dos líneas viene el
-- ambiente que la corre (no hay forma de verificar contra un Cloud SQL de producción desde
-- este entorno): cada paso es idempotente y no asume qué function/columna ya existe.

-- 1) Columna: `IF NOT EXISTS` porque un ambiente que sí llegó a aplicar
-- `20260815120000_gps_points_sindicato_rls` ya la tiene.
ALTER TABLE gps_points ADD COLUMN IF NOT EXISTS "sindicatoId" TEXT;

-- 2) Backfill vía join explícito (gps_points.sesion_id no tiene FK propia a
-- sesiones_operativas, ver `20260802160000_ingesta_gps_worker`).
UPDATE gps_points gp
SET "sindicatoId" = so."sindicatoId"
FROM sesiones_operativas so
WHERE so.id = gp.sesion_id::text AND gp."sindicatoId" IS NULL;

-- 3) Filas sin sesión que las respalde (`sesiones_operativas` no borra filas nunca, ver
-- `20260817150000_sesiones_operativas_vehiculo_estado_idx` — así que en un ambiente real esto
-- debería afectar cero filas) no tienen forma de resolver su tenant: son telemetría huérfana,
-- sin valor operativo (ningún cumplimiento ni recorrido puede referenciarlas sin una sesión).
-- Se descartan en vez de dejarlas bloqueando el `SET NOT NULL` de abajo.
DELETE FROM gps_points WHERE "sindicatoId" IS NULL;

ALTER TABLE gps_points ALTER COLUMN "sindicatoId" SET NOT NULL;

CREATE INDEX IF NOT EXISTS gps_points_sindicato_id_ts_idx ON gps_points ("sindicatoId", ts);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gps_points_sindicatoid_fkey'
  ) THEN
    ALTER TABLE gps_points
      ADD CONSTRAINT gps_points_sindicatoid_fkey FOREIGN KEY ("sindicatoId")
      REFERENCES sindicatos(id) ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 4) RLS sobre el padre. ENABLE/FORCE son idempotentes (repetirlos no falla); la policy se
-- guarda con un chequeo explícito porque `CREATE POLICY` no soporta `IF NOT EXISTS`.
ALTER TABLE gps_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE gps_points FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'gps_points' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON gps_points
      USING (
        current_setting('app.rol', true) = 'admin_quivo'
        OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
      )
      WITH CHECK (
        current_setting('app.rol', true) = 'admin_quivo'
        OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
      );
  END IF;
END $$;

-- 5) Particiones existentes: mismo patrón, para que un acceso directo por nombre a una
-- partición (sin pasar por el padre) quede igual de aislado. `IF NOT EXISTS` por partición
-- porque una que ya vino de la línea `20260815120000`/`20260817130000` puede tener la policy.
DO $$
DECLARE
  particion text;
BEGIN
  FOR particion IN
    SELECT child.relname
    FROM pg_inherits
    JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
    JOIN pg_class child ON pg_inherits.inhrelid = child.oid
    WHERE parent.relname = 'gps_points' AND parent.relnamespace = 'public'::regnamespace
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', particion);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', particion);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = particion AND policyname = 'tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING (current_setting(''app.rol'', true) = ''admin_quivo'' OR "sindicatoId"::text = current_setting(''app.sindicato_id'', true)) WITH CHECK (current_setting(''app.rol'', true) = ''admin_quivo'' OR "sindicatoId"::text = current_setting(''app.sindicato_id'', true))',
        particion
      );
    END IF;
  END LOOP;
END $$;

-- 6) `crear_particion_gps_points`, definición final: toma el mecanismo de la línea
-- "pendiente" (`20260818164500_gps_partition_idempotency` — advisory lock, más simple y
-- evita la carrera por completo en vez de solo tolerarla) y le repone lo que esa versión
-- había perdido: `search_path`/`TimeZone` fijos (evita la escalada vía search_path descrita
-- en `20260817130000`, y el corrimiento de límites de partición por TimeZone de sesión) y
-- RLS + policy en cada partición nueva (QUI-358).
CREATE OR REPLACE FUNCTION crear_particion_gps_points(dia date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET TimeZone = 'UTC'
AS $$
DECLARE
  nombre_particion text := 'gps_points_' || to_char(dia, 'YYYYMMDD');
  inicio timestamptz := dia::timestamptz;
  fin timestamptz := (dia + interval '1 day')::timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('quivo:gps-partitions', 0));

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.gps_points FOR VALUES FROM (%L) TO (%L)',
    nombre_particion, inicio, fin
  );

  -- RLS y policy SIEMPRE, no solo cuando esta llamada crea la tabla: repara idempotentemente
  -- cualquier partición preexistente sin aislamiento (ver `20260817130000` para el porqué).
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', nombre_particion);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', nombre_particion);

  IF NOT EXISTS (
    SELECT 1
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = nombre_particion
       AND policyname = 'tenant_isolation'
  ) THEN
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I USING (current_setting(''app.rol'', true) = ''admin_quivo'' OR "sindicatoId"::text = current_setting(''app.sindicato_id'', true)) WITH CHECK (current_setting(''app.rol'', true) = ''admin_quivo'' OR "sindicatoId"::text = current_setting(''app.sindicato_id'', true))',
      nombre_particion
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION crear_particion_gps_points(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crear_particion_gps_points(date) TO quivo_app;

-- Make GPS partition maintenance safe when more than one API/worker instance
-- starts at the same time. The previous function used a check-then-create
-- sequence, which could still race and raise 42P07 (duplicate_table).
CREATE OR REPLACE FUNCTION public.crear_particion_gps_points(dia date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  nombre_particion text := 'gps_points_' || to_char(dia, 'YYYYMMDD');
  inicio timestamptz := dia::timestamptz;
  fin timestamptz := (dia + interval '1 day')::timestamptz;
BEGIN
  -- Protect callers that invoke the function directly (tests, maintenance
  -- jobs, or a second worker), not only the application service.
  PERFORM pg_advisory_xact_lock(hashtextextended('quivo:gps-partitions', 0));

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.gps_points FOR VALUES FROM (%L) TO (%L)',
    nombre_particion, inicio, fin
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.crear_particion_gps_points(date) TO quivo_app;

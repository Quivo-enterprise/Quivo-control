-- QUI-358: sindicatoId + RLS en gps_points — cierra explícitamente la decisión diferida en
-- la migración `20260802160000_ingesta_gps_worker` ("Sin RLS por ahora ... evaluar en M4
-- ... desnormalizar sindicatoId + RLS"). Se hace ahora, antes del piloto (M5), por costo y
-- no por riesgo: hoy la tabla está vacía (ADD COLUMN + policy es gratis); en tres meses son
-- ~90 particiones diarias con millones de filas y esto se vuelve un backfill con downtime.
--
-- `gps_points` es una tabla particionada por rango (`PARTITION BY RANGE (ts)`, ver
-- `20260802160000_ingesta_gps_worker`). Columna, índice y FK sí se propagan solos desde el
-- padre a cada partición (actual y futura) — comportamiento estándar de particionado
-- declarativo. Row-level security NO: verificado a mano (ver reporte del ticket QUI-358 con
-- el SQL exacto y su salida) que activar `FORCE ROW LEVEL SECURITY` + una policy en el
-- padre dejan pasar TODO sin filtrar a quien consulte una partición hija por su nombre
-- directo (`gps_points_20260915`, no vía `gps_points`) — Postgres solo evalúa policies cuyo
-- `polrelid` es exactamente la relación escaneada; la restricción del padre solo entra en
-- juego cuando la partición se visita vía expansión de herencia al consultar el padre. Ese
-- es el modo de falla real de RLS + particionado, y es la razón de los pasos 3 y 4 de acá
-- abajo: sin ellos, cualquier código presente o futuro (p. ej. el archivado a S3/R2 de
-- QUI-252) que toque una partición por nombre en vez de por `gps_points` queda sin
-- aislamiento pese al FORCE del padre.

-- 1) Columna: nullable primero + backfill explícito + NOT NULL después, en vez de
-- `ADD COLUMN ... NOT NULL` directo. La tabla está vacía en todo ambiente real a esta
-- fecha (nada que backfillear hoy), pero el AC pide dejar el paso documentado y probado
-- por si esta migración corriera alguna vez contra un ambiente con filas preexistentes —
-- `gps_points.sesion_id` no tiene FK propia a `sesiones_operativas` (ver comentario en la
-- migración de creación), así que resolvemos el tenant vía join explícito, no vía FK.
ALTER TABLE gps_points ADD COLUMN "sindicatoId" TEXT;

UPDATE gps_points gp
SET "sindicatoId" = so."sindicatoId"
FROM sesiones_operativas so
WHERE so.id = gp.sesion_id::text AND gp."sindicatoId" IS NULL;

ALTER TABLE gps_points ALTER COLUMN "sindicatoId" SET NOT NULL;

CREATE INDEX gps_points_sindicato_id_ts_idx ON gps_points ("sindicatoId", ts);

-- FK sobre la tabla particionada padre — soportado por Postgres (propaga a cada partición,
-- actual y futura) desde antes de la versión de Postgres de esta imagen (16). A diferencia
-- de RLS (ver arriba), esto sí lo enforcea Postgres también en accesos directos a la
-- partición, porque es un constraint físico de la relación hija, no una policy aparte.
ALTER TABLE gps_points
  ADD CONSTRAINT gps_points_sindicatoid_fkey FOREIGN KEY ("sindicatoId")
  REFERENCES sindicatos(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2) RLS sobre el padre — mismo patrón que las 15 tablas existentes
-- (`20260730152500_rls_multi_tenant`, `20260802160000_ingesta_gps_worker`): el worker de
-- ingesta sigue viendo/escribiendo todo vía el bypass explícito de
-- `app.rol = 'admin_quivo'` (ver `ingesta-worker.service.ts`, corre siempre con ese rol);
-- cualquier otro actor queda acotado a su propio `app.sindicato_id`. Cubre el acceso normal
-- de la aplicación (siempre vía `gps_points`, nunca por nombre de partición — ver
-- `insertarGpsPoints`), pero NO el acceso directo a una partición (pasos 3 y 4).
ALTER TABLE gps_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE gps_points FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gps_points
  USING (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  )
  WITH CHECK (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  );

-- 3) Particiones YA existentes (creadas por el DO block de `20260802160000_ingesta_gps_worker`
-- cuando se corrió esa migración): repetirles la misma policy directamente, para que un
-- acceso por nombre directo a una de ellas quede igual de aislado que uno vía el padre.
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
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (current_setting(''app.rol'', true) = ''admin_quivo'' OR "sindicatoId"::text = current_setting(''app.sindicato_id'', true)) WITH CHECK (current_setting(''app.rol'', true) = ''admin_quivo'' OR "sindicatoId"::text = current_setting(''app.sindicato_id'', true))',
      particion
    );
  END LOOP;
END $$;

-- 4) Particiones FUTURAS: `crear_particion_gps_points` (SECURITY DEFINER, `quivo_app` la
-- ejecuta a diario vía el worker — `20260802161000_particion_gps_security_definer`) se
-- redefine para que toda partición nueva nazca ya con RLS forzada y la policy puesta, sin
-- depender de que alguien se acuerde de repetir el paso 3 a mano cada vez que se cree una.
-- OJO: `SECURITY DEFINER` se repite explícito en este CREATE OR REPLACE a propósito —
-- Postgres NO conserva esa propiedad de la definición anterior si no se la vuelve a poner
-- (a diferencia de ALTER FUNCTION, que sí es incremental); omitirla acá volvería la función
-- a SECURITY INVOKER en silencio y rompería el fix de la migración
-- `20260802161000_particion_gps_security_definer` (permission denied for schema public al
-- correr como `quivo_app`).
CREATE OR REPLACE FUNCTION crear_particion_gps_points(dia date)
RETURNS void AS $$
DECLARE
  nombre_particion text := 'gps_points_' || to_char(dia, 'YYYYMMDD');
  inicio timestamptz := dia::timestamptz;
  fin timestamptz := (dia + interval '1 day')::timestamptz;
BEGIN
  IF NOT EXISTS (SELECT FROM pg_class WHERE relname = nombre_particion) THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF gps_points FOR VALUES FROM (%L) TO (%L)',
      nombre_particion, inicio, fin
    );
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', nombre_particion);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', nombre_particion);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (current_setting(''app.rol'', true) = ''admin_quivo'' OR "sindicatoId"::text = current_setting(''app.sindicato_id'', true)) WITH CHECK (current_setting(''app.rol'', true) = ''admin_quivo'' OR "sindicatoId"::text = current_setting(''app.sindicato_id'', true))',
      nombre_particion
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- El `GRANT EXECUTE` original (`20260802161000_particion_gps_security_definer`) sigue
-- vigente sobre esta misma función (incluso reemplazada, conserva permisos y ownership),
-- pero se repite explícito acá — barato — para no depender de esa garantía implícita.
GRANT EXECUTE ON FUNCTION crear_particion_gps_points(date) TO quivo_app;

-- QUI-252: manifiesto durable del archivo frío. Una partición solo se registra aquí después
-- de cargarla y verificar SHA-256/bytes desde S3/R2; luego se desmonta y elimina dentro de
-- la misma transacción. Esta tabla no contiene datos tenant y solo la usa el worker global.
CREATE TABLE "gps_archives" (
    "id" TEXT NOT NULL,
    "partitionName" TEXT NOT NULL,
    "partitionDate" DATE NOT NULL,
    "bucket" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "rowCount" BIGINT NOT NULL,
    "compressedBytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gps_archives_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gps_archives_partitionName_key" ON "gps_archives"("partitionName");
CREATE UNIQUE INDEX "gps_archives_objectKey_key" ON "gps_archives"("objectKey");
CREATE INDEX "gps_archives_partitionDate_idx" ON "gps_archives"("partitionDate");

-- El runtime `quivo_app` no es dueño del parent/particiones (a propósito). Se expone una
-- capacidad mínima para finalizar SOLO una partición hija ya verificada y registrada en el
-- manifiesto dentro de la misma transacción.
CREATE OR REPLACE FUNCTION finalizar_archivo_gps(nombre_particion text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF nombre_particion !~ '^gps_points_[0-9]{8}$' THEN
    RAISE EXCEPTION 'Nombre de partición GPS inválido: %', nombre_particion;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.gps_archives
     WHERE "partitionName" = nombre_particion
  ) THEN
    RAISE EXCEPTION 'La partición % no tiene manifiesto verificado', nombre_particion;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_inherits
      JOIN pg_class parent ON parent.oid = inhparent
      JOIN pg_class child ON child.oid = inhrelid
     WHERE parent.oid = 'public.gps_points'::regclass
       AND child.relname = nombre_particion
  ) THEN
    RAISE EXCEPTION '% no es partición de gps_points', nombre_particion;
  END IF;

  EXECUTE format('ALTER TABLE public.gps_points DETACH PARTITION public.%I', nombre_particion);
  EXECUTE format('DROP TABLE public.%I', nombre_particion);
END;
$$;

REVOKE ALL ON FUNCTION finalizar_archivo_gps(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finalizar_archivo_gps(text) TO quivo_app;

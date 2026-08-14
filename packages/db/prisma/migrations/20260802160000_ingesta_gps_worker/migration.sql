-- QUI-241: worker de ingesta (RF-58..66) — gps_points particionada + tablas de apoyo del
-- outbox móvil (cumplimientos_pc, eventos_operativos) y de errores de sync (sync_errors,
-- RNF-35, usada también por QUI-242).

-- `pg_partman` no está disponible en esta imagen de Postgres (postgis/postgis:16-3.4-alpine
-- — verificado: `SELECT * FROM pg_available_extensions WHERE name ILIKE '%partman%'` no
-- devuelve filas). Se usa particionado nativo declarativo de Postgres (`PARTITION BY
-- RANGE`) + una función/DO block que crea las particiones de los próximos días, el mismo
-- resultado que pg_partman automatizaría con la extensión. Retención en frío (6 meses,
-- archivo a S3/R2) sigue pendiente — QUI-252, fuera de alcance de este ticket.
--
-- La PK tiene que incluir la columna de partición (`ts`) — restricción de Postgres para
-- tablas particionadas, no se puede tener un único índice PK solo por `event_id` que cubra
-- todas las particiones. En la práctica es equivalente para idempotencia: un evento
-- reenviado (mismo `event_id`) siempre trae el mismo `ts` (es el mismo evento, no uno
-- nuevo), así que `ON CONFLICT (event_id, ts) DO NOTHING` bloquea duplicados igual.
--
-- Sin RLS por ahora: el único escritor/lector es el worker, corriendo como `admin_quivo`
-- (mismo patrón que `RotacionesService.marcarVencidas`) — no hay todavía un endpoint admin
-- con `sindicatoId` propio que lea esta tabla (llega en M4, QUI-246/247, "reconstrucción de
-- recorridos"). Cuando exista, evaluar tenant-check en código (patrón de `rutas`/`paradas`,
-- sin `sindicatoId` directo) o desnormalizar `sindicatoId` + RLS.
CREATE TABLE gps_points (
  event_id UUID NOT NULL,
  sesion_id UUID NOT NULL,
  device_id TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION,
  speed DOUBLE PRECISION,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gps_points_pkey PRIMARY KEY (event_id, ts)
) PARTITION BY RANGE (ts);

CREATE INDEX gps_points_sesion_ts_idx ON gps_points (sesion_id, ts);

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
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Particiones iniciales: ayer + hoy + 6 días hacia adelante (cubre drift de reloj del
-- dispositivo y da margen para que el worker corra su propio mantenimiento de particiones
-- futuras antes de necesitarlas, ver `worker.ts`).
DO $$
DECLARE
  i integer;
BEGIN
  FOR i IN -1..6 LOOP
    PERFORM crear_particion_gps_points((CURRENT_DATE + i)::date);
  END LOOP;
END $$;

-- CreateTable
CREATE TABLE "cumplimientos_pc" (
    "id" TEXT NOT NULL,
    "sindicatoId" TEXT NOT NULL,
    "sesionId" TEXT NOT NULL,
    "puntoControlId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "distanciaM" DOUBLE PRECISION NOT NULL,
    "cumplido" BOOLEAN NOT NULL,
    "validadoPor" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cumplimientos_pc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_operativos" (
    "id" TEXT NOT NULL,
    "sindicatoId" TEXT NOT NULL,
    "sesionId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_operativos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_errors" (
    "id" TEXT NOT NULL,
    "sindicatoId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "eventId" TEXT,
    "payload" JSONB NOT NULL,
    "error" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_errors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cumplimientos_pc_sindicatoId_idx" ON "cumplimientos_pc"("sindicatoId");
CREATE INDEX "cumplimientos_pc_sesionId_idx" ON "cumplimientos_pc"("sesionId");
CREATE INDEX "cumplimientos_pc_puntoControlId_idx" ON "cumplimientos_pc"("puntoControlId");

-- CreateIndex
CREATE INDEX "eventos_operativos_sindicatoId_idx" ON "eventos_operativos"("sindicatoId");
CREATE INDEX "eventos_operativos_sesionId_idx" ON "eventos_operativos"("sesionId");

-- CreateIndex
CREATE INDEX "sync_errors_sindicatoId_idx" ON "sync_errors"("sindicatoId");
CREATE INDEX "sync_errors_deviceId_idx" ON "sync_errors"("deviceId");

-- AddForeignKey
ALTER TABLE "cumplimientos_pc" ADD CONSTRAINT "cumplimientos_pc_sindicatoId_fkey" FOREIGN KEY ("sindicatoId") REFERENCES "sindicatos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_operativos" ADD CONSTRAINT "eventos_operativos_sindicatoId_fkey" FOREIGN KEY ("sindicatoId") REFERENCES "sindicatos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_errors" ADD CONSTRAINT "sync_errors_sindicatoId_fkey" FOREIGN KEY ("sindicatoId") REFERENCES "sindicatos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS (QUI-218 pattern): las 3 tablas tienen `sindicatoId` propio.
ALTER TABLE cumplimientos_pc ENABLE ROW LEVEL SECURITY;
ALTER TABLE cumplimientos_pc FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cumplimientos_pc
  USING (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  )
  WITH CHECK (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  );

ALTER TABLE eventos_operativos ENABLE ROW LEVEL SECURITY;
ALTER TABLE eventos_operativos FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON eventos_operativos
  USING (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  )
  WITH CHECK (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  );

ALTER TABLE sync_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_errors FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sync_errors
  USING (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  )
  WITH CHECK (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  );

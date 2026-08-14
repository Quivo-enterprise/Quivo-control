-- QUI-241: bug real encontrado en una prueba end-to-end en vivo (lote gzip real reenviado
-- dos veces) — `cumplimientos_pc`/`eventos_operativos` NO eran idempotentes por `event_id`
-- a diferencia de `gps_points` (que sí usa `ON CONFLICT (event_id, ts) DO NOTHING`).
-- Reenviar el mismo lote (comportamiento esperado del cliente ante un timeout/fallo de red,
-- QUI-240) duplicaba filas. Se agrega `eventId` único; el worker pasa a usar
-- `createMany({ skipDuplicates: true })` en vez de `create()` para ambas tablas.

-- CreateColumn (nullable primero porque hay filas existentes de pruebas previas sin este
-- campo — se backfillea con el propio `id` para no violar el UNIQUE, y se puede dejar así:
-- son filas de prueba, no auditadas).
ALTER TABLE "cumplimientos_pc" ADD COLUMN "eventId" TEXT;
UPDATE "cumplimientos_pc" SET "eventId" = "id" WHERE "eventId" IS NULL;
ALTER TABLE "cumplimientos_pc" ALTER COLUMN "eventId" SET NOT NULL;
CREATE UNIQUE INDEX "cumplimientos_pc_eventId_key" ON "cumplimientos_pc"("eventId");

ALTER TABLE "eventos_operativos" ADD COLUMN "eventId" TEXT;
UPDATE "eventos_operativos" SET "eventId" = "id" WHERE "eventId" IS NULL;
ALTER TABLE "eventos_operativos" ALTER COLUMN "eventId" SET NOT NULL;
CREATE UNIQUE INDEX "eventos_operativos_eventId_key" ON "eventos_operativos"("eventId");

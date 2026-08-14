-- QUI-234: `estado` (vigente | vencida) en asignaciones — la marca un job BullMQ
-- repeatable cuando `venceAt` ya pasó (RF-57), no el request que la creó.

-- AlterTable
ALTER TABLE "asignaciones" ADD COLUMN "estado" TEXT NOT NULL DEFAULT 'vigente';

-- CreateIndex
CREATE INDEX "asignaciones_estado_venceAt_idx" ON "asignaciones"("estado", "venceAt");

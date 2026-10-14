-- PR C — foto de la unidad: URL pública (GCS) subida por el conductor desde la app móvil.
-- AlterTable
ALTER TABLE "vehiculos" ADD COLUMN "fotoUrl" TEXT,
ADD COLUMN "fotoActualizadaEn" TIMESTAMP(3),
ADD COLUMN "fotoSubidaPorId" TEXT;

-- CreateIndex
CREATE INDEX "vehiculos_fotoSubidaPorId_idx" ON "vehiculos"("fotoSubidaPorId");

-- AddForeignKey
ALTER TABLE "vehiculos" ADD CONSTRAINT "vehiculos_fotoSubidaPorId_fkey" FOREIGN KEY ("fotoSubidaPorId") REFERENCES "conductores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

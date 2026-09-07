-- La publicación para pasajeros es editorial e independiente del estado operativo.
-- Todo recurso existente parte como borrador: una migración nunca debe exponer datos
-- internos o incompletos automáticamente.
ALTER TABLE "lineas"
  ADD COLUMN "publicStatus" TEXT NOT NULL DEFAULT 'borrador',
  ADD COLUMN "publishedAt" TIMESTAMP(3);

ALTER TABLE "rutas"
  ADD COLUMN "publicStatus" TEXT NOT NULL DEFAULT 'borrador',
  ADD COLUMN "publishedAt" TIMESTAMP(3);

ALTER TABLE "variantes"
  ADD COLUMN "publicStatus" TEXT NOT NULL DEFAULT 'borrador',
  ADD COLUMN "publishedAt" TIMESTAMP(3);

ALTER TABLE "paradas"
  ADD COLUMN "nombre" TEXT,
  ADD COLUMN "referencia" TEXT,
  ADD COLUMN "publicStatus" TEXT NOT NULL DEFAULT 'borrador',
  ADD COLUMN "publishedAt" TIMESTAMP(3);

CREATE INDEX "lineas_publicStatus_idx" ON "lineas"("publicStatus");
CREATE INDEX "rutas_publicStatus_idx" ON "rutas"("publicStatus");
CREATE INDEX "variantes_publicStatus_idx" ON "variantes"("publicStatus");
CREATE INDEX "paradas_publicStatus_idx" ON "paradas"("publicStatus");

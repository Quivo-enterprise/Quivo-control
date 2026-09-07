ALTER TABLE "lineas"
  ADD COLUMN "colorTerciario" TEXT,
  ADD COLUMN "colorFondo" TEXT,
  ADD COLUMN "logoUrl" TEXT,
  ADD COLUMN "distintivoTipo" TEXT,
  ADD COLUMN "distintivoValor" TEXT,
  ADD COLUMN "cartelSuperior" TEXT;

ALTER TABLE "vehiculos"
  ADD COLUMN "numeroInterno" TEXT,
  ADD COLUMN "distintivo" TEXT,
  ADD COLUMN "cartelSuperior" TEXT;

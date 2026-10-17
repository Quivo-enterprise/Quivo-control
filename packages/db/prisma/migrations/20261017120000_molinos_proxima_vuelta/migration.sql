-- docs/plan-molinos-cualquier-momento.md — designación a Molinos diferida: si el control designa
-- DESPUÉS de pasar la bifurcación en el regreso, vale para la vuelta siguiente. Se guarda en la
-- vuelta en curso y el worker la copia a `varianteId`/`designada*` de la vuelta nueva al abrirla.
ALTER TABLE "vueltas"
  ADD COLUMN "molinosProximaVarianteId" TEXT,
  ADD COLUMN "molinosProximaPor" TEXT,
  ADD COLUMN "molinosProximaEn" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "vueltas" ADD CONSTRAINT "vueltas_molinosProximaVarianteId_fkey" FOREIGN KEY ("molinosProximaVarianteId") REFERENCES "variantes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

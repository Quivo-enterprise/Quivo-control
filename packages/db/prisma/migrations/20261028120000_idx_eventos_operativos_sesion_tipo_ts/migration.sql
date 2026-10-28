-- /en-vivo: incidencias (`observacion`) de una sesión por hora de recepción
-- (`WHERE "sesionId" = $1 AND tipo = 'observacion' AND "receivedAt" >= $2 ORDER BY "receivedAt" DESC`).
-- CREATE INDEX plano (no CONCURRENTLY: las migraciones de Prisma corren en transacción): vale porque
-- eventos_operativos es chica en el piloto; revisar si crece.
CREATE INDEX "eventos_operativos_sesionId_tipo_receivedAt_idx" ON "eventos_operativos"("sesionId", "tipo", "receivedAt");

-- Redundante: (sesionId, tipo, receivedAt) ya cubre las búsquedas por prefijo (sesionId).
DROP INDEX "eventos_operativos_sesionId_idx";

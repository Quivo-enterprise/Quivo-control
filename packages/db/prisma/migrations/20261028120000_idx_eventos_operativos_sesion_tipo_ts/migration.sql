-- /en-vivo: la última `observacion` (incidencia del chofer) de cada sesión
-- (`WHERE "sesionId" = $1 AND tipo = 'observacion' ORDER BY ts DESC LIMIT 1`). Solo el índice.
CREATE INDEX "eventos_operativos_sesionId_tipo_ts_idx" ON "eventos_operativos"("sesionId", "tipo", "ts");

-- Release 13: el panel de jornadas busca el último `inicio_jornada` del día por sindicato
-- (`WHERE "sindicatoId" = $1 AND tipo = 'inicio_jornada' AND ts >= $2 AND ts < $3`). Solo el índice,
-- sin tablas ni columnas nuevas.
CREATE INDEX "eventos_operativos_sindicatoId_tipo_ts_idx" ON "eventos_operativos"("sindicatoId", "tipo", "ts");

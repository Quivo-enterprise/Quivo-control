-- Índices para que el catálogo/planner no hagan scans completos cuando crezca el número
-- de líneas y rutas publicadas.
CREATE INDEX IF NOT EXISTS "lineas_publicStatus_codigo_idx"
  ON "lineas"("publicStatus", "codigo");
CREATE INDEX IF NOT EXISTS "lineas_publicStatus_nombre_idx"
  ON "lineas"("publicStatus", "nombre");
CREATE INDEX IF NOT EXISTS "rutas_publicStatus_estado_lineaId_idx"
  ON "rutas"("publicStatus", "estado", "lineaId");
CREATE INDEX IF NOT EXISTS "rutas_geometria_gist_idx"
  ON "rutas" USING GIST ("geometria");
CREATE INDEX IF NOT EXISTS "variantes_publicStatus_estado_rutaId_idx"
  ON "variantes"("publicStatus", "estado", "rutaId");
CREATE INDEX IF NOT EXISTS "paradas_publicStatus_estado_rutaId_orden_idx"
  ON "paradas"("publicStatus", "estado", "rutaId", "orden");
CREATE INDEX IF NOT EXISTS "paradas_coord_gist_idx"
  ON "paradas" USING GIST ("coord");
CREATE INDEX IF NOT EXISTS "sesiones_operativas_vehicle_state_idx"
  ON "sesiones_operativas"("vehiculoId", "estado", "fin", "inicio" DESC);
CREATE INDEX IF NOT EXISTS "asignaciones_route_state_expiry_idx"
  ON "asignaciones"("rutaId", "estado", "venceAt");

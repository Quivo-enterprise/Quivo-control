-- QUI-231: rotaciones + asignaciones, con el constraint anti doble-asignación
-- (vehiculoId, fecha, horario) — la barrera real contra el riesgo #12 del doc técnico.

-- CreateTable
CREATE TABLE "rotaciones" (
    "id" TEXT NOT NULL,
    "sindicatoId" TEXT NOT NULL,
    "periodo" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'borrador',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rotaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asignaciones" (
    "id" TEXT NOT NULL,
    "rotacionId" TEXT NOT NULL,
    "vehiculoId" TEXT NOT NULL,
    "conductorId" TEXT,
    "rutaId" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "horario" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "venceAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asignaciones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rotaciones_sindicatoId_idx" ON "rotaciones"("sindicatoId");

-- CreateIndex
CREATE INDEX "asignaciones_rotacionId_idx" ON "asignaciones"("rotacionId");

-- CreateIndex (anti doble-asignación)
CREATE UNIQUE INDEX "asignaciones_vehiculoId_fecha_horario_key" ON "asignaciones"("vehiculoId", "fecha", "horario");

-- AddForeignKey
ALTER TABLE "rotaciones" ADD CONSTRAINT "rotaciones_sindicatoId_fkey" FOREIGN KEY ("sindicatoId") REFERENCES "sindicatos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asignaciones" ADD CONSTRAINT "asignaciones_rotacionId_fkey" FOREIGN KEY ("rotacionId") REFERENCES "rotaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asignaciones" ADD CONSTRAINT "asignaciones_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "vehiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asignaciones" ADD CONSTRAINT "asignaciones_conductorId_fkey" FOREIGN KEY ("conductorId") REFERENCES "conductores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asignaciones" ADD CONSTRAINT "asignaciones_rutaId_fkey" FOREIGN KEY ("rutaId") REFERENCES "rutas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS (QUI-218/QUI-231): `rotaciones` sí tiene columna `sindicatoId` propia, así que le
-- aplica la misma política que socios/vehiculos/conductores/lineas (rol `quivo_app` sin
-- BYPASSRLS, contexto por request vía withTenantContext — ver migración
-- 20260730152500_rls_multi_tenant para el detalle completo del mecanismo).
-- `asignaciones` NO la lleva: no tiene `sindicatoId` propio (lo hereda transitivamente vía
-- rotacionId -> rotacion.sindicatoId), mismo caso que rutas/variantes/paradas/puntos_control
-- — el tenant-check en código (common/geo/tenant-checks.ts, ampliado en QUI-232) es la
-- barrera ahí, no una política de Postgres.
ALTER TABLE rotaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE rotaciones FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON rotaciones
  USING (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  )
  WITH CHECK (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  );

-- QUI-244: reglas y sanciones (RF-40..50).

-- CreateTable
CREATE TABLE "reglas" (
    "id" TEXT NOT NULL,
    "sindicatoId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "gravedad" TEXT NOT NULL,
    "aplicaA" TEXT NOT NULL,
    "descripcion" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'activo',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reglas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sanciones" (
    "id" TEXT NOT NULL,
    "sindicatoId" TEXT NOT NULL,
    "reglaId" TEXT NOT NULL,
    "sujetoTipo" TEXT NOT NULL,
    "sujetoId" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "fechaHecho" DATE NOT NULL,
    "evidenciaRef" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sanciones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reglas_sindicatoId_idx" ON "reglas"("sindicatoId");

-- CreateIndex
CREATE INDEX "sanciones_sindicatoId_idx" ON "sanciones"("sindicatoId");

-- CreateIndex
CREATE INDEX "sanciones_reglaId_idx" ON "sanciones"("reglaId");

-- CreateIndex
CREATE INDEX "sanciones_sujetoTipo_sujetoId_idx" ON "sanciones"("sujetoTipo", "sujetoId");

-- AddForeignKey
ALTER TABLE "reglas" ADD CONSTRAINT "reglas_sindicatoId_fkey" FOREIGN KEY ("sindicatoId") REFERENCES "sindicatos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sanciones" ADD CONSTRAINT "sanciones_sindicatoId_fkey" FOREIGN KEY ("sindicatoId") REFERENCES "sindicatos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sanciones" ADD CONSTRAINT "sanciones_reglaId_fkey" FOREIGN KEY ("reglaId") REFERENCES "reglas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS (QUI-218 pattern): ambas tablas tienen `sindicatoId` propio.
ALTER TABLE reglas ENABLE ROW LEVEL SECURITY;
ALTER TABLE reglas FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON reglas
  USING (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  )
  WITH CHECK (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  );

ALTER TABLE sanciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE sanciones FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sanciones
  USING (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  )
  WITH CHECK (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  );

-- CreateTable
CREATE TABLE "sindicatos" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'activo',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sindicatos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "socios" (
    "id" TEXT NOT NULL,
    "sindicatoId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "documentoIdentidad" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'activo',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "socios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehiculos" (
    "id" TEXT NOT NULL,
    "sindicatoId" TEXT NOT NULL,
    "socioId" TEXT,
    "placa" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "marca" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "capacidad" INTEGER NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'activo',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehiculos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conductores" (
    "id" TEXT NOT NULL,
    "sindicatoId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "documentoIdentidad" TEXT NOT NULL,
    "licenciaConducir" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'activo',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conductores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lineas" (
    "id" TEXT NOT NULL,
    "sindicatoId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "color" TEXT,
    "descripcion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lineas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rutas" (
    "id" TEXT NOT NULL,
    "lineaId" TEXT NOT NULL,
    "sentido" TEXT NOT NULL,
    "geometria" geography(LineString,4326) NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'activo',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rutas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variantes" (
    "id" TEXT NOT NULL,
    "rutaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "variantes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paradas" (
    "id" TEXT NOT NULL,
    "rutaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "coord" geography(Point,4326) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paradas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "puntos_control" (
    "id" TEXT NOT NULL,
    "rutaId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "coord" geography(Point,4326) NOT NULL,
    "radioToleranciaM" INTEGER NOT NULL,
    "obligatorio" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "puntos_control_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "sindicatoId" TEXT,
    "usuarioId" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidadId" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "diff" JSONB,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "socios_sindicatoId_idx" ON "socios"("sindicatoId");

-- CreateIndex
CREATE INDEX "vehiculos_sindicatoId_idx" ON "vehiculos"("sindicatoId");

-- CreateIndex
CREATE UNIQUE INDEX "vehiculos_sindicatoId_placa_key" ON "vehiculos"("sindicatoId", "placa");

-- CreateIndex
CREATE INDEX "conductores_sindicatoId_idx" ON "conductores"("sindicatoId");

-- CreateIndex
CREATE INDEX "lineas_sindicatoId_idx" ON "lineas"("sindicatoId");

-- CreateIndex
CREATE UNIQUE INDEX "lineas_sindicatoId_codigo_key" ON "lineas"("sindicatoId", "codigo");

-- CreateIndex
CREATE INDEX "rutas_lineaId_idx" ON "rutas"("lineaId");

-- CreateIndex
CREATE INDEX "variantes_rutaId_idx" ON "variantes"("rutaId");

-- CreateIndex
CREATE INDEX "paradas_rutaId_idx" ON "paradas"("rutaId");

-- CreateIndex
CREATE INDEX "puntos_control_rutaId_idx" ON "puntos_control"("rutaId");

-- CreateIndex
CREATE INDEX "audit_log_sindicatoId_ts_idx" ON "audit_log"("sindicatoId", "ts");

-- AddForeignKey
ALTER TABLE "socios" ADD CONSTRAINT "socios_sindicatoId_fkey" FOREIGN KEY ("sindicatoId") REFERENCES "sindicatos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehiculos" ADD CONSTRAINT "vehiculos_sindicatoId_fkey" FOREIGN KEY ("sindicatoId") REFERENCES "sindicatos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehiculos" ADD CONSTRAINT "vehiculos_socioId_fkey" FOREIGN KEY ("socioId") REFERENCES "socios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conductores" ADD CONSTRAINT "conductores_sindicatoId_fkey" FOREIGN KEY ("sindicatoId") REFERENCES "sindicatos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineas" ADD CONSTRAINT "lineas_sindicatoId_fkey" FOREIGN KEY ("sindicatoId") REFERENCES "sindicatos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rutas" ADD CONSTRAINT "rutas_lineaId_fkey" FOREIGN KEY ("lineaId") REFERENCES "lineas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variantes" ADD CONSTRAINT "variantes_rutaId_fkey" FOREIGN KEY ("rutaId") REFERENCES "rutas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paradas" ADD CONSTRAINT "paradas_rutaId_fkey" FOREIGN KEY ("rutaId") REFERENCES "rutas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "puntos_control" ADD CONSTRAINT "puntos_control_rutaId_fkey" FOREIGN KEY ("rutaId") REFERENCES "rutas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_sindicatoId_fkey" FOREIGN KEY ("sindicatoId") REFERENCES "sindicatos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

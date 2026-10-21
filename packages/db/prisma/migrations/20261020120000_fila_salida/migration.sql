-- Fila de salida con frecuencias en la terminal (plan "fila de salida", PR 1 — shared + DB).
-- Cuatro tablas con RLS y la frecuencia base en `puntos_control`.

-- Frecuencia base de la parada (minutos entre salidas). Solo la terminal tiene fila.
ALTER TABLE "puntos_control"
  ADD COLUMN "frecuenciaSalidaMin" INTEGER,
  ADD CONSTRAINT "puntos_control_frecuencia_salida_min_check"
    CHECK ("frecuenciaSalidaMin" IS NULL OR ("rol" = 'terminal' AND "frecuenciaSalidaMin" BETWEEN 1 AND 120));

-- CreateTable
CREATE TABLE "grupos_vehiculo" (
    "id" TEXT NOT NULL,
    "sindicatoId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'activo',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grupos_vehiculo_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "grupos_vehiculo_estado_check" CHECK ("estado" IN ('activo', 'inactivo'))
);

-- CreateTable
CREATE TABLE "grupo_vehiculo_miembros" (
    "grupoId" TEXT NOT NULL,
    "vehiculoId" TEXT NOT NULL,
    "sindicatoId" TEXT NOT NULL,

    CONSTRAINT "grupo_vehiculo_miembros_pkey" PRIMARY KEY ("grupoId", "vehiculoId")
);

-- CreateTable
CREATE TABLE "frecuencia_reglas" (
    "id" TEXT NOT NULL,
    "sindicatoId" TEXT NOT NULL,
    "puntoControlId" TEXT NOT NULL,
    -- Día LOCAL de Bolivia (America/La_Paz, UTC-4) en que se creó la regla; vale hasta medianoche.
    "fecha" DATE NOT NULL,
    "alcance" TEXT NOT NULL,
    "grupoId" TEXT,
    "vehiculoId" TEXT,
    "minutos" INTEGER NOT NULL,
    -- Franja opcional en minutos del día local (0..1440); ambos o ninguno.
    "desdeMin" INTEGER,
    "hastaMin" INTEGER,
    -- Quién/cuándo, sin FK (auditoría: mismo criterio que `vueltas.designadaPor`). Se anula, nunca se borra.
    "creadaPor" TEXT NOT NULL,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anuladaEn" TIMESTAMP(3),
    "anuladaPor" TEXT,

    CONSTRAINT "frecuencia_reglas_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "frecuencia_reglas_alcance_check" CHECK ("alcance" IN ('todos', 'grupo', 'vehiculo')),
    CONSTRAINT "frecuencia_reglas_alcance_ids_check" CHECK (
      ("alcance" = 'todos' AND "grupoId" IS NULL AND "vehiculoId" IS NULL)
      OR ("alcance" = 'grupo' AND "grupoId" IS NOT NULL AND "vehiculoId" IS NULL)
      OR ("alcance" = 'vehiculo' AND "vehiculoId" IS NOT NULL AND "grupoId" IS NULL)
    ),
    CONSTRAINT "frecuencia_reglas_minutos_check" CHECK ("minutos" BETWEEN 1 AND 120),
    CONSTRAINT "frecuencia_reglas_franja_check" CHECK (
      ("desdeMin" IS NULL AND "hastaMin" IS NULL)
      OR ("desdeMin" IS NOT NULL AND "hastaMin" IS NOT NULL
          AND "desdeMin" >= 0 AND "hastaMin" <= 1440 AND "desdeMin" < "hastaMin")
    )
);

-- CreateTable
CREATE TABLE "fila_salida" (
    "id" TEXT NOT NULL,
    "sindicatoId" TEXT NOT NULL,
    "puntoControlId" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "sesionId" TEXT NOT NULL,
    "vehiculoId" TEXT NOT NULL,
    "llegadaTs" TIMESTAMP(3) NOT NULL,
    -- Orden en la fila: arranca igual a `llegadaTs`; "mover al final" lo pone en now().
    "ordenTs" TIMESTAMP(3) NOT NULL,
    "salidaTs" TIMESTAMP(3),
    "salidaOrigen" TEXT,
    "anticipada" BOOLEAN NOT NULL DEFAULT false,
    "estado" TEXT NOT NULL DEFAULT 'en_fila',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fila_salida_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fila_salida_estado_check" CHECK ("estado" IN ('en_fila', 'salio', 'retirado')),
    CONSTRAINT "fila_salida_origen_check" CHECK (
      "salidaOrigen" IS NULL OR "salidaOrigen" IN ('boton', 'geocerca', 'deteccion', 'panel')
    ),
    -- Salida registrada si y solo si estado = 'salio'.
    CONSTRAINT "fila_salida_salio_check" CHECK (
      ("estado" = 'salio' AND "salidaTs" IS NOT NULL AND "salidaOrigen" IS NOT NULL)
      OR ("estado" <> 'salio' AND "salidaTs" IS NULL AND "salidaOrigen" IS NULL)
    )
);

-- CreateIndex
-- Un trufi en un solo grupo: la precedencia de frecuencias no puede ser ambigua.
CREATE UNIQUE INDEX "grupo_vehiculo_miembros_vehiculoId_key" ON "grupo_vehiculo_miembros"("vehiculoId");
CREATE INDEX "grupos_vehiculo_sindicatoId_idx" ON "grupos_vehiculo"("sindicatoId");
CREATE INDEX "grupo_vehiculo_miembros_sindicatoId_idx" ON "grupo_vehiculo_miembros"("sindicatoId");

-- Reglas vigentes de una parada en un día (índice parcial: Prisma no lo modela, solo SQL).
CREATE INDEX "frecuencia_reglas_puntoControlId_fecha_idx" ON "frecuencia_reglas"("puntoControlId", "fecha") WHERE "anuladaEn" IS NULL;
CREATE INDEX "frecuencia_reglas_sindicatoId_idx" ON "frecuencia_reglas"("sindicatoId");

-- A lo sumo UNA fila abierta por trufi (idempotencia de la llegada; índice parcial, solo SQL).
CREATE UNIQUE INDEX "fila_salida_vehiculoId_en_fila_key" ON "fila_salida"("vehiculoId") WHERE "estado" = 'en_fila';
CREATE INDEX "fila_salida_puntoControlId_fecha_estado_ordenTs_idx" ON "fila_salida"("puntoControlId", "fecha", "estado", "ordenTs");
CREATE INDEX "fila_salida_sesionId_idx" ON "fila_salida"("sesionId");
CREATE INDEX "fila_salida_sindicatoId_idx" ON "fila_salida"("sindicatoId");

-- AddForeignKey
ALTER TABLE "grupos_vehiculo" ADD CONSTRAINT "grupos_vehiculo_sindicatoId_fkey" FOREIGN KEY ("sindicatoId") REFERENCES "sindicatos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "grupo_vehiculo_miembros" ADD CONSTRAINT "grupo_vehiculo_miembros_grupoId_fkey" FOREIGN KEY ("grupoId") REFERENCES "grupos_vehiculo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grupo_vehiculo_miembros" ADD CONSTRAINT "grupo_vehiculo_miembros_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "vehiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grupo_vehiculo_miembros" ADD CONSTRAINT "grupo_vehiculo_miembros_sindicatoId_fkey" FOREIGN KEY ("sindicatoId") REFERENCES "sindicatos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "frecuencia_reglas" ADD CONSTRAINT "frecuencia_reglas_sindicatoId_fkey" FOREIGN KEY ("sindicatoId") REFERENCES "sindicatos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "frecuencia_reglas" ADD CONSTRAINT "frecuencia_reglas_puntoControlId_fkey" FOREIGN KEY ("puntoControlId") REFERENCES "puntos_control"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "frecuencia_reglas" ADD CONSTRAINT "frecuencia_reglas_grupoId_fkey" FOREIGN KEY ("grupoId") REFERENCES "grupos_vehiculo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "frecuencia_reglas" ADD CONSTRAINT "frecuencia_reglas_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "vehiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fila_salida" ADD CONSTRAINT "fila_salida_sindicatoId_fkey" FOREIGN KEY ("sindicatoId") REFERENCES "sindicatos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fila_salida" ADD CONSTRAINT "fila_salida_puntoControlId_fkey" FOREIGN KEY ("puntoControlId") REFERENCES "puntos_control"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fila_salida" ADD CONSTRAINT "fila_salida_sesionId_fkey" FOREIGN KEY ("sesionId") REFERENCES "sesiones_operativas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fila_salida" ADD CONSTRAINT "fila_salida_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "vehiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS (mismo patrón que `vueltas`).
ALTER TABLE grupos_vehiculo ENABLE ROW LEVEL SECURITY;
ALTER TABLE grupos_vehiculo FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON grupos_vehiculo
  USING (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  )
  WITH CHECK (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  );

ALTER TABLE grupo_vehiculo_miembros ENABLE ROW LEVEL SECURITY;
ALTER TABLE grupo_vehiculo_miembros FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON grupo_vehiculo_miembros
  USING (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  )
  WITH CHECK (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  );

ALTER TABLE frecuencia_reglas ENABLE ROW LEVEL SECURITY;
ALTER TABLE frecuencia_reglas FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON frecuencia_reglas
  USING (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  )
  WITH CHECK (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  );

ALTER TABLE fila_salida ENABLE ROW LEVEL SECURITY;
ALTER TABLE fila_salida FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fila_salida
  USING (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  )
  WITH CHECK (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  );

-- Sin GRANT explícito: `ALTER DEFAULT PRIVILEGES` de `20260730152500_rls_multi_tenant` cubre
-- las tablas nuevas.

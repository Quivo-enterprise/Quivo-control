-- docs/plan-en-vivo-alertas.md, PR A — infracciones detectadas automáticamente (desvío de
-- ruta y punto de control omitido) y el estado de la máquina de desvío por sesión.

-- Calidad de la geometría de la ruta para la detección de desvío. Las rutas cargadas desde
-- bocetos KML dibujados a mano (Línea 120: vértices separados hasta 1,3 km; Línea 16: hasta
-- 580 m) generan falsos desvíos contra el umbral de 100 m, porque la línea recta entre dos
-- vértices lejanos no sigue la calle real. Por eso el desvío SOLO se evalúa en rutas con
-- "desvioHabilitado" = true. NINGUNA ruta se habilita en esta migración: se habilita a mano
-- (por SQL, por ahora, sin UI) únicamente en geometrías trazadas con GPS real (p. ej. el
-- circuito Z12). El PC omitido no depende de la geometría y no usa este flag.
ALTER TABLE "rutas" ADD COLUMN "desvioHabilitado" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "infracciones" (
    "id" TEXT NOT NULL,
    "sindicatoId" TEXT NOT NULL,
    "sesionId" TEXT NOT NULL,
    "vehiculoId" TEXT NOT NULL,
    "conductorId" TEXT NOT NULL,
    "lineaId" TEXT NOT NULL,
    "rutaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "gravedad" TEXT NOT NULL,
    "reglaId" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'abierta',
    "inicioTs" TIMESTAMP(3) NOT NULL,
    "finTs" TIMESTAMP(3),
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "detalle" JSONB NOT NULL,
    "sancionId" TEXT,
    "atendidaPor" TEXT,
    "atendidaEn" TIMESTAMP(3),
    "nota" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "infracciones_pkey" PRIMARY KEY ("id"),
    -- Dominio de los textos (CHECK, mismo criterio que `sesiones_operativas_recorrido_estado_check`).
    CONSTRAINT "infracciones_tipo_check" CHECK ("tipo" IN ('desvio_ruta', 'pc_omitido')),
    CONSTRAINT "infracciones_gravedad_check" CHECK ("gravedad" IN ('leve', 'grave', 'gravisima')),
    CONSTRAINT "infracciones_estado_check" CHECK ("estado" IN ('abierta', 'atendida', 'sancionada', 'descartada'))
);

-- CreateIndex
CREATE UNIQUE INDEX "infracciones_dedupeKey_key" ON "infracciones"("dedupeKey");

-- CreateIndex
CREATE INDEX "infracciones_sesionId_estado_idx" ON "infracciones"("sesionId", "estado");

-- CreateIndex
CREATE INDEX "infracciones_sindicatoId_estado_idx" ON "infracciones"("sindicatoId", "estado");

-- AddForeignKey
ALTER TABLE "infracciones" ADD CONSTRAINT "infracciones_sindicatoId_fkey" FOREIGN KEY ("sindicatoId") REFERENCES "sindicatos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "infracciones" ADD CONSTRAINT "infracciones_sesionId_fkey" FOREIGN KEY ("sesionId") REFERENCES "sesiones_operativas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (mismo patrón que `reglas`/`sanciones`/`gps_sesion_resumen`, QUI-218).
ALTER TABLE infracciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE infracciones FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON infracciones
  USING (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  )
  WITH CHECK (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  );

-- Estado de la máquina de desvío por sesión. Sin modelo Prisma (SQL crudo desde el worker de
-- ingesta: `SELECT ... FOR UPDATE` + upsert). `sesion_id` TEXT para unirse a
-- `sesiones_operativas.id` sin casts; sin FK propia (hot path de ingesta, mismo criterio que
-- `gps_sesion_resumen`). `"sindicatoId"` NOT NULL con FK para que la policy aísle por tenant.
CREATE TABLE sesion_desvio_estado (
  sesion_id          TEXT NOT NULL,
  "sindicatoId"      TEXT NOT NULL,
  -- Inicio de la racha de puntos fuera de ruta (candidata o ya abierta). NULL = sin racha.
  fuera_desde_ts     TIMESTAMPTZ,
  -- Puntos fuera de ruta consecutivos de la racha actual.
  puntos_fuera       INTEGER NOT NULL DEFAULT 0,
  -- Puntos consecutivos de regreso (< umbral de histéresis) con la infracción abierta.
  dentro_consecutivos INTEGER NOT NULL DEFAULT 0,
  -- Recorrido (ts del inicio_recorrido) al que pertenece la racha actual. NULL = ninguno. Un
  -- punto de otro recorrido, o el fin_recorrido, cierra la infracción abierta y reinicia la máquina.
  recorrido_inicio_ts TIMESTAMPTZ,
  -- ts del último punto procesado (NULL = fila recién creada): los puntos con ts <= ultimo_ts (tardíos del outbox) se ignoran.
  ultimo_ts          TIMESTAMPTZ,
  -- Infracción de desvío actualmente abierta (NULL si no hay).
  infraccion_id      TEXT,
  distancia_max_m    DOUBLE PRECISION NOT NULL DEFAULT 0,
  lat_inicio         DOUBLE PRECISION,
  lng_inicio         DOUBLE PRECISION,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sesion_desvio_estado_pkey PRIMARY KEY (sesion_id)
);

ALTER TABLE sesion_desvio_estado
  ADD CONSTRAINT sesion_desvio_estado_sindicatoid_fkey FOREIGN KEY ("sindicatoId")
  REFERENCES sindicatos(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE sesion_desvio_estado ENABLE ROW LEVEL SECURITY;
ALTER TABLE sesion_desvio_estado FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sesion_desvio_estado
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

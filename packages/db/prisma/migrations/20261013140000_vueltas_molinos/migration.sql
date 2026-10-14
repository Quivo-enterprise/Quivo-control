-- docs/plan-molinos-designacion.md, F1-api — vueltas en el servidor, designación a Molinos
-- (variante con punto de espera) y las dos alertas nuevas (`molinos_omitido`, `espera_corta`).

-- Rol operativo de un punto de control dentro del ciclo de vueltas. NULL = punto común.
-- 'terminal' abre/cierra vueltas, 'retorno' marca el medio de la vuelta, 'espera' es donde la
-- unidad designada debe permanecer `espera_min` minutos (Molinos).
ALTER TABLE "puntos_control"
  ADD COLUMN "rol" TEXT,
  ADD COLUMN "esperaMin" INTEGER,
  ADD CONSTRAINT "puntos_control_rol_check"
    CHECK ("rol" IS NULL OR "rol" IN ('terminal', 'retorno', 'espera')),
  -- `esperaMin` solo tiene sentido en un punto de espera, y debe ser positivo.
  ADD CONSTRAINT "puntos_control_espera_min_check"
    CHECK ("esperaMin" IS NULL OR ("rol" = 'espera' AND "esperaMin" > 0));

-- Tramo ADICIONAL de la variante (no el recorrido completo) y su punto de espera. El desvío
-- de una vuelta designada se mide contra LEAST(ruta base, tramo de la variante).
ALTER TABLE "variantes"
  ADD COLUMN "geometria" geography(LineString,4326),
  ADD COLUMN "puntoEsperaId" TEXT;

ALTER TABLE "variantes"
  ADD CONSTRAINT "variantes_puntoEsperaId_fkey" FOREIGN KEY ("puntoEsperaId")
  REFERENCES "puntos_control"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "variantes_puntoEsperaId_idx" ON "variantes"("puntoEsperaId");

-- Tipos de infracción nuevos.
ALTER TABLE "infracciones" DROP CONSTRAINT "infracciones_tipo_check";
ALTER TABLE "infracciones" ADD CONSTRAINT "infracciones_tipo_check"
  CHECK ("tipo" IN ('desvio_ruta', 'pc_omitido', 'molinos_omitido', 'espera_corta'));

-- CreateTable
CREATE TABLE "vueltas" (
    "id" TEXT NOT NULL,
    "sindicatoId" TEXT NOT NULL,
    "sesionId" TEXT NOT NULL,
    -- Snapshot de quién/dónde (mismo criterio que `infracciones`: sin FK, el histórico no
    -- depende de que el vehículo/conductor/línea/ruta sigan existiendo igual).
    "vehiculoId" TEXT NOT NULL,
    "conductorId" TEXT NOT NULL,
    "lineaId" TEXT NOT NULL,
    "rutaId" TEXT NOT NULL,
    -- Día LOCAL de Bolivia (America/La_Paz, UTC-4) de `inicioTs`.
    "fecha" DATE NOT NULL,
    "numero" INTEGER NOT NULL,
    "inicioTs" TIMESTAMP(3) NOT NULL,
    "finTs" TIMESTAMP(3),
    "estado" TEXT NOT NULL DEFAULT 'en_curso',
    "pasoRetornoTs" TIMESTAMP(3),
    "varianteId" TEXT,
    "designadaPor" TEXT,
    "designadaEn" TIMESTAMP(3),
    "acuseEn" TIMESTAMP(3),
    "esperaLlegadaTs" TIMESTAMP(3),
    "esperaSalidaTs" TIMESTAMP(3),
    -- Último cumplimiento de un PC distinto de la terminal dentro de la vuelta (retorno, espera o
    -- común). NULL + sin retorno + sin designar = vuelta "vacía" (se elimina al cerrarse).
    "ultimoPcTs" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vueltas_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vueltas_estado_check" CHECK ("estado" IN ('en_curso', 'completa', 'abierta_al_cierre')),
    CONSTRAINT "vueltas_numero_check" CHECK ("numero" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "vueltas_sesionId_numero_key" ON "vueltas"("sesionId", "numero");

-- A lo sumo UNA vuelta en curso por sesión (índice parcial: Prisma no lo modela, solo SQL).
CREATE UNIQUE INDEX "vueltas_sesionId_en_curso_key" ON "vueltas"("sesionId") WHERE "estado" = 'en_curso';

-- "Molinos hoy" por vehículo (positions poll) y resumen por línea/día.
CREATE INDEX "vueltas_vehiculoId_fecha_idx" ON "vueltas"("vehiculoId", "fecha");
CREATE INDEX "vueltas_lineaId_fecha_idx" ON "vueltas"("lineaId", "fecha");
CREATE INDEX "vueltas_sindicatoId_fecha_idx" ON "vueltas"("sindicatoId", "fecha");

-- AddForeignKey
ALTER TABLE "vueltas" ADD CONSTRAINT "vueltas_sindicatoId_fkey" FOREIGN KEY ("sindicatoId") REFERENCES "sindicatos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vueltas" ADD CONSTRAINT "vueltas_sesionId_fkey" FOREIGN KEY ("sesionId") REFERENCES "sesiones_operativas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vueltas" ADD CONSTRAINT "vueltas_varianteId_fkey" FOREIGN KEY ("varianteId") REFERENCES "variantes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS (mismo patrón que `infracciones`).
ALTER TABLE vueltas ENABLE ROW LEVEL SECURITY;
ALTER TABLE vueltas FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vueltas
  USING (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  )
  WITH CHECK (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  );

-- Al cerrarse la sesión de login (logout, revocación, relogin del vehículo/conductor: todos los
-- caminos pasan por `estado = 'cerrada'`) la vuelta en curso termina. Un trigger cubre todos esos
-- caminos sin tocar cada uno. Corre como el invocador (FORCE RLS sobre `vueltas`), y el contexto de
-- tenant de quien cierra la sesión NO está garantizado (p. ej. un job sin `app.sindicato_id`): sin
-- él la RLS filtraría todas las filas y el UPDATE/DELETE no haría nada EN SILENCIO. Por eso la
-- función fija `app.sindicato_id` al sindicato de LA PROPIA sesión mientras toca `vueltas` y
-- restaura el valor previo (nunca toca `app.rol`: no escala privilegios, solo apunta a su tenant).
--
-- Vuelta "vacía" (sin designar, sin retorno, sin otro PC tras abrirse): se ELIMINA en vez de
-- cerrarla `abierta_al_cierre`; es siempre la última del día, así que la numeración no deja huecos.
-- Mismo criterio que la máquina (`esVueltaVacia` en ingesta-worker/vueltas.ts).
--
-- LIMITACIÓN: este camino NO emite `molinos_omitido` para una vuelta designada que queda
-- `abierta_al_cierre` (un trigger no registra infracciones con su regla/gravedad). Lo cubrirá el
-- chequeo F2 de "vueltas faltantes".
CREATE FUNCTION vueltas_cerrar_con_sesion() RETURNS trigger AS $$
DECLARE
  sindicato_previo text;
BEGIN
  IF NEW.estado = 'cerrada' AND OLD.estado IS DISTINCT FROM 'cerrada' THEN
    sindicato_previo := current_setting('app.sindicato_id', true);
    PERFORM set_config('app.sindicato_id', NEW."sindicatoId"::text, true);

    DELETE FROM vueltas
    WHERE "sesionId" = NEW.id AND estado = 'en_curso'
      AND "varianteId" IS NULL AND "pasoRetornoTs" IS NULL AND "ultimoPcTs" IS NULL
      AND "esperaLlegadaTs" IS NULL;

    UPDATE vueltas
    SET estado = 'abierta_al_cierre', "finTs" = COALESCE(NEW.fin, now()), "updatedAt" = now()
    WHERE "sesionId" = NEW.id AND estado = 'en_curso';

    -- '' (no NULL) cuando no había valor: las políticas comparan contra current_setting y una
    -- cadena vacía no coincide con ningún sindicato, igual que un GUC sin definir.
    PERFORM set_config('app.sindicato_id', COALESCE(sindicato_previo, ''), true);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sesiones_operativas_cierre_vueltas
  AFTER UPDATE OF estado ON sesiones_operativas
  FOR EACH ROW EXECUTE FUNCTION vueltas_cerrar_con_sesion();

-- Sin GRANT explícito: `ALTER DEFAULT PRIVILEGES` de `20260730152500_rls_multi_tenant` cubre
-- las tablas nuevas.

-- Catálogo de ciudades y áreas de cobertura para evitar mezclar líneas con el
-- mismo código entre departamentos. Las ciudades sin feed revisado quedan
-- visibles como próximas, pero no tienen líneas publicadas por esta migración.
CREATE TABLE "mobility_cities" (
  "id" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  "departamentoCodigo" TEXT,
  "departamentoNombre" TEXT,
  "paisCodigo" TEXT NOT NULL DEFAULT 'BO',
  "zonaHoraria" TEXT NOT NULL DEFAULT 'America/La_Paz',
  "estadoCobertura" TEXT NOT NULL DEFAULT 'coming_soon',
  "fuenteTipo" TEXT,
  "fuenteNombre" TEXT,
  "fuenteLicencia" TEXT,
  "fuenteActualizadaAt" TIMESTAMP(3),
  "modosDisponibles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "serviciosAuxiliares" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mobility_cities_pkey" PRIMARY KEY ("id")
);

INSERT INTO "mobility_cities"
  ("id", "nombre", "departamentoCodigo", "departamentoNombre", "estadoCobertura", "fuenteTipo", "fuenteNombre", "fuenteLicencia", "modosDisponibles", "serviciosAuxiliares")
VALUES
  ('cochabamba', 'Cochabamba metropolitana', 'BO-C', 'Cochabamba', 'ready', 'official+auxiliary', 'QUIVO Control + Trufi/OSM', 'ODbL / fuentes de operadores', ARRAY['road'], ARRAY['rail']),
  ('la-paz-el-alto', 'La Paz / El Alto', 'BO-L', 'La Paz', 'community', 'community+municipal', 'OSM/Overpass + catálogo municipal', 'ODbL / referencias municipales', ARRAY['road', 'rail', 'cable'], ARRAY['schedule-dependent']),
  ('santa-cruz', 'Santa Cruz de la Sierra', 'BO-S', 'Santa Cruz', 'coming_soon', 'community+municipal', 'OSM + operadores/municipio', NULL, ARRAY['road', 'rail'], ARRAY[]::TEXT[]),
  ('tarija', 'Tarija', 'BO-T', 'Tarija', 'coming_soon', 'community+municipal', 'OSM + operadores/municipio', NULL, ARRAY['road'], ARRAY[]::TEXT[]),
  ('sucre', 'Sucre', 'BO-H', 'Chuquisaca', 'coming_soon', 'community+municipal', 'OSM + operadores/municipio', NULL, ARRAY['road'], ARRAY[]::TEXT[]),
  ('potosi', 'Potosí', 'BO-P', 'Potosí', 'coming_soon', 'community+municipal', 'OSM + operadores/municipio', NULL, ARRAY['road', 'rail'], ARRAY[]::TEXT[]),
  ('trinidad', 'Trinidad', 'BO-B', 'Beni', 'coming_soon', 'community', 'Levantamiento local + OSM', NULL, ARRAY['road'], ARRAY[]::TEXT[]),
  ('oruro', 'Oruro', 'BO-O', 'Oruro', 'coming_soon', 'community', 'Levantamiento local + OSM', NULL, ARRAY['road', 'rail'], ARRAY[]::TEXT[]),
  ('cobija', 'Cobija', 'BO-N', 'Pando', 'coming_soon', 'community', 'Levantamiento local + OSM', NULL, ARRAY['road'], ARRAY[]::TEXT[]);

ALTER TABLE "lineas"
  ADD COLUMN "cityId" TEXT NOT NULL DEFAULT 'cochabamba';

ALTER TABLE "lineas"
  ADD CONSTRAINT "lineas_cityId_fkey"
  FOREIGN KEY ("cityId") REFERENCES "mobility_cities"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "mobility_cities_estadoCobertura_idx"
  ON "mobility_cities"("estadoCobertura");
CREATE INDEX "lineas_cityId_publicStatus_idx"
  ON "lineas"("cityId", "publicStatus");

-- Unicidad de placa de vehículo (docs/plan-unicidad-placa.md).
--
-- `Vehiculo.placaNormalizada` pasa de `String? @unique` (nullable, unicidad GLOBAL que en
-- la práctica no se aplicaba a ninguna fila con NULL — Postgres no colisiona NULLs en un
-- índice único, y la migración `20260801153000_mejora_entidad_vehiculo` puso NULL a
-- propósito en los duplicados históricos para poder crear ese índice) a una columna
-- GENERATED ALWAYS por Postgres, NOT NULL, con unicidad global acotada a lo VIGENTE
-- (`estado <> 'inactivo'`) vía índice único parcial. `inactivo` es el único estado que
-- significa "ya no es mío" (`EstadoVehiculoSchema`, packages/shared/src/enums/estados.ts) —
-- el predicado más ancho que todavía permite que un vehículo migre de sindicato (el viejo lo
-- da de baja, el nuevo lo registra) sin permitir dos filas VIGENTES con la misma placa a la
-- vez.
--
-- Postgres 16 no permite convertir una columna existente en GENERATED — de ahí el DROP +
-- ADD en vez de un ALTER. No hace falta backfill: el valor es derivado de `placa` (NOT
-- NULL), y `regexp_replace`/`upper`/`btrim` son las tres IMMUTABLE, requisito de STORED.
--
-- Dropea también `@@unique([sindicatoId, placa])` (sobre la placa CRUDA — permitía
-- "123 ABC" y "123ABC" convivir en el mismo sindicato) SIN reemplazarlo por un unique
-- equivalente sobre la normalizada: el índice único parcial global de abajo ya cubre esa
-- unicidad para las filas VIGENTES, y un unique total por sindicato bloquearía el ciclo
-- baja/alta que el diseño permite a propósito (ver comentario junto al índice, más abajo).

-- DropIndex: unicidad vieja por sindicato sobre la placa cruda.
DROP INDEX "vehiculos_sindicatoId_placa_key";

-- DropColumn: se lleva puesto el índice único global viejo (`vehiculos_placa_normalizada_key`)
-- — ese índice era el agujero original de este problema.
ALTER TABLE "vehiculos" DROP COLUMN "placaNormalizada";

-- AddColumn: columna generada. Ningún camino de escritura (Prisma Client, $queryRaw, seed,
-- scripts/, INSERT crudo) puede evadirla — Postgres rechaza cualquier intento de escribirla
-- a mano con SQLSTATE 428C9 ("cannot insert a non-DEFAULT value into column").
ALTER TABLE "vehiculos"
  ADD COLUMN "placaNormalizada" TEXT
    GENERATED ALWAYS AS (regexp_replace(upper(btrim(placa)), '[^A-Z0-9]', '', 'g')) STORED
    NOT NULL;

-- Guard 1: si ya existiera una fila cuya `placaNormalizada` NO matchea el patrón estructural
-- de abajo (ej. una placa legada `"S/N"`, `"-"`, `""`, o de más de 20 caracteres), este
-- bloque aborta RUIDOSAMENTE listándola (con `id`/`sindicatoId`) ANTES del `ADD CONSTRAINT`
-- de más abajo — sin este guard, `migrate deploy` abortaría con un `23514` pelado de
-- Postgres, sin decir qué fila. Puede leer `placaNormalizada` directamente porque la columna
-- generada ya existe (ver `ADD COLUMN` arriba).
DO $$
DECLARE
  invalidas TEXT;
BEGIN
  SELECT string_agg(
    format('  - vehiculo.id: %s, sindicatoId: %s, placa=%s, placaNormalizada=%s', id, "sindicatoId", placa, "placaNormalizada"),
    E'\n'
  )
  INTO invalidas
  FROM "vehiculos"
  WHERE "placaNormalizada" !~ '^[A-Z0-9]{3,20}$';

  IF invalidas IS NOT NULL THEN
    RAISE EXCEPTION E'Unicidad de placa: hay vehiculos cuya placaNormalizada NO matchea el patron estructural ^[A-Z0-9]{3,20}$. Resolver a mano (corregir la placa) antes de aplicar esta migracion:\n%', invalidas;
  END IF;
END $$;

-- Guard 2: si ya existiera una colisión bajo el predicado del índice único parcial de abajo,
-- este bloque aborta RUIDOSAMENTE listándola, en vez de dejar que el CREATE UNIQUE INDEX
-- falle con un mensaje genérico de Postgres sin contexto de negocio. Poner NULL en silencio
-- para poder crear el índice fue exactamente el pecado de `20260801153000` — no se repite.
-- Medido en quivo_control y quivo_control_e2echeck el 2026-09-08: 0 colisiones.
DO $$
DECLARE
  colisiones TEXT;
BEGIN
  SELECT string_agg(
    format('  - placaNormalizada=%s -> vehiculo.id: %s', placa_norm, ids),
    E'\n'
  )
  INTO colisiones
  FROM (
    SELECT "placaNormalizada" AS placa_norm, string_agg(id, ', ') AS ids
    FROM "vehiculos"
    WHERE estado <> 'inactivo'
    GROUP BY "placaNormalizada"
    HAVING count(*) > 1
  ) duplicados;

  IF colisiones IS NOT NULL THEN
    RAISE EXCEPTION E'Unicidad de placa: hay vehiculos VIGENTES (estado <> ''inactivo'') con la misma placaNormalizada. Resolver a mano (dar de baja el/los duplicado/s historico/s, o corregir la placa) antes de aplicar esta migracion:\n%', colisiones;
  END IF;
END $$;

-- CHECK de sanidad ESTRUCTURAL — no el patrón PTA (RUAT puede cambiarlo; esa validación
-- semántica se queda en `PlacaVehiculoSchema`, packages/shared/src/entities/vehiculo.ts).
-- Corre DESPUÉS de los dos guards de arriba a propósito: si hay filas legadas que lo violan,
-- el CTO ya se enteró con contexto de negocio (id/sindicatoId) en vez de un 23514 pelado.
ALTER TABLE "vehiculos"
  ADD CONSTRAINT "vehiculos_placa_norm_check" CHECK ("placaNormalizada" ~ '^[A-Z0-9]{3,20}$');

-- Índice único PARCIAL: la unicidad global real, acotada a lo vigente.
CREATE UNIQUE INDEX "vehiculos_placa_norm_vigente_key" ON "vehiculos"("placaNormalizada") WHERE (estado <> 'inactivo');

-- Índice plano (no parcial): el lookup del login móvil por placa (`WHERE estado = 'activo'
-- AND "placaNormalizada" = $1`, auth-movil.service.ts) no puede confiar en que el planner
-- deduzca `estado = 'activo' ⇒ estado <> 'inactivo'` para usar el índice parcial de arriba
-- — esa deducción no está garantizada. Este índice cubre ese lookup siempre.
CREATE INDEX "vehiculos_placaNormalizada_idx" ON "vehiculos"("placaNormalizada");

-- NO hay `@@unique([sindicatoId, placaNormalizada])` (a diferencia del viejo
-- `@@unique([sindicatoId, placa])` que este archivo dropea arriba) — sería TOTAL, no parcial,
-- y el índice único parcial global de arriba (`vehiculos_placa_norm_vigente_key`) ya implica
-- esa unicidad para toda fila VIGENTE, en cualquier sindicato. Un unique total por sindicato
-- además prohibiría DOS filas INACTIVAS con la misma placa en el mismo sindicato, que es
-- justo el camino de recuperación que el diseño permite a propósito (dar de baja y volver a
-- registrar la misma placa, incluso en el mismo sindicato) — con ese unique, ese ciclo
-- baja/alta quedaría bloqueado para siempre. `@@index([sindicatoId])` (ya existe, sin tocar
-- en esta migración) sigue cubriendo las consultas por tenant.

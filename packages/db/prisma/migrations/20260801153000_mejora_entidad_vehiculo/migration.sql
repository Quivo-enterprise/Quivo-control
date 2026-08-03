-- QV-ESP-ESP-CTL-2026-001: datos controlados, placa global normalizada y trazabilidad.

ALTER TABLE vehiculos
  ADD COLUMN "placaNormalizada" TEXT,
  ADD COLUMN "colorSecundario" TEXT,
  ALTER COLUMN estado SET DEFAULT 'pendiente';

UPDATE vehiculos
SET "placaNormalizada" = regexp_replace(upper(trim(placa)), '[^A-Z0-9]', '', 'g');

-- Los duplicados históricos se conservan para revisión manual. Solo la primera fila queda
-- normalizada; las demás mantienen NULL y no impiden aplicar la restricción a registros nuevos.
WITH placas_repetidas AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY "placaNormalizada"
           ORDER BY "createdAt", id
         ) AS posicion
  FROM vehiculos
  WHERE "placaNormalizada" IS NOT NULL
)
UPDATE vehiculos AS v
SET "placaNormalizada" = NULL
FROM placas_repetidas AS p
WHERE v.id = p.id AND p.posicion > 1;

CREATE UNIQUE INDEX vehiculos_placa_normalizada_key ON vehiculos("placaNormalizada");
CREATE INDEX vehiculos_tipo_idx ON vehiculos(tipo);
CREATE INDEX vehiculos_estado_idx ON vehiculos(estado);

UPDATE vehiculos
SET tipo = CASE
  WHEN lower(trim(tipo)) IN ('taxi trufi', 'taxi_trufi') THEN 'taxi_trufi'
  WHEN lower(trim(tipo)) = 'trufi' THEN 'trufi'
  WHEN lower(regexp_replace(trim(tipo), '\\s+', '', 'g')) IN ('minibus', 'microbus') THEN 'minibus'
  WHEN lower(trim(tipo)) = 'micro' THEN 'micro'
  WHEN lower(trim(tipo)) IN ('bus', 'bus urbano', 'bus_urbano') THEN 'bus_urbano'
  WHEN lower(trim(tipo)) IN ('omnibus', 'ómnibus') THEN 'omnibus'
  ELSE 'otro'
END;

UPDATE vehiculos
SET color = CASE
  WHEN lower(trim(color)) IN (
    'blanco', 'negro', 'gris', 'plateado', 'rojo', 'azul', 'verde', 'amarillo',
    'naranja', 'cafe', 'beige', 'celeste', 'morado', 'multicolor', 'otro'
  ) THEN lower(trim(color))
  WHEN lower(trim(color)) = 'café' THEN 'cafe'
  ELSE 'otro'
END;

CREATE TABLE historial_estados_vehiculo (
  id TEXT NOT NULL,
  "sindicatoId" TEXT NOT NULL,
  "vehiculoId" TEXT NOT NULL,
  "estadoDesde" TEXT,
  "estadoHasta" TEXT NOT NULL,
  motivo TEXT,
  observacion TEXT,
  "retornoEstimado" TIMESTAMP(3),
  "actorId" TEXT NOT NULL,
  origen TEXT NOT NULL DEFAULT 'web',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT historial_estados_vehiculo_pkey PRIMARY KEY (id)
);

CREATE INDEX historial_estados_vehiculo_sindicato_created_idx
  ON historial_estados_vehiculo("sindicatoId", "createdAt");
CREATE INDEX historial_estados_vehiculo_vehiculo_created_idx
  ON historial_estados_vehiculo("vehiculoId", "createdAt");

ALTER TABLE historial_estados_vehiculo
  ADD CONSTRAINT historial_estados_vehiculo_sindicato_fkey
    FOREIGN KEY ("sindicatoId") REFERENCES sindicatos(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT historial_estados_vehiculo_vehiculo_fkey
    FOREIGN KEY ("vehiculoId") REFERENCES vehiculos(id) ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO historial_estados_vehiculo (
  id, "sindicatoId", "vehiculoId", "estadoDesde", "estadoHasta", "actorId", origen, "createdAt"
)
SELECT gen_random_uuid()::text, "sindicatoId", id, NULL, estado, 'migracion', 'migracion', "createdAt"
FROM vehiculos;

GRANT SELECT, INSERT, UPDATE, DELETE ON historial_estados_vehiculo TO quivo_app;

ALTER TABLE historial_estados_vehiculo ENABLE ROW LEVEL SECURITY;
ALTER TABLE historial_estados_vehiculo FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON historial_estados_vehiculo
  USING (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  )
  WITH CHECK (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  );

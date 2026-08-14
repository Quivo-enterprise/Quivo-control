-- M3: acceso móvil vehículo -> conductor y sesiones operativas revocables.

ALTER TABLE conductores ADD COLUMN "credencialHash" TEXT;

CREATE TABLE desafios_auth_movil (
  id TEXT NOT NULL,
  "sindicatoId" TEXT NOT NULL,
  "vehiculoId" TEXT NOT NULL,
  "conductorId" TEXT,
  "tokenHash" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "intentosConductor" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT desafios_auth_movil_pkey PRIMARY KEY (id)
);

CREATE TABLE sesiones_operativas (
  id TEXT NOT NULL,
  "sindicatoId" TEXT NOT NULL,
  "asignacionId" TEXT NOT NULL,
  "vehiculoId" TEXT NOT NULL,
  "conductorId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  inicio TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fin TIMESTAMP(3),
  estado TEXT NOT NULL DEFAULT 'activa',
  "accessTokenHash" TEXT NOT NULL,
  "refreshTokenHash" TEXT NOT NULL,
  "accessExpiresAt" TIMESTAMP(3) NOT NULL,
  "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT sesiones_operativas_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX desafios_auth_movil_token_hash_key ON desafios_auth_movil("tokenHash");
CREATE INDEX desafios_auth_movil_vehiculo_expira_idx ON desafios_auth_movil("vehiculoId", "expiresAt");
CREATE INDEX desafios_auth_movil_sindicato_idx ON desafios_auth_movil("sindicatoId");
CREATE UNIQUE INDEX sesiones_operativas_access_hash_key ON sesiones_operativas("accessTokenHash");
CREATE UNIQUE INDEX sesiones_operativas_refresh_hash_key ON sesiones_operativas("refreshTokenHash");
CREATE INDEX sesiones_operativas_sindicato_idx ON sesiones_operativas("sindicatoId");
CREATE INDEX sesiones_operativas_asignacion_estado_idx ON sesiones_operativas("asignacionId", estado);
CREATE INDEX sesiones_operativas_device_estado_idx ON sesiones_operativas("deviceId", estado);

ALTER TABLE desafios_auth_movil
  ADD CONSTRAINT desafios_auth_movil_sindicato_fkey FOREIGN KEY ("sindicatoId") REFERENCES sindicatos(id) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT desafios_auth_movil_vehiculo_fkey FOREIGN KEY ("vehiculoId") REFERENCES vehiculos(id) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT desafios_auth_movil_conductor_fkey FOREIGN KEY ("conductorId") REFERENCES conductores(id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE sesiones_operativas
  ADD CONSTRAINT sesiones_operativas_sindicato_fkey FOREIGN KEY ("sindicatoId") REFERENCES sindicatos(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT sesiones_operativas_asignacion_fkey FOREIGN KEY ("asignacionId") REFERENCES asignaciones(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT sesiones_operativas_vehiculo_fkey FOREIGN KEY ("vehiculoId") REFERENCES vehiculos(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT sesiones_operativas_conductor_fkey FOREIGN KEY ("conductorId") REFERENCES conductores(id) ON DELETE RESTRICT ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON desafios_auth_movil, sesiones_operativas TO quivo_app;

ALTER TABLE desafios_auth_movil ENABLE ROW LEVEL SECURITY;
ALTER TABLE desafios_auth_movil FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON desafios_auth_movil
  USING (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  )
  WITH CHECK (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  );

ALTER TABLE sesiones_operativas ENABLE ROW LEVEL SECURITY;
ALTER TABLE sesiones_operativas FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sesiones_operativas
  USING (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  )
  WITH CHECK (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  );

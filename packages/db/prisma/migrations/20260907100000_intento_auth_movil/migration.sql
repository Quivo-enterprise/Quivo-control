-- M4: login móvil de un paso (placa + PIN del conductor). Lockout progresivo por
-- vehiculoId, no por IP — los choferes salen por CGNAT compartido de Entel/Tigo, así que
-- un límite por IP castiga a legítimos sin frenar a un atacante (ver auth-movil.service.ts).

CREATE TABLE intentos_auth_movil (
  id TEXT NOT NULL,
  "sindicatoId" TEXT NOT NULL,
  "vehiculoId" TEXT NOT NULL,
  fallos INTEGER NOT NULL DEFAULT 0,
  "bloqueadoHasta" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT intentos_auth_movil_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX intentos_auth_movil_vehiculo_key ON intentos_auth_movil("vehiculoId");
CREATE INDEX intentos_auth_movil_sindicato_idx ON intentos_auth_movil("sindicatoId");

ALTER TABLE intentos_auth_movil
  ADD CONSTRAINT intentos_auth_movil_sindicato_fkey FOREIGN KEY ("sindicatoId") REFERENCES sindicatos(id) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT intentos_auth_movil_vehiculo_fkey FOREIGN KEY ("vehiculoId") REFERENCES vehiculos(id) ON DELETE CASCADE ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON intentos_auth_movil TO quivo_app;

ALTER TABLE intentos_auth_movil ENABLE ROW LEVEL SECURITY;
ALTER TABLE intentos_auth_movil FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON intentos_auth_movil
  USING (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  )
  WITH CHECK (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  );

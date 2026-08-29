-- Identidad de experiencia para QUIVO Rutas.
-- Better Auth conserva la identidad principal en "user"; este perfil no otorga permisos
-- sobre tablas operativas y se elimina junto con la cuenta.
CREATE TABLE "passenger_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'es-BO',
    "timezone" TEXT NOT NULL DEFAULT 'America/La_Paz',
    "termsVersion" TEXT NOT NULL,
    "termsAcceptedAt" TIMESTAMP(3) NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'activo',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "passenger_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "passenger_profiles_userId_key" ON "passenger_profiles"("userId");
CREATE INDEX "passenger_profiles_estado_updatedAt_idx" ON "passenger_profiles"("estado", "updatedAt");

ALTER TABLE "passenger_profiles"
  ADD CONSTRAINT "passenger_profiles_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "passenger_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "passenger_profiles" FORCE ROW LEVEL SECURITY;
CREATE POLICY passenger_profile_owner ON "passenger_profiles"
  USING (
    current_setting('app.rol', true) IN ('admin_quivo', 'admin_sindicato')
    OR "userId" = current_setting('app.user_id', true)
  )
  WITH CHECK (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "userId" = current_setting('app.user_id', true)
  );

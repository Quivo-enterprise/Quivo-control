-- QUI-218: RLS multi-tenant (doc técnico §4.1, riesgo #2 del proyecto — un sindicato jamás
-- ve datos de otro, aunque una query de la app olvide el filtro).
--
-- Gotcha crítico de Postgres: los superusers (y cualquier rol con BYPASSRLS) IGNORAN las
-- políticas RLS sin importar `FORCE ROW LEVEL SECURITY` — está documentado así a propósito.
-- El rol de esta migración (el de DATABASE_URL, dueño de las tablas) sigue siendo superuser
-- en dev/CI por simplicidad de las migraciones. Por eso creamos un rol de RUNTIME separado,
-- sin superusuario ni bypass, que es el que de verdad usa `apps/api` en producción/dev/CI
-- (ver `RUNTIME_DATABASE_URL` en packages/db/src/client.ts) — sin este rol separado, activar
-- RLS acá sería un no-op silencioso.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'quivo_app') THEN
    CREATE ROLE quivo_app LOGIN PASSWORD 'quivo_app_dev' NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO quivo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO quivo_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO quivo_app;

-- Contexto por request: la API fija `app.rol` / `app.sindicato_id` con
-- `SELECT set_config('app.x', $1, true)` (el `true` = SET LOCAL, se descarta solo al
-- terminar la transacción — nunca queda pegado a una conexión reusada del pool) dentro de
-- una transacción por request (ver packages/db/src/tenant-context.ts). Las políticas de
-- abajo leen esos dos valores con `current_setting(..., true)` (el segundo `true` = no
-- lanzar error si nunca se seteó, devuelve NULL).
--
-- Bypass de `admin_quivo` (doc técnico §5, QUI-218 AC): explícito vía `app.rol`, no vía rol
-- de Postgres — así queda auditado igual que cualquier otra acción (ver audit_log más abajo
-- y QUI-220), y no depende de qué usuario de DB esté conectado.
--
-- Alcance deliberado — NO llevan RLS en esta migración:
--   * Tablas de Better-Auth (user/session/account/verification/jwks): el login necesita
--     poder leer la tabla `user` por email ANTES de conocer su sindicato_id (chicken-and-egg).
--     Meterle RLS complica el flujo de auth ya verificado end-to-end sin ganancia real de
--     aislamiento (una fila de `user` filtrada entre tenants no es el riesgo #2 del doc
--     técnico — ese riesgo es sobre datos operativos: socios/vehículos/conductores/etc).
--   * rutas/variantes/paradas/puntos_control: no tienen columna `sindicato_id` propia (la
--     heredan transitivamente vía `lineaId` → `linea.sindicatoId`). Ninguna todavía tiene
--     API (llega con QUI-225/226) — aislarlas correctamente necesita una política con
--     subquery contra `lineas`, que se agrega junto con esas issues, no especulativamente acá.

ALTER TABLE sindicatos ENABLE ROW LEVEL SECURITY;
ALTER TABLE sindicatos FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sindicatos
  USING (
    current_setting('app.rol', true) = 'admin_quivo'
    OR id::text = current_setting('app.sindicato_id', true)
  )
  WITH CHECK (current_setting('app.rol', true) = 'admin_quivo');

ALTER TABLE socios ENABLE ROW LEVEL SECURITY;
ALTER TABLE socios FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON socios
  USING (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  )
  WITH CHECK (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  );

ALTER TABLE vehiculos ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehiculos FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vehiculos
  USING (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  )
  WITH CHECK (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  );

ALTER TABLE conductores ENABLE ROW LEVEL SECURITY;
ALTER TABLE conductores FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON conductores
  USING (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  )
  WITH CHECK (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  );

ALTER TABLE lineas ENABLE ROW LEVEL SECURITY;
ALTER TABLE lineas FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lineas
  USING (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  )
  WITH CHECK (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  );

-- `sindicatoId` nullable: acciones de `admin_quivo` sin tenant propio también se auditan.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_log
  USING (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  )
  WITH CHECK (
    current_setting('app.rol', true) = 'admin_quivo'
    OR "sindicatoId"::text = current_setting('app.sindicato_id', true)
  );

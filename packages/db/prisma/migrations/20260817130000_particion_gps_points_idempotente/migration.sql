-- Fix de crash en producción, día 1 del piloto (2026-08-17): el worker de ingesta quedó en
-- crash loop al arrancar en Cloud Run (worker pool `quivo-worker`) con
--   PrismaClientKnownRequestError: Code 42P07 — relation "gps_points_20260823" already exists
--     at IngestaWorkerService.asegurarParticionesFuturas (ingesta-worker.service.js:81)
--     at IngestaWorkerService.onModuleInit (ingesta-worker.service.js:71)
-- Con el worker en crash loop, `POST /v1/sync/batches` sigue encolando en BullMQ pero nadie
-- consume la cola: `gps_points` queda vacía.
--
-- Causa: `crear_particion_gps_points(dia date)` (creada en
-- `20260802160000_ingesta_gps_worker`, redefinida en `20260815120000_gps_points_sindicato_rls`
-- para agregar RLS a cada partición nueva) usa el patrón check-then-act
-- `IF NOT EXISTS (SELECT FROM pg_class ...) THEN CREATE TABLE ... END IF`, que no es seguro
-- ante concurrencia real: dos transacciones que corren el chequeo casi a la vez pueden ver
-- ambas "no existe" y ambas intentar el `CREATE TABLE`; la que pierde la carrera recibe
-- `42P07 duplicate_table`. Hay concurrencia real acá: `IngestaWorkerService.onModuleInit`
-- (`ingesta-worker.service.ts`) llama `asegurarParticionesFuturas()` directo Y ADEMÁS hace
-- `particionesQueue.upsertJobScheduler(...)`, que en BullMQ produce un job inmediato que corre
-- la misma función vía `particionesWorker` — sumale reinicios solapados de instancias de Cloud
-- Run. Agravante ya resuelto por separado en `ingesta-worker.service.ts`
-- (`asegurarParticionesFuturas`): antes corría las 6 creaciones dentro de una sola transacción,
-- así que un solo 42P07 abortaba el lote entero y tumbaba el proceso.
--
-- Este fix vuelve la función race-safe: se conserva el fast-path `IF NOT EXISTS` (evita pagar
-- el costo de un bloque con EXCEPTION — un savepoint implícito — en el caso común de un día que
-- ya tiene partición), pero la creación en sí queda envuelta en `BEGIN ... EXCEPTION ... END`
-- que traga `duplicate_table` (el `CREATE TABLE` perdió la carrera: la partición ya existe,
-- que es exactamente el estado deseado) y `duplicate_object` (el `CREATE POLICY` perdió la
-- carrera: la tabla y su policy ya existen). En ningún caso hace falta reintentar ni propagar
-- el error — el resultado que la función promete (la partición existe, con su RLS y su policy)
-- ya se dio por la otra transacción.
--
-- El cuerpo funcional es el MISMO que la versión vigente (`20260815120000`): crea la partición
-- y le pone `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY` y la policy
-- `tenant_isolation` — ver el comentario de esa migración para el porqué (RLS + particionado
-- NO se hereda del padre para accesos directos a la partición por nombre, ese es el aislamiento
-- multi-tenant real).
--
-- OJO: `SECURITY DEFINER` se repite explícito acá a propósito, igual que en `20260815120000` —
-- Postgres NO conserva esa propiedad de la definición anterior en un `CREATE OR REPLACE` (a
-- diferencia de `ALTER FUNCTION`, que sí es incremental); omitirla acá volvería la función a
-- `SECURITY INVOKER` en silencio y el worker (corriendo como `quivo_app`, sin permisos DDL en
-- el schema) fallaría con "permission denied for schema public" — ver
-- `20260802161000_particion_gps_security_definer`.
CREATE OR REPLACE FUNCTION crear_particion_gps_points(dia date)
RETURNS void AS $$
DECLARE
  nombre_particion text := 'gps_points_' || to_char(dia, 'YYYYMMDD');
  inicio timestamptz := dia::timestamptz;
  fin timestamptz := (dia + interval '1 day')::timestamptz;
BEGIN
  IF NOT EXISTS (SELECT FROM pg_class WHERE relname = nombre_particion) THEN
    BEGIN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF gps_points FOR VALUES FROM (%L) TO (%L)',
        nombre_particion, inicio, fin
      );
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', nombre_particion);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', nombre_particion);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING (current_setting(''app.rol'', true) = ''admin_quivo'' OR "sindicatoId"::text = current_setting(''app.sindicato_id'', true)) WITH CHECK (current_setting(''app.rol'', true) = ''admin_quivo'' OR "sindicatoId"::text = current_setting(''app.sindicato_id'', true))',
        nombre_particion
      );
    EXCEPTION
      WHEN duplicate_table THEN
        -- Otra transacción concurrente ganó la carrera del CREATE TABLE (con su RLS y su
        -- policy, dentro del mismo bloque atómico) entre el chequeo de arriba y este punto.
        -- Es exactamente el estado deseado: no hacer nada.
        NULL;
      WHEN duplicate_object THEN
        -- La tabla quedó creada (por esta transacción o por otra concurrente que llegó hasta
        -- acá primero) pero la policy `tenant_isolation` ya existe. Mismo resultado deseado:
        -- no hacer nada.
        NULL;
    END;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- El GRANT original (`20260802161000_particion_gps_security_definer`) sigue vigente sobre esta
-- misma función (incluso reemplazada, conserva permisos y ownership), pero se repite explícito
-- acá — barato — para no depender de esa garantía implícita, mismo criterio que
-- `20260815120000_gps_points_sindicato_rls`.
GRANT EXECUTE ON FUNCTION crear_particion_gps_points(date) TO quivo_app;

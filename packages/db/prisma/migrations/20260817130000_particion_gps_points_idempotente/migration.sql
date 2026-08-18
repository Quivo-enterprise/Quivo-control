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
-- Este fix vuelve la función race-safe: se conserva el fast-path (evita pagar el costo de un
-- bloque con EXCEPTION — un savepoint implícito — en el caso común de un día que ya tiene
-- partición), pero la creación de la tabla en sí queda envuelta en `BEGIN ... EXCEPTION ...
-- END` que traga `duplicate_table` (el `CREATE TABLE` perdió la carrera: la partición ya
-- existe, que es exactamente el estado deseado) — no hace falta reintentar ni propagar el
-- error, el resultado que la función promete ya se dio por la otra transacción.
--
-- El cuerpo funcional crea la partición y le pone `ENABLE ROW LEVEL SECURITY`,
-- `FORCE ROW LEVEL SECURITY` y la policy `tenant_isolation` — ver el comentario de
-- `20260815120000_gps_points_sindicato_rls` para el porqué (RLS + particionado NO se hereda
-- del padre para accesos directos a la partición por nombre, ese es el aislamiento
-- multi-tenant real).
--
-- OJO: `SECURITY DEFINER` se repite explícito acá a propósito, igual que en `20260815120000` —
-- Postgres NO conserva esa propiedad de la definición anterior en un `CREATE OR REPLACE` (a
-- diferencia de `ALTER FUNCTION`, que sí es incremental); omitirla acá volvería la función a
-- `SECURITY INVOKER` en silencio y el worker (corriendo como `quivo_app`, sin permisos DDL en
-- el schema) fallaría con "permission denied for schema public" — ver
-- `20260802161000_particion_gps_security_definer`.

-- Revisión de seguridad de este PR (todavía no mergeado/aplicado a ningún ambiente compartido,
-- así que se corrige en el mismo archivo en vez de encadenar una migración nueva): la
-- reescritura de arriba resolvía la carrera de `42P07`, pero dejaba abiertos cuatro problemas
-- de seguridad/corrección adicionales:
--
-- 1) `SECURITY DEFINER` SIN `SET search_path` es una escalación real, no solo un descuido de
--    estilo: el `search_path` lo controla el INVOCADOR (`quivo_app`), no el dueño de la
--    función. Cualquier rol con la credencial `quivo_app` podía `SET search_path = malicioso,
--    public` antes de llamar a esta función, y los identificadores sin calificar que usaba
--    (`gps_points`, `%I` sin schema) resolverían contra objetos de ese schema en vez de
--    `public` — ejecución de código como el rol dueño de la función (que tiene DDL sobre
--    `public`), escalación real desde un rol `NOSUPERUSER`/sin `BYPASSRLS`. Mismo patrón que
--    ya blinda `finalizar_archivo_gps` (`20260802190000_gps_archives`): se agrega
--    `SET search_path = pg_catalog, public` y se califica CADA identificador con `public.`.
-- 2) Postgres otorga `EXECUTE` a `PUBLIC` por defecto en todo `CREATE FUNCTION` nuevo, y esta
--    función nunca lo revocó desde que nació (`20260802160000`) — el `GRANT ... TO quivo_app`
--    de abajo era decorativo: cualquier rol con `CONNECT` a la base podía invocarla igual,
--    detonando DDL sobre `public` como el rol dueño. Se agrega el `REVOKE` correspondiente,
--    ANTES del `GRANT`.
-- 3) El fast-path `IF NOT EXISTS (SELECT FROM pg_class WHERE relname = nombre_particion)` no
--    filtraba por schema ni `relkind`: CUALQUIER relación con ese nombre en CUALQUIER schema
--    (incluida una `CREATE TEMP TABLE`, que cualquier rol con `CONNECT` puede crear sin
--    necesitar `CREATE` sobre `public`) hacía que la función se saltee la creación real y
--    devuelva éxito — la evidencia GPS de ese día habría terminado entera en `sync_errors` sin
--    que nadie se entere. Se cambia a `to_regclass('public.' || quote_ident(...)) IS NULL`,
--    que solo resuelve contra el schema `public` explícito.
-- 4) `ENABLE`/`FORCE ROW LEVEL SECURITY` y el `CREATE POLICY` vivían DENTRO del
--    `IF NOT EXISTS (SELECT FROM pg_class ...)`: si la partición ya existía (creada por una
--    corrida previa, o a mano por un DBA), la función devolvía éxito SIN verificar que tuviera
--    RLS ni policy — el contrato que la función promete ("la partición existe, con su RLS y su
--    policy") dependía de que la llamada que la creó también se lo haya puesto, no de que ESTA
--    llamada lo garantice. Se mueven `ENABLE`/`FORCE ROW LEVEL SECURITY` fuera del `IF` (son
--    idempotentes por naturaleza — repetirlos no falla ni cuesta) y el `CREATE POLICY` queda
--    protegido por su propio `IF NOT EXISTS (SELECT FROM pg_policies ...)`, así que cada
--    llamada repara cualquier partición preexistente sin aislamiento en vez de confiar en que
--    otra transacción ya lo hizo.
--
--    Con este reordenamiento, el handler `WHEN duplicate_object` (pensado para atrapar una
--    carrera del `CREATE POLICY` dentro del mismo bloque que el `CREATE TABLE`) deja de tener
--    sentido donde estaba y se retira: el `CREATE POLICY` ya no vive dentro del bloque
--    protegido por el `EXCEPTION` del `CREATE TABLE`. Sigue siendo seguro porque el
--    `CREATE TABLE` continúa siendo el único punto de serialización real entre transacciones
--    concurrentes que compiten por crear la MISMA partición nueva: la transacción que pierde
--    esa carrera queda bloqueada en el `INSERT` catalográfico del `CREATE TABLE` hasta que la
--    ganadora hace COMMIT de su transacción COMPLETA (tabla + RLS + policy, todo en la misma
--    transacción, ver `IngestaWorkerService.asegurarParticionesFuturas`, una transacción por
--    día). Para cuando la perdedora se desbloquea, entra al handler `duplicate_table` y sigue
--    de largo; su propio `IF NOT EXISTS (SELECT FROM pg_policies ...)` ya ve la policy que la
--    ganadora comprometió, y no vuelve a intentar crearla. El único escenario donde SÍ podría
--    reaparecer una carrera de `CREATE POLICY` sin protección es reparar EN PARALELO una
--    partición preexistente a la que le falta policy (sin pasar por `CREATE TABLE`, que es el
--    punto de serialización) — caso manual, rarísimo, que el caller ya trata como best-effort
--    por día (loguea y sigue, no tumba el worker) y donde, de las dos llamadas que compitieran,
--    una de las dos siempre termina creando la policy con éxito: el estado final igual queda
--    correcto.
-- 5) `SET TimeZone = 'UTC'` (mismo bloque `SET` que `search_path`): los límites de partición
--    (`inicio`/`fin`, calculados como `dia::timestamptz` / `(dia + interval '1 day')::timestamptz`)
--    dependen del `TimeZone` de la SESIÓN que invoca la función, no de un valor fijo. Si dos
--    llamadas corrieran con `TimeZone` distinto (p. ej. conexiones distintas del pool con
--    default distinto), los límites de dos particiones consecutivas podrían no calzar
--    exactamente, dejando un hueco entre ellas (filas de ese instante no caen en ninguna
--    partición, van a `sync_errors`) o un solape (`42P17`, invalid_object_definition — un
--    código que el `EXCEPTION WHEN duplicate_table` de acá NO atrapa, porque no es el mismo
--    error). Fijar `TimeZone = 'UTC'` para esta función hace que los límites sean siempre los
--    mismos sin importar la sesión de quien la invoque.
CREATE OR REPLACE FUNCTION crear_particion_gps_points(dia date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET TimeZone = 'UTC'
AS $$
DECLARE
  nombre_particion text := 'gps_points_' || to_char(dia, 'YYYYMMDD');
  inicio timestamptz := dia::timestamptz;
  fin timestamptz := (dia + interval '1 day')::timestamptz;
BEGIN
  IF to_regclass('public.' || quote_ident(nombre_particion)) IS NULL THEN
    BEGIN
      EXECUTE format(
        'CREATE TABLE public.%I PARTITION OF public.gps_points FOR VALUES FROM (%L) TO (%L)',
        nombre_particion, inicio, fin
      );
    EXCEPTION
      WHEN duplicate_table THEN
        -- Otra transacción concurrente ganó la carrera del CREATE TABLE entre el chequeo de
        -- arriba y este punto. Es exactamente el estado deseado: no hacer nada acá — RLS y la
        -- policy de esta partición se resuelven más abajo, fuera de este bloque, sin importar
        -- quién haya terminado creando la tabla.
        NULL;
    END;
  END IF;

  -- RLS y policy SIEMPRE, fuera del IF de arriba: no dependen de si ESTA llamada creó la
  -- partición. Así la función repara idempotentemente cualquier partición preexistente sin
  -- aislamiento (creada a mano por un DBA, o por una versión vieja de esta función), además de
  -- garantizar el contrato en el camino normal.
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', nombre_particion);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', nombre_particion);

  IF NOT EXISTS (
    SELECT 1
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = nombre_particion
       AND policyname = 'tenant_isolation'
  ) THEN
    -- OJO: este USING/WITH CHECK tiene que quedar carácter por carácter igual al de
    -- `gps_points` (la tabla padre) en `20260815120000_gps_points_sindicato_rls` — es el
    -- aislamiento multi-tenant real para accesos directos a la partición por nombre (ver el
    -- comentario de esa migración sobre por qué RLS no se hereda del padre en ese caso).
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I USING (current_setting(''app.rol'', true) = ''admin_quivo'' OR "sindicatoId"::text = current_setting(''app.sindicato_id'', true)) WITH CHECK (current_setting(''app.rol'', true) = ''admin_quivo'' OR "sindicatoId"::text = current_setting(''app.sindicato_id'', true))',
      nombre_particion
    );
  END IF;
END;
$$;

-- La función nació (`20260802160000`) con el `EXECUTE TO PUBLIC` que Postgres otorga por
-- defecto a toda función nueva, y nunca se había revocado explícitamente: el `GRANT` de abajo
-- era decorativo, cualquier rol con `CONNECT` a la base podía invocarla igual (DDL sobre
-- `public` como el rol dueño, vía `SECURITY DEFINER`). Este `REVOKE` SÍ hace falta explícito,
-- a diferencia del `GRANT` que le sigue (que solo repite una garantía que ya existía).
REVOKE ALL ON FUNCTION crear_particion_gps_points(date) FROM PUBLIC;

-- El GRANT original (`20260802161000_particion_gps_security_definer`) sigue vigente sobre esta
-- misma función (incluso reemplazada, conserva permisos y ownership), pero se repite explícito
-- acá — barato — para no depender de esa garantía implícita, mismo criterio que
-- `20260815120000_gps_points_sindicato_rls`.
GRANT EXECUTE ON FUNCTION crear_particion_gps_points(date) TO quivo_app;

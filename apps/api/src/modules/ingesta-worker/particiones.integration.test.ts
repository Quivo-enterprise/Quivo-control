import { prisma, withTenantContext } from '@quivo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CONTEXTO_ADMIN = { rol: 'admin_quivo', sindicatoId: null } as const;

/** Fila cruda de la guardia de conexión — ver `beforeAll` más abajo. */
interface ConexionRol {
  current_user: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  tiene_create_en_public: boolean;
}

/**
 * Regresión del crash de producción del día 1 del piloto (2026-08-17): el worker de ingesta
 * murió en el boot con `PrismaClientKnownRequestError 42P07 — relation "gps_points_20260823"
 * already exists` dentro de `IngestaWorkerService.asegurarParticionesFuturas`. Causa:
 * `crear_particion_gps_points(dia date)` usaba el patrón check-then-act
 * `IF NOT EXISTS (SELECT FROM pg_class ...) THEN CREATE TABLE ... END IF`, no seguro ante
 * concurrencia real (`onModuleInit` llama `asegurarParticionesFuturas()` directo Y ADEMÁS
 * dispara un job inmediato de BullMQ que corre la misma función, más reinicios solapados de
 * instancias de Cloud Run). Este archivo prueba, contra el Postgres real, que la versión
 * race-safe (`20260817130000_particion_gps_points_idempotente`) no lanza ante ese escenario.
 *
 * Corre con `RUNTIME_DATABASE_URL` (rol `quivo_app`, sin BYPASSRLS ni CREATE sobre `public`) —
 * el mismo rol con el que corre el worker en producción. `crear_particion_gps_points` es
 * `SECURITY DEFINER` (`20260802161000_particion_gps_security_definer`, repetido explícito en
 * cada `CREATE OR REPLACE` desde entonces): sin ese flag, el `CREATE TABLE`/`CREATE POLICY` de
 * adentro fallarían con "permission denied for schema public" bajo `quivo_app`, que no tiene
 * DDL propio (sólo SELECT/INSERT/UPDATE/DELETE, ver `20260730152500_rls_multi_tenant`) — por
 * eso este test, además de probar la idempotencia, es también una guardia contra volver a
 * perder `SECURITY DEFINER` en un futuro `CREATE OR REPLACE` de esta función.
 *
 * No hace falta limpiar las particiones creadas (`quivo_app` no tiene DDL para dropearlas
 * directamente, y `finalizar_archivo_gps` exige un manifiesto de archivo verificado que no
 * aplica acá) — mismo criterio que `retencion-gps.service.integration.test.ts`, que tampoco
 * dropea la partición que crea. En CI la base es efímera por corrida; en local queda una
 * tabla vacía de más, sin costo real.
 */
describe('crear_particion_gps_points — idempotencia ante concurrencia (RLS real)', () => {
  beforeAll(async () => {
    // Guardia de conexión: lo que este archivo dice probar es que SIN `SECURITY DEFINER` el
    // `CREATE TABLE`/`CREATE POLICY` de adentro de la función fallarían bajo `quivo_app` — y
    // esa garantía la da NO TENER `CREATE` sobre `public`, no `rolbypassrls`. Chequear solo
    // `rolbypassrls` (como hacía una versión anterior de esta guardia) no alcanza: en Cloud
    // SQL — donde corre este piloto — el usuario administrador que Cloud SQL expone tiene
    // `rolsuper=false` y `rolbypassrls=false` pero DDL completo sobre `public` (no hay forma
    // de correr como superusuario real ahí). Con esa guardia vieja, una conexión con ese rol
    // pasaría el chequeo igual, y el test "pasaría" (el DDL de adentro funcionaría de todos
    // modos, `SECURITY DEFINER` o no) sin haber probado nada del hallazgo que documenta el
    // comentario de arriba. Se agrega el chequeo de
    // `has_schema_privilege(current_user, 'public', 'CREATE')`, que sí distingue ambos casos.
    // Mismo patrón que `packages/db/src/rls.integration.test.ts`.
    const [conexion] = await withTenantContext(CONTEXTO_ADMIN, (tx) =>
      tx.$queryRaw<ConexionRol[]>`
        SELECT
          current_user,
          (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS rolsuper,
          (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS rolbypassrls,
          has_schema_privilege(current_user, 'public', 'CREATE') AS tiene_create_en_public
      `,
    );

    if (!conexion) {
      throw new Error(
        'La guardia de conexión no devolvió ninguna fila — no se pudo verificar el rol.',
      );
    }

    const {
      current_user: currentUser,
      rolsuper: esSuperusuario,
      rolbypassrls: tieneBypassRls,
      tiene_create_en_public: tieneCreateEnPublic,
    } = conexion;

    if (esSuperusuario || tieneBypassRls || tieneCreateEnPublic) {
      throw new Error(
        `Esta suite corre conectada como "${currentUser}" (rolsuper=${String(esSuperusuario)}, ` +
          `rolbypassrls=${String(tieneBypassRls)}, CREATE sobre public=${String(tieneCreateEnPublic)}) ` +
          '— con cualquiera de esos tres en true, el DDL de crear_particion_gps_points ' +
          'funcionaría igual aunque SECURITY DEFINER se hubiera perdido, y este test "pasaría" ' +
          'sin haber probado nada. Conectá con RUNTIME_DATABASE_URL (rol quivo_app, sin ' +
          'BYPASSRLS y sin CREATE sobre public) antes de correr esta suite.',
      );
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // +400/+401/+402 días respecto de CURRENT_DATE (no +30/+31/+32 como en una versión anterior
  // de este archivo): crear una partición de gps_points expande el rango de `ts` que la tabla
  // ACEPTA en un INSERT real. Un dispositivo con el reloj adelantado justo ese tanto — el
  // escenario que `IngestaWorkerService.detectarDriftReloj` existe para alertar — hoy rebota a
  // `sync_errors` porque no hay partición que lo reciba; con particiones de prueba a solo +30
  // días, ese mismo evento se ingestaría en silencio, contaminando la evidencia GPS con datos
  // de un test. +400 días queda muy por fuera de cualquier horizonte operativo real
  // (`DIAS_ANTICIPACION_PARTICION = 5`) y de cualquier drift de reloj plausible de un
  // dispositivo — documentado acá para que quede claro que es intencional, no un typo.

  it('dos llamadas CONCURRENTES para el mismo día no lanzan (antes del fix: 42P07 duplicate_table)', async () => {
    const llamar = () =>
      withTenantContext(CONTEXTO_ADMIN, (tx) =>
        tx.$executeRaw`SELECT crear_particion_gps_points((CURRENT_DATE + 400)::date)`,
      );

    // Dos transacciones Prisma separadas, disparadas en paralelo con `Promise.all`: cada una
    // toma su propia conexión del pool y corre de verdad al mismo tiempo — no es una
    // simulación, es la misma condición de carrera que tumbó el worker en producción (dos
    // rutas de `IngestaWorkerService` llamando `asegurarParticionesFuturas()` casi a la vez).
    await expect(Promise.all([llamar(), llamar()])).resolves.toBeDefined();
  });

  it('llamar crear_particion_gps_points dos veces SEGUIDAS (secuencial) para el mismo día no lanza', async () => {
    const llamar = () =>
      withTenantContext(CONTEXTO_ADMIN, (tx) =>
        tx.$executeRaw`SELECT crear_particion_gps_points((CURRENT_DATE + 401)::date)`,
      );

    await expect(llamar()).resolves.toBeDefined();
    // La segunda llamada, ya con la partición existente, ejercita el fast-path
    // `to_regclass(...) IS NULL` (no debería siquiera entrar al bloque con EXCEPTION).
    await expect(llamar()).resolves.toBeDefined();
  });

  it('la partición resultante hereda de gps_points con FORCE RLS y una policy tenant_isolation idéntica a la del padre', async () => {
    await withTenantContext(CONTEXTO_ADMIN, (tx) =>
      tx.$executeRaw`SELECT crear_particion_gps_points((CURRENT_DATE + 402)::date)`,
    );

    const [fila] = await withTenantContext(CONTEXTO_ADMIN, (tx) =>
      tx.$queryRaw<
        {
          relname: string;
          relrowsecurity: boolean;
          relforcerowsecurity: boolean;
          policy_count: bigint;
          qual: string | null;
          with_check: string | null;
          padre_qual: string | null;
          padre_with_check: string | null;
        }[]
      >`
        SELECT
          child.relname,
          child.relrowsecurity,
          child.relforcerowsecurity,
          (
            SELECT count(*) FROM pg_policies p
             WHERE p.schemaname = 'public' AND p.tablename = child.relname AND p.policyname = 'tenant_isolation'
          ) AS policy_count,
          (
            SELECT qual FROM pg_policies p
             WHERE p.schemaname = 'public' AND p.tablename = child.relname AND p.policyname = 'tenant_isolation'
          ) AS qual,
          (
            SELECT with_check FROM pg_policies p
             WHERE p.schemaname = 'public' AND p.tablename = child.relname AND p.policyname = 'tenant_isolation'
          ) AS with_check,
          (
            SELECT qual FROM pg_policies p
             WHERE p.schemaname = 'public' AND p.tablename = 'gps_points' AND p.policyname = 'tenant_isolation'
          ) AS padre_qual,
          (
            SELECT with_check FROM pg_policies p
             WHERE p.schemaname = 'public' AND p.tablename = 'gps_points' AND p.policyname = 'tenant_isolation'
          ) AS padre_with_check
        FROM pg_inherits
        JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
        JOIN pg_class child ON child.oid = pg_inherits.inhrelid
        WHERE parent.relname = 'gps_points'
          AND child.relname = 'gps_points_' || to_char(CURRENT_DATE + 402, 'YYYYMMDD')
      `,
    );

    if (!fila) throw new Error('gps_points_...+402 no se encontró como partición de gps_points');
    expect(fila.relrowsecurity).toBe(true);
    expect(fila.relforcerowsecurity).toBe(true);
    expect(Number(fila.policy_count)).toBe(1);
    // Comparación por AUTO-REFERENCIA contra la policy del padre (`gps_points`), no contra un
    // string hardcodeado: una regresión que creara una policy llamada `tenant_isolation` con
    // `USING (true)` en la partición pasaría en verde si solo se verificara el nombre/conteo.
    // Comparar contra el padre evita además que este test se desactualice si el texto de la
    // policy cambia en una futura migración — alcanza con mantener partición y padre en sync
    // entre sí, que es justo lo que `crear_particion_gps_points` promete.
    expect(fila.qual).toBe(fila.padre_qual);
    expect(fila.with_check).toBe(fila.padre_with_check);
  });
});

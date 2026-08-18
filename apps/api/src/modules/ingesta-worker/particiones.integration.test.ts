import { prisma, withTenantContext } from '@quivo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CONTEXTO_ADMIN = { rol: 'admin_quivo', sindicatoId: null } as const;

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
 * Corre con `RUNTIME_DATABASE_URL` (rol `quivo_app`, sin BYPASSRLS) — el mismo rol con el que
 * corre el worker en producción. `crear_particion_gps_points` es `SECURITY DEFINER`
 * (`20260802161000_particion_gps_security_definer`, repetido explícito en cada
 * `CREATE OR REPLACE` desde entonces): sin ese flag, el `CREATE TABLE`/`CREATE POLICY` de
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
    // Guardia de conexión: si esto corriera con un rol BYPASSRLS (p. ej. `DATABASE_URL` de
    // migraciones por una `RUNTIME_DATABASE_URL` faltante), el `CREATE TABLE`/`CREATE POLICY`
    // de adentro de la función pasarían igual aunque `SECURITY DEFINER` se hubiera perdido —
    // el test "pasaría" sin haber probado nada del hallazgo que documenta el comentario de
    // arriba. Mismo patrón que `rls.integration.test.ts` y
    // `retencion-gps.service.integration.test.ts`.
    const [conexion] = await withTenantContext(CONTEXTO_ADMIN, (tx) =>
      tx.$queryRaw<{ rolbypassrls: boolean }[]>`
        SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user
      `,
    );
    if (conexion?.rolbypassrls) {
      throw new Error(
        'Este test corre con un rol BYPASSRLS — no prueba el permiso real de quivo_app dentro ' +
          'de crear_particion_gps_points (SECURITY DEFINER). Conectá con RUNTIME_DATABASE_URL ' +
          '(rol quivo_app).',
      );
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('dos llamadas CONCURRENTES para el mismo día no lanzan (antes del fix: 42P07 duplicate_table)', async () => {
    // +30 días respecto de CURRENT_DATE: fuera de la ventana que el bootstrap de
    // `20260802160000_ingesta_gps_worker` (CURRENT_DATE-1..+6) y el propio worker en régimen
    // normal (`DIAS_ANTICIPACION_PARTICION = 5`) ya crearon, así que la partición no existe
    // todavía cuando arranca este test — condición necesaria para ejercitar la carrera real.
    const llamar = () =>
      withTenantContext(CONTEXTO_ADMIN, (tx) =>
        tx.$executeRaw`SELECT crear_particion_gps_points((CURRENT_DATE + 30)::date)`,
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
        tx.$executeRaw`SELECT crear_particion_gps_points((CURRENT_DATE + 31)::date)`,
      );

    await expect(llamar()).resolves.toBeDefined();
    // La segunda llamada, ya con la partición existente, ejercita el fast-path
    // `IF NOT EXISTS` (no debería siquiera entrar al bloque con EXCEPTION).
    await expect(llamar()).resolves.toBeDefined();
  });

  it('la partición resultante hereda de gps_points con FORCE RLS y exactamente una policy tenant_isolation', async () => {
    await withTenantContext(CONTEXTO_ADMIN, (tx) =>
      tx.$executeRaw`SELECT crear_particion_gps_points((CURRENT_DATE + 32)::date)`,
    );

    const [fila] = await withTenantContext(CONTEXTO_ADMIN, (tx) =>
      tx.$queryRaw<
        { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean; policy_count: bigint }[]
      >`
        SELECT
          child.relname,
          child.relrowsecurity,
          child.relforcerowsecurity,
          (
            SELECT count(*) FROM pg_policies p
             WHERE p.schemaname = 'public' AND p.tablename = child.relname AND p.policyname = 'tenant_isolation'
          ) AS policy_count
        FROM pg_inherits
        JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
        JOIN pg_class child ON child.oid = pg_inherits.inhrelid
        WHERE parent.relname = 'gps_points'
          AND child.relname = 'gps_points_' || to_char(CURRENT_DATE + 32, 'YYYYMMDD')
      `,
    );

    if (!fila) throw new Error('gps_points_...+32 no se encontró como partición de gps_points');
    expect(fila.relrowsecurity).toBe(true);
    expect(fila.relforcerowsecurity).toBe(true);
    expect(Number(fila.policy_count)).toBe(1);
  });
});

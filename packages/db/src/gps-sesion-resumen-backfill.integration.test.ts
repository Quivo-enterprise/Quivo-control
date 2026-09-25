import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from './client.js';
import { withTenantContext } from './tenant-context.js';

/**
 * code-review HIGH (docs/plan-en-vivo-resumen-sesion.md) — el backfill de la migración
 * `packages/db/prisma/migrations/20260922100000_gps_sesion_resumen/migration.sql` lee
 * `gps_points`, que tiene `FORCE ROW LEVEL SECURITY`
 * (`20260829180000_reconciliar_gps_points_sindicato_rls`). El rol que corre
 * `prisma migrate deploy` en Cloud SQL (`postgres`, dueño de las tablas) **NO** tiene
 * BYPASSRLS — confirmado en producción (`docs/handoff.md`, "database-url NO es un rol
 * BYPASSRLS": `pg_roles.rolbypassrls = false` tanto para `postgres` como para `quivo_app`).
 * Sin `SELECT set_config('app.rol', 'admin_quivo', false)` antes del `SELECT` del backfill,
 * la policy `tenant_isolation` esconde TODAS las filas de `gps_points` — sin ningún error —
 * y el backfill copia CERO filas a `gps_sesion_resumen`.
 *
 * Esta suite reproduce esa condición usando la MISMA conexión que el resto del paquete
 * (`prisma`, rol `quivo_app`, confirmado SIN BYPASSRLS por la guardia de `beforeAll`, mismo
 * patrón que `rls.integration.test.ts`) en vez de un `SET ROLE` explícito dentro de la
 * transacción: como `quivo_app` tampoco tiene BYPASSRLS, reproduce EXACTAMENTE el modo de
 * falla del rol de migraciones frente a `FORCE ROW LEVEL SECURITY` — la policy no distingue
 * "rol de migraciones" de "rol de aplicación", solo mira `current_setting('app.rol')` /
 * `current_setting('app.sindicato_id')`. Un `SET ROLE quivo_app` explícito no agrega nada
 * acá (la conexión YA es `quivo_app`) y además fallaría sin el permiso `quivo_app` GRANTed
 * al rol de conexión — de ahí que esta suite use la conexión tal cual, no `SET ROLE`.
 */
describe('gps_sesion_resumen — backfill contra gps_points con FORCE RLS (code-review HIGH)', () => {
  const sindicatoId = randomUUID();
  const sesionBackfillId = randomUUID();
  const eventId = randomUUID();
  const ts = new Date();

  beforeAll(async () => {
    // Guardia de conexión (mismo criterio que `rls.integration.test.ts`): si esto corriera
    // con un rol superusuario o BYPASSRLS, el primer `it()` de abajo "pasaría" por el motivo
    // equivocado — no habría RLS real bloqueando nada, así que no probaría el bug.
    const filasConexion = await prisma.$queryRaw<
      { current_user: string; rolsuper: boolean; rolbypassrls: boolean }[]
    >`
      SELECT
        current_user,
        (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS rolsuper,
        (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS rolbypassrls
    `;
    const conexion = filasConexion[0];
    if (!conexion || conexion.rolsuper || conexion.rolbypassrls) {
      throw new Error(
        `Esta suite necesita una conexión SIN BYPASSRLS para reproducir el modo de falla real ` +
          `del rol de migraciones en Cloud SQL (ver docs/handoff.md, "database-url NO es un rol ` +
          `BYPASSRLS"). Conectada como "${conexion?.current_user ?? 'desconocido'}" con ` +
          `rolbypassrls=${String(conexion?.rolbypassrls)} — seteá RUNTIME_DATABASE_URL al rol ` +
          '"quivo_app".',
      );
    }

    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({
        data: { id: sindicatoId, nombre: 'Backfill RLS Test', estado: 'activo' },
      });
      // Idempotente — ver comentario de uso en `en-vivo.service.test.ts`/
      // `en-vivo.resumen-equivalencia.test.ts`: asegura la partición de HOY sin importar
      // cuánto hace que se aplicó el bootstrap de la migración de `gps_points`.
      await tx.$executeRaw`SELECT crear_particion_gps_points(CURRENT_DATE)`;
      await tx.$executeRaw`
        INSERT INTO gps_points (event_id, sesion_id, device_id, ts, lat, lng, accuracy, speed, received_at, "sindicatoId")
        VALUES (${eventId}::uuid, ${sesionBackfillId}::uuid, 'device-backfill-rls', ${ts}::timestamptz, -17.78, -63.18, 5, 10, ${ts}::timestamptz, ${sindicatoId})
      `;
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.$executeRaw`DELETE FROM gps_sesion_resumen WHERE sesion_id = ${sesionBackfillId}::uuid`;
      await tx.$executeRaw`DELETE FROM gps_points WHERE event_id = ${eventId}::uuid`;
      await tx.sindicato.delete({ where: { id: sindicatoId } });
    });
    await prisma.$disconnect();
  });

  it('SIN el set_config admin_quivo, el SELECT de gps_points ve CERO filas — reproduce el bug del backfill', async () => {
    // Ni `withTenantContext` ni ningún `set_config` de por medio: exactamente el estado de
    // una conexión de migraciones recién abierta, antes del fix de la migración.
    const filas = await prisma.$transaction(
      (tx) =>
        tx.$queryRaw<{ sesion_id: string }[]>`
        SELECT sesion_id FROM gps_points WHERE event_id = ${eventId}::uuid
      `,
    );
    expect(filas).toHaveLength(0);
  });

  it('CON el set_config admin_quivo (el fix aplicado), el backfill SÍ copia la fila a gps_sesion_resumen', async () => {
    // Réplica exacta (mismas expresiones de jornada, mismo GROUP BY/DISTINCT ON/join por
    // `sindicatoId`, mismo ON CONFLICT) del bloque de backfill de
    // `packages/db/prisma/migrations/20260922100000_gps_sesion_resumen/migration.sql`,
    // acotada a la sesión de este test.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rol', 'admin_quivo', false)`;
      try {
        await tx.$executeRaw`
          WITH agregados AS (
            SELECT
              sesion_id,
              ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date AS jornada,
              "sindicatoId",
              count(*)::int AS total_puntos,
              max(ts) AS ultimo_fix_ts,
              max(received_at) AS ultimo_ingreso_ts
            FROM gps_points
            WHERE sesion_id = ${sesionBackfillId}::uuid
            GROUP BY sesion_id, ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date, "sindicatoId"
          ),
          ultimo_punto AS (
            SELECT DISTINCT ON (sesion_id, ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date, "sindicatoId")
              sesion_id,
              ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date AS jornada,
              "sindicatoId",
              lat, lng, accuracy, speed
            FROM gps_points
            WHERE sesion_id = ${sesionBackfillId}::uuid
            ORDER BY sesion_id, ((ts AT TIME ZONE 'UTC') - interval '4 hours')::date, "sindicatoId", ts DESC
          )
          INSERT INTO gps_sesion_resumen
            (sesion_id, jornada, "sindicatoId", total_puntos, ultimo_fix_ts, ultimo_ingreso_ts, lat, lng, accuracy, speed, updated_at)
          SELECT
            a.sesion_id, a.jornada, a."sindicatoId", a.total_puntos, a.ultimo_fix_ts, a.ultimo_ingreso_ts,
            u.lat, u.lng, u.accuracy, u.speed, now()
          FROM agregados a
          JOIN ultimo_punto u ON u.sesion_id = a.sesion_id AND u.jornada = a.jornada AND u."sindicatoId" = a."sindicatoId"
          ORDER BY a.sesion_id, a.jornada, a."sindicatoId"
          ON CONFLICT (sesion_id, jornada, "sindicatoId") DO NOTHING
        `;
      } finally {
        // Mismo criterio que la migración: no dejar el rol elevado pegado a la conexión más
        // tiempo del necesario.
        await tx.$executeRaw`SELECT set_config('app.rol', '', false)`;
      }
    });

    const filas = await withTenantContext(
      { rol: 'admin_quivo', sindicatoId: null },
      (tx) =>
        tx.$queryRaw<{ total_puntos: number; sindicatoId: string }[]>`
        SELECT total_puntos, "sindicatoId" FROM gps_sesion_resumen
        WHERE sesion_id = ${sesionBackfillId}::uuid
      `,
    );
    expect(filas.length).toBeGreaterThan(0);
    expect(filas[0]?.total_puntos).toBe(1);
    expect(filas[0]?.sindicatoId).toBe(sindicatoId);
  });
});

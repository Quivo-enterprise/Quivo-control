import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { ConfigService } from '@nestjs/config';
import { prisma, withTenantContext } from '@quivo/db';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RetencionGpsService } from './retencion-gps.service.js';

/**
 * `ArchiveFile` es un tipo privado del módulo (detalle de implementación de
 * `exportPartition`) — a propósito no se amplía la superficie pública del servicio solo
 * para testear. Este test únicamente necesita `rowCount`, así que el cast de abajo declara
 * la forma mínima que usa, en vez de importar el tipo real.
 */
interface ExportedArchive {
  rowCount: number;
}

/**
 * Hallazgo 1 (code-review piloto, previo al lunes): `exportPartition` corre con
 * `RUNTIME_DATABASE_URL` (rol `quivo_app`, NOSUPERUSER/NOBYPASSRLS) sobre una partición de
 * `gps_points` protegida por `FORCE ROW LEVEL SECURITY` (`tenant_isolation`, migración
 * `20260815120000_gps_points_sindicato_rls`). Antes del fix, `exportPartition` nunca fijaba
 * `app.rol`/`app.sindicato_id` en esa conexión — la policy ocultaba TODAS las filas y el
 * export devolvía 0, seguido de upload+verify "exitoso" y `finalizar_archivo_gps()`
 * (DETACH+DROP) sobre una partición con datos reales. Este test corre contra el Postgres
 * real (mismo patrón que `packages/db/src/rls.integration.test.ts`), crea una partición de
 * verdad con una fila de verdad, y llama al MISMO `pg.Client` crudo que usa producción — no
 * Prisma, no mocks — para probar que las filas vuelven en vez de 0.
 *
 * También cubre el hallazgo 2 en el mismo test: el CSV exportado debe incluir la columna
 * `sindicatoId` (agregada por la misma migración), sin la cual el archivo frío pierde la
 * atribución de tenant.
 */
describe('RetencionGpsService.exportPartition (RLS real)', () => {
  const sindicatoId = randomUUID();
  const partitionDate = '2020-01-01';
  const partitionName = 'gps_points_20200101';
  const eventId = randomUUID();
  const sesionId = randomUUID();
  let client: Client;
  let tempDir: string;

  beforeAll(async () => {
    const databaseUrl = process.env.RUNTIME_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('RUNTIME_DATABASE_URL o DATABASE_URL es requerido para este test');
    }
    client = new Client({ connectionString: databaseUrl });
    await client.connect();

    // Guardia de conexión: si esto corriera con el rol de migraciones (BYPASSRLS), el test
    // "pasaría" sin haber probado nada — mismo criterio que `rls.integration.test.ts`.
    const conexion = await client.query<{ rolbypassrls: boolean }>(
      `SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    if (conexion.rows[0]?.rolbypassrls) {
      throw new Error(
        'Este test corre con un rol BYPASSRLS — no prueba nada sobre el hallazgo 1. ' +
          'Conectá con RUNTIME_DATABASE_URL (rol quivo_app).',
      );
    }

    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({
        data: { id: sindicatoId, nombre: 'Retención GPS Test', estado: 'activo' },
      });
      await tx.$executeRaw`SELECT crear_particion_gps_points(${partitionDate}::date)`;
      await tx.$executeRaw`
        INSERT INTO gps_points (event_id, sesion_id, device_id, ts, lat, lng, accuracy, speed, received_at, "sindicatoId")
        VALUES (${eventId}::uuid, ${sesionId}::uuid, 'device-retencion-test', ${partitionDate}::timestamptz + interval '12 hours',
                -17.78, -63.18, 5, 10, now(), ${sindicatoId})
      `;
    });

    tempDir = await mkdtemp(join(tmpdir(), 'quivo-gps-archive-test-'));
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      // Igual que `rls.integration.test.ts`: el punto GPS primero — `gps_points."sindicatoId"`
      // tiene FK `ON DELETE RESTRICT` a `sindicatos`, así que borrar el sindicato con esta fila
      // todavía apuntándole rompería el cleanup.
      await tx.$executeRaw`DELETE FROM gps_points WHERE event_id = ${eventId}::uuid`;
      await tx.sindicato.delete({ where: { id: sindicatoId } });
    });
    await prisma.$disconnect();
    await client.end();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('devuelve las filas reales de la partición (antes del fix: siempre 0 por RLS) e incluye sindicatoId en el CSV', async () => {
    const config = new ConfigService({});
    const service = new RetencionGpsService(config);
    // `exportPartition` es privado a propósito (detalle de implementación del worker) — se
    // invoca vía cast para probarlo contra el `pg.Client` real sin reestructurar la clase
    // solo para exponer el método. La firma real no cambia.
    const exportPartition = (
      service as unknown as {
        exportPartition: (c: Client, partitionIdentifier: string, filePath: string) => Promise<ExportedArchive>;
      }
    ).exportPartition.bind(service);

    const filePath = join(tempDir, `${partitionName}.csv.gz`);

    // Mismo patrón que `archivePartition`: el `set_config` con `is_local=true` que hace el
    // fix solo sobrevive dentro de una transacción explícita — replicamos ese `BEGIN` acá
    // porque es exactamente cómo se invoca en producción (ver `archivePartition`).
    await client.query('BEGIN');
    try {
      const archive = await exportPartition(client, `"${partitionName}"`, filePath);

      expect(archive.rowCount).toBe(1);

      const csv = gunzipSync(await readFile(filePath)).toString('utf8');
      const [header, dataLine] = csv.trim().split('\n');
      expect(header).toBe('event_id,sesion_id,device_id,ts,lat,lng,accuracy,speed,received_at,sindicatoId');
      expect(dataLine).toContain(eventId);
      expect(dataLine).toContain(sindicatoId);
    } finally {
      await client.query('ROLLBACK');
    }
  });
});

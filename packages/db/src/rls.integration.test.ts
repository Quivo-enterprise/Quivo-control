import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from './client.js';
import { withTenantContext } from './tenant-context.js';

/**
 * Test cross-tenant de RLS (QUI-218, doc técnico §12 riesgo #2): un sindicato jamás debe
 * poder leer ni escribir filas de otro, sin importar si la query de la app "olvida" el
 * filtro por `sindicatoId` — la barrera real vive en Postgres, no en el código de arriba.
 * Corre contra el Postgres real (services de CI / docker-compose local, ver
 * `RUNTIME_DATABASE_URL` en apps/api/.env) con el rol `quivo_app` sin BYPASSRLS, creado
 * por la migración `20260730152500_rls_multi_tenant`.
 */
describe('RLS multi-tenant', () => {
  const sindicatoAId = randomUUID();
  const sindicatoBId = randomUUID();

  beforeAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({ data: { id: sindicatoAId, nombre: 'RLS Test A', estado: 'activo' } });
      await tx.sindicato.create({ data: { id: sindicatoBId, nombre: 'RLS Test B', estado: 'activo' } });

      await tx.socio.create({
        data: { sindicatoId: sindicatoAId, nombre: 'Socio A', documentoIdentidad: 'DOC-A', estado: 'activo' },
      });
      await tx.socio.create({
        data: { sindicatoId: sindicatoBId, nombre: 'Socio B', documentoIdentidad: 'DOC-B', estado: 'activo' },
      });

      await tx.vehiculo.create({
        data: {
          sindicatoId: sindicatoAId,
          placa: 'RLSA01',
          tipo: 'bus',
          marca: 'x',
          modelo: 'x',
          color: 'x',
          capacidad: 10,
          estado: 'activo',
        },
      });
      await tx.vehiculo.create({
        data: {
          sindicatoId: sindicatoBId,
          placa: 'RLSB01',
          tipo: 'bus',
          marca: 'x',
          modelo: 'x',
          color: 'x',
          capacidad: 10,
          estado: 'activo',
        },
      });

      await tx.conductor.create({
        data: {
          sindicatoId: sindicatoAId,
          nombre: 'Conductor A',
          documentoIdentidad: 'CD-A',
          licenciaConducir: 'LIC-A',
          estado: 'activo',
        },
      });
      await tx.conductor.create({
        data: {
          sindicatoId: sindicatoBId,
          nombre: 'Conductor B',
          documentoIdentidad: 'CD-B',
          licenciaConducir: 'LIC-B',
          estado: 'activo',
        },
      });

      await tx.linea.create({ data: { sindicatoId: sindicatoAId, codigo: 'RLSL1', nombre: 'Línea A' } });
      await tx.linea.create({ data: { sindicatoId: sindicatoBId, codigo: 'RLSL1', nombre: 'Línea B' } });
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      const sindicatoIds = { in: [sindicatoAId, sindicatoBId] };
      await tx.linea.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.conductor.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.vehiculo.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.socio.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.sindicato.deleteMany({ where: { id: sindicatoIds } });
    });
    await prisma.$disconnect();
  });

  it('sindicato A no ve el registro de sindicato B en sindicatos', async () => {
    const row = await withTenantContext({ rol: 'admin_sindicato', sindicatoId: sindicatoAId }, (tx) =>
      tx.sindicato.findUnique({ where: { id: sindicatoBId } }),
    );
    expect(row).toBeNull();
  });

  it('sindicato A no ve socios de sindicato B', async () => {
    const rows = await withTenantContext({ rol: 'admin_sindicato', sindicatoId: sindicatoAId }, (tx) =>
      tx.socio.findMany({ where: { sindicatoId: sindicatoBId } }),
    );
    expect(rows).toHaveLength(0);
  });

  it('sindicato A no ve vehículos de sindicato B', async () => {
    const rows = await withTenantContext({ rol: 'admin_sindicato', sindicatoId: sindicatoAId }, (tx) =>
      tx.vehiculo.findMany({ where: { sindicatoId: sindicatoBId } }),
    );
    expect(rows).toHaveLength(0);
  });

  it('sindicato A no ve conductores de sindicato B', async () => {
    const rows = await withTenantContext({ rol: 'admin_sindicato', sindicatoId: sindicatoAId }, (tx) =>
      tx.conductor.findMany({ where: { sindicatoId: sindicatoBId } }),
    );
    expect(rows).toHaveLength(0);
  });

  it('sindicato A no ve líneas de sindicato B', async () => {
    const rows = await withTenantContext({ rol: 'admin_sindicato', sindicatoId: sindicatoAId }, (tx) =>
      tx.linea.findMany({ where: { sindicatoId: sindicatoBId } }),
    );
    expect(rows).toHaveLength(0);
  });

  it('sindicato A no puede modificar (UPDATE) líneas de sindicato B', async () => {
    const result = await withTenantContext({ rol: 'admin_sindicato', sindicatoId: sindicatoAId }, (tx) =>
      tx.linea.updateMany({ where: { sindicatoId: sindicatoBId }, data: { nombre: 'hackeado' } }),
    );
    expect(result.count).toBe(0);
  });

  it('sindicato A no puede crear (INSERT) filas a nombre de sindicato B', async () => {
    await expect(
      withTenantContext({ rol: 'admin_sindicato', sindicatoId: sindicatoAId }, (tx) =>
        tx.linea.create({ data: { sindicatoId: sindicatoBId, codigo: 'HACK', nombre: 'hack' } }),
      ),
    ).rejects.toThrow();
  });

  it('admin_quivo ve filas de ambos sindicatos (bypass explícito)', async () => {
    const rows = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.sindicato.findMany({ where: { id: { in: [sindicatoAId, sindicatoBId] } } }),
    );
    expect(rows).toHaveLength(2);
  });

  it('sindicato A sí ve sus propias filas', async () => {
    const rows = await withTenantContext({ rol: 'admin_sindicato', sindicatoId: sindicatoAId }, (tx) =>
      tx.socio.findMany({ where: { sindicatoId: sindicatoAId } }),
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});

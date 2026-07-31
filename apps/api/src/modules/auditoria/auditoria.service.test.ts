import { randomUUID } from 'node:crypto';
import { prisma, withTenantContext } from '@quivo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditoriaService } from './auditoria.service.js';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

describe('AuditoriaService', () => {
  const service = new AuditoriaService();
  const sindicatoAId = randomUUID();
  const sindicatoBId = randomUUID();
  const adminQuivo: AuthenticatedUser = { userId: 'test-admin-quivo', rol: 'admin_quivo', sindicatoId: null };
  const adminSindicatoA: AuthenticatedUser = {
    userId: 'test-admin-a',
    rol: 'admin_sindicato',
    sindicatoId: sindicatoAId,
  };

  beforeAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({ data: { id: sindicatoAId, nombre: 'Auditoria Test A', estado: 'activo' } });
      await tx.sindicato.create({ data: { id: sindicatoBId, nombre: 'Auditoria Test B', estado: 'activo' } });
      await tx.auditLog.create({
        data: {
          sindicatoId: sindicatoAId,
          usuarioId: 'u-1',
          entidad: 'socio',
          entidadId: randomUUID(),
          accion: 'crear',
          diff: { nombre: 'Test A' },
        },
      });
      await tx.auditLog.create({
        data: {
          sindicatoId: sindicatoBId,
          usuarioId: 'u-2',
          entidad: 'vehiculo',
          entidadId: randomUUID(),
          accion: 'editar',
          diff: { estado: 'inactivo' },
        },
      });
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      const sindicatoIds = { in: [sindicatoAId, sindicatoBId] };
      await tx.auditLog.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.sindicato.deleteMany({ where: { id: sindicatoIds } });
    });
    await prisma.$disconnect();
  });

  it('admin_quivo ve entradas de ambos sindicatos', async () => {
    const filas = await service.listar(adminQuivo, {});
    const sindicatosVistos = new Set(filas.map((f) => f.sindicatoId));
    expect(sindicatosVistos.has(sindicatoAId)).toBe(true);
    expect(sindicatosVistos.has(sindicatoBId)).toBe(true);
  });

  it('admin_sindicato solo ve entradas de su propio tenant (RLS)', async () => {
    const filas = await service.listar(adminSindicatoA, {});
    expect(filas.every((f) => f.sindicatoId === sindicatoAId)).toBe(true);
    expect(filas.length).toBeGreaterThan(0);
  });

  it('filtra por entidad', async () => {
    const filas = await service.listar(adminQuivo, { entidad: 'vehiculo' });
    expect(filas.every((f) => f.entidad === 'vehiculo')).toBe(true);
  });

  it('filtra por acción', async () => {
    const filas = await service.listar(adminQuivo, { accion: 'editar' });
    expect(filas.every((f) => f.accion === 'editar')).toBe(true);
  });

  it('filtra por usuario (QUI-248)', async () => {
    const filas = await service.listar(adminQuivo, { usuarioId: 'u-1' });
    expect(filas.length).toBeGreaterThan(0);
    expect(filas.every((f) => f.usuarioId === 'u-1')).toBe(true);
  });
});

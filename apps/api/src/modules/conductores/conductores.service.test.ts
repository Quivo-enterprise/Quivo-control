import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { prisma, withTenantContext } from '@quivo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConductoresService } from './conductores.service.js';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

describe('ConductoresService', () => {
  const service = new ConductoresService();
  const sindicatoAId = randomUUID();
  const sindicatoBId = randomUUID();
  const adminQuivo: AuthenticatedUser = { userId: 'test-admin-quivo', rol: 'admin_quivo', sindicatoId: null };
  const adminSindicatoA: AuthenticatedUser = {
    userId: 'test-admin-sindicato-a',
    rol: 'admin_sindicato',
    sindicatoId: sindicatoAId,
  };

  beforeAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({ data: { id: sindicatoAId, nombre: 'Conductores Test A', estado: 'activo' } });
      await tx.sindicato.create({ data: { id: sindicatoBId, nombre: 'Conductores Test B', estado: 'activo' } });
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      const sindicatoIds = { in: [sindicatoAId, sindicatoBId] };
      await tx.auditLog.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.conductor.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.sindicato.deleteMany({ where: { id: sindicatoIds } });
    });
    await prisma.$disconnect();
  });

  it('admin_sindicato queda forzado a su propio tenant y no ve conductores de otro', async () => {
    const conductor = await service.crear(adminSindicatoA, {
      sindicatoId: sindicatoBId,
      nombre: 'Forzado',
      documentoIdentidad: 'DOC-1',
      licenciaConducir: 'LIC-1',
      estado: 'activo',
    });
    expect(conductor.sindicatoId).toBe(sindicatoAId);

    const deB = await service.crear(adminQuivo, {
      sindicatoId: sindicatoBId,
      nombre: 'De B',
      documentoIdentidad: 'DOC-2',
      licenciaConducir: 'LIC-2',
      estado: 'activo',
    });
    await expect(service.obtener(adminSindicatoA, deB.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lista solo los conductores del propio tenant', async () => {
    const lista = await service.listar(adminSindicatoA);
    expect(lista.every((c) => c.sindicatoId === sindicatoAId)).toBe(true);
  });

  it('actualiza estado y audita el cambio', async () => {
    const conductor = await service.crear(adminSindicatoA, {
      sindicatoId: sindicatoAId,
      nombre: 'A editar',
      documentoIdentidad: 'DOC-3',
      licenciaConducir: 'LIC-3',
      estado: 'activo',
    });
    const actualizado = await service.actualizar(adminSindicatoA, conductor.id, { estado: 'inactivo' });
    expect(actualizado.estado).toBe('inactivo');
  });

  it('lanza NotFoundException al actualizar un id inexistente', async () => {
    await expect(
      service.actualizar(adminSindicatoA, randomUUID(), { estado: 'inactivo' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { prisma, withTenantContext } from '@quivo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReglasService } from './reglas.service.js';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

describe('ReglasService', () => {
  const service = new ReglasService();
  const sindicatoAId = randomUUID();
  const sindicatoBId = randomUUID();
  const adminSindicatoA: AuthenticatedUser = {
    userId: 'test-admin-sindicato-a',
    rol: 'admin_sindicato',
    sindicatoId: sindicatoAId,
  };

  const reglaBase = {
    nombre: 'Retraso injustificado',
    tipo: 'puntualidad',
    gravedad: 'leve' as const,
    aplicaA: 'conductor' as const,
    estado: 'activo' as const,
  };

  beforeAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({ data: { id: sindicatoAId, nombre: 'Reglas Test A', estado: 'activo' } });
      await tx.sindicato.create({ data: { id: sindicatoBId, nombre: 'Reglas Test B', estado: 'activo' } });
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      const sindicatoIds = { in: [sindicatoAId, sindicatoBId] };
      await tx.auditLog.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.regla.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.sindicato.deleteMany({ where: { id: sindicatoIds } });
    });
    await prisma.$disconnect();
  });

  it('admin_sindicato queda forzado a su propio tenant y no ve reglas de otro', async () => {
    const regla = await service.crear(adminSindicatoA, { ...reglaBase, sindicatoId: sindicatoBId });
    expect(regla.sindicatoId).toBe(sindicatoAId);

    const listadas = await service.listar(adminSindicatoA);
    expect(listadas.every((r) => r.sindicatoId === sindicatoAId)).toBe(true);
  });

  it('permite editar el estado a inactivo', async () => {
    const regla = await service.crear(adminSindicatoA, { ...reglaBase, sindicatoId: sindicatoAId, nombre: 'Otra' });
    const actualizada = await service.actualizar(adminSindicatoA, regla.id, { estado: 'inactivo' });
    expect(actualizada.estado).toBe('inactivo');
  });

  it('404 al obtener una regla inexistente', async () => {
    await expect(service.obtener(adminSindicatoA, randomUUID())).rejects.toBeInstanceOf(NotFoundException);
  });
});

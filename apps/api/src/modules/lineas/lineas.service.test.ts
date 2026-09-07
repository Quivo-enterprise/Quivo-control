import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { prisma, withTenantContext } from '@quivo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LineasService } from './lineas.service.js';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

describe('LineasService', () => {
  const service = new LineasService();
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
      await tx.sindicato.create({ data: { id: sindicatoAId, nombre: 'Lineas Test A', estado: 'activo' } });
      await tx.sindicato.create({ data: { id: sindicatoBId, nombre: 'Lineas Test B', estado: 'activo' } });
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      const sindicatoIds = { in: [sindicatoAId, sindicatoBId] };
      await tx.auditLog.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.linea.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.sindicato.deleteMany({ where: { id: sindicatoIds } });
    });
    await prisma.$disconnect();
  });

  it('admin_sindicato queda forzado a su propio tenant y no ve líneas de otro', async () => {
    const linea = await service.crear(adminSindicatoA, { sindicatoId: sindicatoBId, codigo: 'L1', nombre: 'Línea 1' });
    expect(linea.sindicatoId).toBe(sindicatoAId);

    const deB = await service.crear(adminQuivo, { sindicatoId: sindicatoBId, codigo: 'L1', nombre: 'Línea B1' });
    await expect(service.obtener(adminSindicatoA, deB.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('el mismo código puede repetirse entre sindicatos distintos (unicidad es por tenant)', async () => {
    // ambos crearon código "L1" en el test anterior, en tenants distintos — no debería
    // haber lanzado ConflictException, lo que ya se verificó implícitamente arriba.
    const lista = await service.listar(adminSindicatoA);
    expect(lista.some((l) => l.codigo === 'L1')).toBe(true);
  });

  it('rechaza un código duplicado dentro del mismo sindicato (409)', async () => {
    await service.crear(adminSindicatoA, { sindicatoId: sindicatoAId, codigo: 'DUP', nombre: 'Primera' });
    await expect(
      service.crear(adminSindicatoA, { sindicatoId: sindicatoAId, codigo: 'DUP', nombre: 'Segunda' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('actualiza nombre/color', async () => {
    const linea = await service.crear(adminSindicatoA, { sindicatoId: sindicatoAId, codigo: 'L9', nombre: 'Vieja' });
    const actualizada = await service.actualizar(adminSindicatoA, linea.id, { nombre: 'Nueva', color: '#000000' });
    expect(actualizada.nombre).toBe('Nueva');
    expect(actualizada.color).toBe('#000000');
  });

  it('permite asignar una línea a una ciudad registrada', async () => {
    const linea = await service.crear(adminSindicatoA, {
      sindicatoId: sindicatoAId,
      cityId: 'la-paz-el-alto',
      codigo: 'LP1',
      nombre: 'Línea La Paz de prueba',
    });
    expect(linea.cityId).toBe('la-paz-el-alto');
  });
});

import { randomUUID } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { prisma, withTenantContext } from '@quivo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VehiculosService } from './vehiculos.service.js';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

describe('VehiculosService', () => {
  const service = new VehiculosService();
  const sindicatoAId = randomUUID();
  const sindicatoBId = randomUUID();
  const adminQuivo: AuthenticatedUser = { userId: 'test-admin-quivo', rol: 'admin_quivo', sindicatoId: null };
  const adminSindicatoA: AuthenticatedUser = {
    userId: 'test-admin-sindicato-a',
    rol: 'admin_sindicato',
    sindicatoId: sindicatoAId,
  };

  const vehiculoBase = {
    tipo: 'bus',
    marca: 'x',
    modelo: 'x',
    color: 'x',
    capacidad: 10,
    socioId: null,
    estado: 'activo' as const,
  };

  beforeAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({ data: { id: sindicatoAId, nombre: 'Vehiculos Test A', estado: 'activo' } });
      await tx.sindicato.create({ data: { id: sindicatoBId, nombre: 'Vehiculos Test B', estado: 'activo' } });
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      const sindicatoIds = { in: [sindicatoAId, sindicatoBId] };
      await tx.auditLog.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.vehiculo.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.sindicato.deleteMany({ where: { id: sindicatoIds } });
    });
    await prisma.$disconnect();
  });

  it('admin_sindicato queda forzado a su propio tenant y no ve vehículos de otro', async () => {
    const vehiculo = await service.crear(adminSindicatoA, {
      ...vehiculoBase,
      sindicatoId: sindicatoBId,
      placa: 'AAA111',
    });
    expect(vehiculo.sindicatoId).toBe(sindicatoAId);

    const deB = await service.crear(adminQuivo, { ...vehiculoBase, sindicatoId: sindicatoBId, placa: 'BBB111' });
    await expect(service.obtener(adminSindicatoA, deB.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('permite una transición válida de estado (activo → mantenimiento)', async () => {
    const vehiculo = await service.crear(adminSindicatoA, { ...vehiculoBase, sindicatoId: sindicatoAId, placa: 'CCC111' });
    const actualizado = await service.actualizar(adminSindicatoA, vehiculo.id, { estado: 'mantenimiento' });
    expect(actualizado.estado).toBe('mantenimiento');
  });

  it('rechaza una transición inválida de estado (mantenimiento → suspendido)', async () => {
    const vehiculo = await service.crear(adminSindicatoA, { ...vehiculoBase, sindicatoId: sindicatoAId, placa: 'DDD111' });
    await service.actualizar(adminSindicatoA, vehiculo.id, { estado: 'mantenimiento' });

    await expect(
      service.actualizar(adminSindicatoA, vehiculo.id, { estado: 'suspendido' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('permite volver a activo desde cualquier otro estado', async () => {
    const vehiculo = await service.crear(adminSindicatoA, { ...vehiculoBase, sindicatoId: sindicatoAId, placa: 'EEE111' });
    await service.actualizar(adminSindicatoA, vehiculo.id, { estado: 'suspendido' });
    const reactivado = await service.actualizar(adminSindicatoA, vehiculo.id, { estado: 'activo' });
    expect(reactivado.estado).toBe('activo');
  });

  it('respeta la unicidad de placa por sindicato', async () => {
    await service.crear(adminSindicatoA, { ...vehiculoBase, sindicatoId: sindicatoAId, placa: 'FFF111' });
    await expect(
      service.crear(adminSindicatoA, { ...vehiculoBase, sindicatoId: sindicatoAId, placa: 'FFF111' }),
    ).rejects.toThrow();
  });
});

import { randomUUID } from 'node:crypto';
import { prisma, withTenantContext } from '@quivo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { SyncErroresService } from './sync-errores.service.js';

describe('SyncErroresService', () => {
  const service = new SyncErroresService();
  const sindicatoAId = randomUUID();
  const sindicatoBId = randomUUID();
  const sesionAId = randomUUID();
  const adminQuivo: AuthenticatedUser = { userId: 'test-admin-quivo', rol: 'admin_quivo', sindicatoId: null };
  const adminSindicatoA: AuthenticatedUser = {
    userId: 'test-admin-a',
    rol: 'admin_sindicato',
    sindicatoId: sindicatoAId,
  };

  beforeAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({ data: { id: sindicatoAId, nombre: 'Sync Errores Test A', estado: 'activo' } });
      await tx.sindicato.create({ data: { id: sindicatoBId, nombre: 'Sync Errores Test B', estado: 'activo' } });
      await tx.syncError.create({
        data: {
          sindicatoId: sindicatoAId,
          deviceId: 'device-a',
          sesionId: sesionAId,
          eventId: randomUUID(),
          payload: { sesionId: sesionAId },
          error: 'Punto de control no encontrado',
        },
      });
      await tx.syncError.create({
        data: {
          sindicatoId: sindicatoBId,
          deviceId: 'device-b',
          eventId: randomUUID(),
          payload: {},
          error: 'Evento sin sesionId en el payload',
        },
      });
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      const sindicatoIds = { in: [sindicatoAId, sindicatoBId] };
      await tx.syncError.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.sindicato.deleteMany({ where: { id: sindicatoIds } });
    });
    await prisma.$disconnect();
  });

  it('admin_quivo ve errores de ambos sindicatos', async () => {
    const filas = await service.listar(adminQuivo, {});
    const sindicatosVistos = new Set(filas.map((f) => f.sindicatoId));
    expect(sindicatosVistos.has(sindicatoAId)).toBe(true);
    expect(sindicatosVistos.has(sindicatoBId)).toBe(true);
  });

  it('admin_sindicato solo ve errores de su propio tenant (RLS)', async () => {
    const filas = await service.listar(adminSindicatoA, {});
    expect(filas.every((f) => f.sindicatoId === sindicatoAId)).toBe(true);
    expect(filas.length).toBeGreaterThan(0);
  });

  it('filtra por deviceId', async () => {
    const filas = await service.listar(adminQuivo, { deviceId: 'device-a' });
    expect(filas.every((f) => f.deviceId === 'device-a')).toBe(true);
    expect(filas.length).toBeGreaterThan(0);
  });

  it('filtra por sesionId', async () => {
    const filas = await service.listar(adminQuivo, { sesionId: sesionAId });
    expect(filas.length).toBeGreaterThan(0);
    expect(filas.every((f) => f.sesionId === sesionAId)).toBe(true);
  });

  it('un error sin sesionId resoluble queda con sesionId null, no se descarta', async () => {
    const filas = await service.listar(adminQuivo, { deviceId: 'device-b' });
    expect(filas).toHaveLength(1);
    expect(filas[0]?.sesionId).toBeNull();
  });
});

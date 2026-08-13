import { randomUUID } from 'node:crypto';
import { prisma, withTenantContext } from '@quivo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditoriaService } from './auditoria.service.js';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

describe('AuditoriaService', () => {
  const service = new AuditoriaService();
  const sindicatoAId = randomUUID();
  const sindicatoBId = randomUUID();
  const usuarioRangoFechas = `u-rango-${randomUUID()}`;
  const auditAntesDelDiaId = randomUUID();
  const auditInicioDelDiaId = randomUUID();
  const auditFinDelDiaId = randomUUID();
  const auditDespuesDelDiaId = randomUUID();
  const adminQuivo: AuthenticatedUser = {
    userId: 'test-admin-quivo',
    rol: 'admin_quivo',
    sindicatoId: null,
  };
  const adminSindicatoA: AuthenticatedUser = {
    userId: 'test-admin-a',
    rol: 'admin_sindicato',
    sindicatoId: sindicatoAId,
  };

  beforeAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({
        data: { id: sindicatoAId, nombre: 'Auditoria Test A', estado: 'activo' },
      });
      await tx.sindicato.create({
        data: { id: sindicatoBId, nombre: 'Auditoria Test B', estado: 'activo' },
      });
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
      await tx.auditLog.createMany({
        data: [
          {
            sindicatoId: sindicatoAId,
            usuarioId: usuarioRangoFechas,
            entidad: 'vehiculo',
            entidadId: auditAntesDelDiaId,
            accion: 'editar',
            diff: { limite: 'antes' },
            ts: new Date('2026-08-12T03:59:59.999Z'),
          },
          {
            sindicatoId: sindicatoAId,
            usuarioId: usuarioRangoFechas,
            entidad: 'vehiculo',
            entidadId: auditInicioDelDiaId,
            accion: 'editar',
            diff: { limite: 'inicio' },
            ts: new Date('2026-08-12T04:00:00.000Z'),
          },
          {
            sindicatoId: sindicatoAId,
            usuarioId: usuarioRangoFechas,
            entidad: 'vehiculo',
            entidadId: auditFinDelDiaId,
            accion: 'editar',
            diff: { limite: 'fin' },
            ts: new Date('2026-08-13T03:59:59.999Z'),
          },
          {
            sindicatoId: sindicatoAId,
            usuarioId: usuarioRangoFechas,
            entidad: 'vehiculo',
            entidadId: auditDespuesDelDiaId,
            accion: 'editar',
            diff: { limite: 'despues' },
            ts: new Date('2026-08-13T04:00:00.000Z'),
          },
        ],
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

  it('incluye el día calendario completo de Bolivia en los filtros de fecha', async () => {
    const filas = await service.listar(adminQuivo, {
      usuarioId: usuarioRangoFechas,
      desde: new Date('2026-08-12T00:00:00.000Z'),
      hasta: new Date('2026-08-12T00:00:00.000Z'),
    });

    expect(filas.map((fila) => fila.entidadId)).toEqual([auditFinDelDiaId, auditInicioDelDiaId]);
  });
});

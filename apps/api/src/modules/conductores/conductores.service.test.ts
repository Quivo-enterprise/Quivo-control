import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { prisma, withTenantContext } from '@quivo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActualizarConductorSchema, CrearConductorSchema } from '@quivo/shared';
import { ConductoresService } from './conductores.service.js';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

describe('ConductoresService', () => {
  const service = new ConductoresService();
  const sindicatoAId = randomUUID();
  const sindicatoBId = randomUUID();
  const adminQuivo: AuthenticatedUser = {
    userId: 'test-admin-quivo',
    rol: 'admin_quivo',
    sindicatoId: null,
  };
  const adminSindicatoA: AuthenticatedUser = {
    userId: 'test-admin-sindicato-a',
    rol: 'admin_sindicato',
    sindicatoId: sindicatoAId,
  };

  beforeAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({
        data: { id: sindicatoAId, nombre: 'Conductores Test A', estado: 'activo' },
      });
      await tx.sindicato.create({
        data: { id: sindicatoBId, nombre: 'Conductores Test B', estado: 'activo' },
      });
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
    await expect(service.obtener(adminSindicatoA, deB.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lista solo los conductores del propio tenant', async () => {
    const lista = await service.listar(adminSindicatoA);
    expect(lista.every((c) => c.sindicatoId === sindicatoAId)).toBe(true);
  });

  it('actualiza estado', async () => {
    const conductor = await service.crear(adminSindicatoA, {
      sindicatoId: sindicatoAId,
      nombre: 'A editar',
      documentoIdentidad: 'DOC-3',
      licenciaConducir: 'LIC-3',
      estado: 'activo',
    });
    const actualizado = await service.actualizar(adminSindicatoA, conductor.id, {
      estado: 'inactivo',
    });
    expect(actualizado.estado).toBe('inactivo');
  });

  it('lanza NotFoundException al actualizar un id inexistente', async () => {
    await expect(
      service.actualizar(adminSindicatoA, randomUUID(), { estado: 'inactivo' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rechaza dos conductores con el mismo CI dentro del mismo sindicato', async () => {
    const documentoIdentidad = '876543210 SC';
    await service.crear(adminSindicatoA, {
      sindicatoId: sindicatoAId,
      nombre: 'Conductor CI único',
      documentoIdentidad,
      licenciaConducir: 'LIC-UNICA-1',
      estado: 'activo',
    });

    await expect(
      service.crear(adminSindicatoA, {
        sindicatoId: sindicatoAId,
        nombre: 'Conductor CI duplicado',
        documentoIdentidad,
        licenciaConducir: 'LIC-UNICA-2',
        estado: 'activo',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  describe('telefono', () => {
    const base = (n: string) => ({
      sindicatoId: sindicatoAId,
      nombre: `Conductor Telefono ${'ABCDEFGH'[Number(n)]}`,
      documentoIdentidad: `90000${n}1 LP`,
      licenciaConducir: `80000${n}1`,
      estado: 'activo' as const,
    });

    it('crea con telefono y lo guarda en E.164 (el schema normaliza)', async () => {
      const data = CrearConductorSchema.parse({ ...base('1'), telefono: '7123 4567' });
      const conductor = await service.crear(adminSindicatoA, data);
      expect(conductor.telefono).toBe('+59171234567');
      const guardado = await service.obtener(adminSindicatoA, conductor.id);
      expect(guardado.telefono).toBe('+59171234567');
    });

    it('PATCH sin telefono conserva el valor', async () => {
      const creado = await service.crear(
        adminSindicatoA,
        CrearConductorSchema.parse({ ...base('2'), telefono: '71234567' }),
      );
      const data = ActualizarConductorSchema.parse({ nombre: 'Conductor Editado' });
      const actualizado = await service.actualizar(adminSindicatoA, creado.id, data);
      expect(actualizado.nombre).toBe('Conductor Editado');
      expect(actualizado.telefono).toBe('+59171234567');
    });

    it("PATCH con telefono '' lo limpia a null", async () => {
      const creado = await service.crear(
        adminSindicatoA,
        CrearConductorSchema.parse({ ...base('3'), telefono: '71234567' }),
      );
      const data = ActualizarConductorSchema.parse({ telefono: '' });
      const actualizado = await service.actualizar(adminSindicatoA, creado.id, data);
      expect(actualizado.telefono).toBeNull();
    });

    it('PATCH con telefono null lo limpia a null', async () => {
      const creado = await service.crear(
        adminSindicatoA,
        CrearConductorSchema.parse({ ...base('4'), telefono: '71234567' }),
      );
      const data = ActualizarConductorSchema.parse({ telefono: null });
      const actualizado = await service.actualizar(adminSindicatoA, creado.id, data);
      expect(actualizado.telefono).toBeNull();
    });

    it('listar no revienta con un telefono inválido guardado y lo devuelve tal cual', async () => {
      const creado = await service.crear(adminSindicatoA, CrearConductorSchema.parse(base('5')));
      await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
        tx.$executeRaw`UPDATE conductores SET telefono = '44123456' WHERE id = ${creado.id}`,
      );
      const lista = await service.listar(adminSindicatoA);
      expect(lista.find((c) => c.id === creado.id)?.telefono).toBe('44123456');
    });
  });
});

import { randomUUID } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { prisma, withTenantContext } from '@quivo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SociosService } from './socios.service.js';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

describe('SociosService', () => {
  const service = new SociosService();
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
      await tx.sindicato.create({ data: { id: sindicatoAId, nombre: 'Socios Test A', estado: 'activo' } });
      await tx.sindicato.create({ data: { id: sindicatoBId, nombre: 'Socios Test B', estado: 'activo' } });
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      const sindicatoIds = { in: [sindicatoAId, sindicatoBId] };
      await tx.auditLog.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.socio.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.sindicato.deleteMany({ where: { id: sindicatoIds } });
    });
    await prisma.$disconnect();
  });

  it('admin_sindicato queda forzado a su propio tenant aunque el body diga otro sindicatoId', async () => {
    const socio = await service.crear(adminSindicatoA, {
      sindicatoId: sindicatoBId, // intento de colar un socio en el sindicato B
      nombre: 'Socio forzado',
      documentoIdentidad: 'DOC-FORZADO',
      estado: 'activo',
    });

    expect(socio.sindicatoId).toBe(sindicatoAId);
  });

  it('admin_sindicato no puede leer un socio de otro tenant (404, no 403 — RLS de por medio)', async () => {
    const socioDeB = await service.crear(adminQuivo, {
      sindicatoId: sindicatoBId,
      nombre: 'Socio de B',
      documentoIdentidad: 'DOC-B',
      estado: 'activo',
    });

    await expect(service.obtener(adminSindicatoA, socioDeB.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('admin_sindicato solo lista socios de su propio tenant', async () => {
    await service.crear(adminSindicatoA, {
      sindicatoId: sindicatoAId,
      nombre: 'Socio de A',
      documentoIdentidad: 'DOC-A',
      estado: 'activo',
    });
    await service.crear(adminQuivo, {
      sindicatoId: sindicatoBId,
      nombre: 'Otro de B',
      documentoIdentidad: 'DOC-B2',
      estado: 'activo',
    });

    const lista = await service.listar(adminSindicatoA);
    expect(lista.length).toBeGreaterThan(0);
    expect(lista.every((s) => s.sindicatoId === sindicatoAId)).toBe(true);
  });

  it('admin_quivo sin sindicatoId en el body lanza BadRequestException', async () => {
    await expect(
      service.crear(adminQuivo, {
        sindicatoId: '' as unknown as string,
        nombre: 'Sin tenant',
        documentoIdentidad: 'DOC-X',
        estado: 'activo',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('actualizar mantiene el sindicatoId original', async () => {
    const socio = await service.crear(adminSindicatoA, {
      sindicatoId: sindicatoAId,
      nombre: 'Socio a editar',
      documentoIdentidad: 'DOC-EDIT',
      estado: 'activo',
    });

    const actualizado = await service.actualizar(adminSindicatoA, socio.id, { estado: 'inactivo' });
    expect(actualizado.estado).toBe('inactivo');
    expect(actualizado.sindicatoId).toBe(sindicatoAId);
  });
});

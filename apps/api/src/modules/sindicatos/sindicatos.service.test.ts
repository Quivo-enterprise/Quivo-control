import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { prisma, withTenantContext } from '@quivo/db';
import { afterAll, describe, expect, it } from 'vitest';
import { SindicatosService } from './sindicatos.service.js';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

/**
 * Integración real contra Postgres (RLS activo, QUI-218) — el guard de rol garantiza que
 * solo `admin_quivo` llega hasta el service (ver sindicatos.controller.ts), así que el
 * único actor relevante acá es ese, pero el helper de tenant-context se ejercita igual.
 */
describe('SindicatosService', () => {
  const service = new SindicatosService();
  const adminQuivo: AuthenticatedUser = { userId: 'test-admin-quivo', rol: 'admin_quivo', sindicatoId: null };
  const creados: string[] = [];

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.auditLog.deleteMany({ where: { entidadId: { in: creados } } });
      await tx.sindicato.deleteMany({ where: { id: { in: creados } } });
    });
    await prisma.$disconnect();
  });

  it('crea un sindicato', async () => {
    const nombre = `Test ${randomUUID()}`;
    const sindicato = await service.crear(adminQuivo, { nombre, estado: 'activo' });
    creados.push(sindicato.id);

    expect(sindicato.nombre).toBe(nombre);
    expect(sindicato.estado).toBe('activo');
  });

  it('lista y obtiene el sindicato creado', async () => {
    const sindicato = await service.crear(adminQuivo, { nombre: `Test ${randomUUID()}`, estado: 'activo' });
    creados.push(sindicato.id);

    const lista = await service.listar(adminQuivo);
    expect(lista.some((s) => s.id === sindicato.id)).toBe(true);

    const obtenido = await service.obtener(adminQuivo, sindicato.id);
    expect(obtenido.id).toBe(sindicato.id);
  });

  it('actualiza el estado', async () => {
    const sindicato = await service.crear(adminQuivo, { nombre: `Test ${randomUUID()}`, estado: 'activo' });
    creados.push(sindicato.id);

    const actualizado = await service.actualizar(adminQuivo, sindicato.id, { estado: 'inactivo' });
    expect(actualizado.estado).toBe('inactivo');
  });

  it('lanza NotFoundException al obtener un id inexistente', async () => {
    await expect(service.obtener(adminQuivo, randomUUID())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lanza NotFoundException al actualizar un id inexistente', async () => {
    await expect(
      service.actualizar(adminQuivo, randomUUID(), { estado: 'inactivo' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { prisma, withTenantContext } from '@quivo/db';
import type { LineaGeoJson } from '@quivo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VariantesService } from './variantes.service.js';
import { RutasService } from './rutas.service.js';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

const GEOMETRIA: LineaGeoJson = {
  type: 'LineString',
  coordinates: [
    [-58.4, -34.6],
    [-58.39, -34.6],
  ],
};

describe('VariantesService', () => {
  const variantesService = new VariantesService();
  const rutasService = new RutasService();
  const sindicatoAId = randomUUID();
  const sindicatoBId = randomUUID();
  let rutaAId: string;
  let rutaBId: string;
  const adminSindicatoA: AuthenticatedUser = {
    userId: 'test-admin-sindicato-a',
    rol: 'admin_sindicato',
    sindicatoId: '',
  };

  beforeAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({ data: { id: sindicatoAId, nombre: 'Variantes Test A', estado: 'activo' } });
      await tx.sindicato.create({ data: { id: sindicatoBId, nombre: 'Variantes Test B', estado: 'activo' } });
    });
    adminSindicatoA.sindicatoId = sindicatoAId;

    const lineaA = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.linea.create({ data: { sindicatoId: sindicatoAId, codigo: 'VT1', nombre: 'Línea A' } }),
    );
    const lineaB = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.linea.create({ data: { sindicatoId: sindicatoBId, codigo: 'VT1', nombre: 'Línea B' } }),
    );
    const rutaA = await rutasService.crear(adminSindicatoA, lineaA.id, {
      sentido: 'ida',
      geometria: GEOMETRIA,
      estado: 'activo',
    });
    const rutaB = await rutasService.crear(
      { userId: 'setup', rol: 'admin_quivo', sindicatoId: null },
      lineaB.id,
      { sentido: 'ida', geometria: GEOMETRIA, estado: 'activo' },
    );
    rutaAId = rutaA.id;
    rutaBId = rutaB.id;
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.variante.deleteMany({ where: { rutaId: { in: [rutaAId, rutaBId] } } });
      await tx.$executeRaw`DELETE FROM rutas WHERE id IN (${rutaAId}, ${rutaBId})`;
      const sindicatoIds = { in: [sindicatoAId, sindicatoBId] };
      await tx.auditLog.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.linea.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.sindicato.deleteMany({ where: { id: sindicatoIds } });
    });
    await prisma.$disconnect();
  });

  it('crea una variante bajo una ruta propia', async () => {
    const variante = await variantesService.crear(adminSindicatoA, rutaAId, {
      nombre: 'Feriado',
      estado: 'activo',
    });
    expect(variante.rutaId).toBe(rutaAId);
  });

  it('no puede crear una variante en una ruta de otro tenant (404)', async () => {
    await expect(
      variantesService.crear(adminSindicatoA, rutaBId, { nombre: 'Hack', estado: 'activo' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lista solo las variantes de la ruta pedida', async () => {
    const lista = await variantesService.listarPorRuta(adminSindicatoA, rutaAId);
    expect(lista.every((v) => v.rutaId === rutaAId)).toBe(true);
  });

  it('actualiza el nombre de una variante', async () => {
    const variante = await variantesService.crear(adminSindicatoA, rutaAId, { nombre: 'Vieja', estado: 'activo' });
    const actualizada = await variantesService.actualizar(adminSindicatoA, variante.id, { nombre: 'Nueva' });
    expect(actualizada.nombre).toBe('Nueva');
  });

  it('obtiene una variante propia por id y 404 si es de otro tenant', async () => {
    const variante = await variantesService.crear(adminSindicatoA, rutaAId, {
      nombre: 'Obtenible',
      estado: 'activo',
    });
    const obtenida = await variantesService.obtener(adminSindicatoA, variante.id);
    expect(obtenida.id).toBe(variante.id);

    const deB = await variantesService.crear(
      { userId: 'setup', rol: 'admin_quivo', sindicatoId: null },
      rutaBId,
      { nombre: 'De otro tenant', estado: 'activo' },
    );
    await expect(variantesService.obtener(adminSindicatoA, deB.id)).rejects.toBeInstanceOf(NotFoundException);
  });
});

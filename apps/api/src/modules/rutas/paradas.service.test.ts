import { randomUUID } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { prisma, withTenantContext } from '@quivo/db';
import type { LineaGeoJson } from '@quivo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ParadasService } from './paradas.service.js';
import { RutasService } from './rutas.service.js';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

const GEOMETRIA: LineaGeoJson = {
  type: 'LineString',
  coordinates: [
    [-58.4, -34.6],
    [-58.39, -34.6],
  ],
};

describe('ParadasService', () => {
  const paradasService = new ParadasService();
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
      await tx.sindicato.create({ data: { id: sindicatoAId, nombre: 'Paradas Test A', estado: 'activo' } });
      await tx.sindicato.create({ data: { id: sindicatoBId, nombre: 'Paradas Test B', estado: 'activo' } });
    });
    adminSindicatoA.sindicatoId = sindicatoAId;

    const lineaA = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.linea.create({ data: { sindicatoId: sindicatoAId, codigo: 'PT1', nombre: 'Línea A' } }),
    );
    const lineaB = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.linea.create({ data: { sindicatoId: sindicatoBId, codigo: 'PT1', nombre: 'Línea B' } }),
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
      await tx.$executeRaw`DELETE FROM paradas WHERE "rutaId" IN (${rutaAId}, ${rutaBId})`;
      await tx.$executeRaw`DELETE FROM rutas WHERE id IN (${rutaAId}, ${rutaBId})`;
      const sindicatoIds = { in: [sindicatoAId, sindicatoBId] };
      await tx.auditLog.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.linea.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.sindicato.deleteMany({ where: { id: sindicatoIds } });
    });
    await prisma.$disconnect();
  });

  it('crea una parada cercana a la ruta y devuelve el coord como GeoJSON', async () => {
    const parada = await paradasService.crear(adminSindicatoA, rutaAId, {
      tipo: 'origen',
      orden: 0,
      coord: { type: 'Point', coordinates: [-58.4, -34.6] }, // sobre el primer punto de la línea
      estado: 'activo',
    });
    expect(parada.coord.type).toBe('Point');
    expect(parada.coord.coordinates[0]).toBeCloseTo(-58.4, 5);
  });

  it('rechaza una parada lejos de la geometría de la ruta (> 100m)', async () => {
    await expect(
      paradasService.crear(adminSindicatoA, rutaAId, {
        tipo: 'intermedia',
        orden: 1,
        coord: { type: 'Point', coordinates: [-58.4, -34.65] }, // ~5.5km de la ruta
        estado: 'activo',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('no puede crear una parada en una ruta de otro tenant (404)', async () => {
    await expect(
      paradasService.crear(adminSindicatoA, rutaBId, {
        tipo: 'origen',
        orden: 0,
        coord: { type: 'Point', coordinates: [-58.4, -34.6] },
        estado: 'activo',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lista las paradas de una ruta ordenadas', async () => {
    await paradasService.crear(adminSindicatoA, rutaAId, {
      tipo: 'destino',
      orden: 2,
      coord: { type: 'Point', coordinates: [-58.39, -34.6] },
      estado: 'activo',
    });
    const lista = await paradasService.listarPorRuta(adminSindicatoA, rutaAId);
    expect(lista.length).toBeGreaterThanOrEqual(2);
    expect([...lista].sort((a, b) => a.orden - b.orden)).toEqual(lista);
  });

  it('actualiza tipo/orden de una parada', async () => {
    const parada = await paradasService.crear(adminSindicatoA, rutaAId, {
      tipo: 'intermedia',
      orden: 5,
      coord: { type: 'Point', coordinates: [-58.395, -34.6] },
      estado: 'activo',
    });
    const actualizada = await paradasService.actualizar(adminSindicatoA, parada.id, { orden: 10 });
    expect(actualizada.orden).toBe(10);
  });
});

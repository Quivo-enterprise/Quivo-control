import { randomUUID } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { prisma, withTenantContext } from '@quivo/db';
import type { LineaGeoJson } from '@quivo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RutasService } from './rutas.service.js';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

const GEOMETRIA_VALIDA: LineaGeoJson = {
  type: 'LineString',
  coordinates: [
    [-58.4, -34.6],
    [-58.39, -34.6],
    [-58.38, -34.61],
  ],
};

describe('RutasService', () => {
  const service = new RutasService();
  const sindicatoAId = randomUUID();
  const sindicatoBId = randomUUID();
  let lineaAId: string;
  let lineaBId: string;
  const adminSindicatoA: AuthenticatedUser = {
    userId: 'test-admin-sindicato-a',
    rol: 'admin_sindicato',
    sindicatoId: '',
  };

  beforeAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({ data: { id: sindicatoAId, nombre: 'Rutas Test A', estado: 'activo' } });
      await tx.sindicato.create({ data: { id: sindicatoBId, nombre: 'Rutas Test B', estado: 'activo' } });
      const lineaA = await tx.linea.create({ data: { sindicatoId: sindicatoAId, codigo: 'RT1', nombre: 'Línea A' } });
      const lineaB = await tx.linea.create({ data: { sindicatoId: sindicatoBId, codigo: 'RT1', nombre: 'Línea B' } });
      lineaAId = lineaA.id;
      lineaBId = lineaB.id;
    });
    adminSindicatoA.sindicatoId = sindicatoAId;
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.$executeRaw`DELETE FROM rutas WHERE "lineaId" IN (${lineaAId}, ${lineaBId})`;
      const sindicatoIds = { in: [sindicatoAId, sindicatoBId] };
      await tx.auditLog.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.linea.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.sindicato.deleteMany({ where: { id: sindicatoIds } });
    });
    await prisma.$disconnect();
  });

  it('crea una ruta y devuelve la geometría como GeoJSON (round-trip)', async () => {
    const ruta = await service.crear(adminSindicatoA, lineaAId, {
      sentido: 'ida',
      geometria: GEOMETRIA_VALIDA,
      estado: 'activo',
    });

    expect(ruta.lineaId).toBe(lineaAId);
    expect(ruta.geometria.type).toBe('LineString');
    expect(ruta.geometria.coordinates).toHaveLength(3);
    // PostGIS puede devolver los floats con más precisión — comparamos con tolerancia.
    const [lon, lat] = ruta.geometria.coordinates[0] ?? [];
    expect(lon).toBeCloseTo(-58.4, 5);
    expect(lat).toBeCloseTo(-34.6, 5);
  });

  it('rechaza una geometría inválida (LineString con puntos duplicados colineales degenerados no cuenta, pero coordenadas repetidas idénticas sí)', async () => {
    await expect(
      service.crear(adminSindicatoA, lineaAId, {
        sentido: 'ida',
        // Un único punto repetido no es una LineString válida.
        geometria: { type: 'LineString', coordinates: [[-58.4, -34.6], [-58.4, -34.6]] },
        estado: 'activo',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('admin_sindicato no puede crear una ruta en una línea de otro tenant (404)', async () => {
    await expect(
      service.crear(adminSindicatoA, lineaBId, {
        sentido: 'ida',
        geometria: GEOMETRIA_VALIDA,
        estado: 'activo',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lista solo las rutas de la línea pedida', async () => {
    const lista = await service.listarPorLinea(adminSindicatoA, lineaAId);
    expect(lista.length).toBeGreaterThan(0);
    expect(lista.every((r) => r.lineaId === lineaAId)).toBe(true);
  });

  it('actualiza sentido y estado', async () => {
    const ruta = await service.crear(adminSindicatoA, lineaAId, {
      sentido: 'ida',
      geometria: GEOMETRIA_VALIDA,
      estado: 'activo',
    });
    const actualizada = await service.actualizar(adminSindicatoA, ruta.id, {
      sentido: 'vuelta',
      estado: 'inactivo',
    });
    expect(actualizada.sentido).toBe('vuelta');
    expect(actualizada.estado).toBe('inactivo');
  });
});

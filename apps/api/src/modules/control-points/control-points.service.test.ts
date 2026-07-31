import { randomUUID } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { prisma, withTenantContext } from '@quivo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ControlPointsService } from './control-points.service.js';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

const GEOMETRIA_GEOJSON = JSON.stringify({
  type: 'LineString',
  coordinates: [
    [-58.4, -34.6],
    [-58.39, -34.6],
  ],
});

describe('ControlPointsService', () => {
  const service = new ControlPointsService();
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
      await tx.sindicato.create({ data: { id: sindicatoAId, nombre: 'PC Test A', estado: 'activo' } });
      await tx.sindicato.create({ data: { id: sindicatoBId, nombre: 'PC Test B', estado: 'activo' } });
    });
    adminSindicatoA.sindicatoId = sindicatoAId;

    // Ruta creada vía SQL crudo (no RutasService, otro módulo — ver convención de módulos
    // en apps/api/src/modules/README.md) con la misma forma que rutas.service.ts hace en
    // producción.
    rutaAId = randomUUID();
    rutaBId = randomUUID();
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      const lineaA = await tx.linea.create({ data: { sindicatoId: sindicatoAId, codigo: 'PC1', nombre: 'Línea A' } });
      const lineaB = await tx.linea.create({ data: { sindicatoId: sindicatoBId, codigo: 'PC1', nombre: 'Línea B' } });
      await tx.$executeRaw`
        INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
        VALUES (${rutaAId}, ${lineaA.id}, 'ida', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA_GEOJSON}), 4326)::geography, 'activo', now(), now())
      `;
      await tx.$executeRaw`
        INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
        VALUES (${rutaBId}, ${lineaB.id}, 'ida', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA_GEOJSON}), 4326)::geography, 'activo', now(), now())
      `;
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.$executeRaw`DELETE FROM puntos_control WHERE "rutaId" IN (${rutaAId}, ${rutaBId})`;
      await tx.$executeRaw`DELETE FROM rutas WHERE id IN (${rutaAId}, ${rutaBId})`;
      const sindicatoIds = { in: [sindicatoAId, sindicatoBId] };
      await tx.auditLog.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.linea.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.sindicato.deleteMany({ where: { id: sindicatoIds } });
    });
    await prisma.$disconnect();
  });

  it('crea un punto de control cercano a la ruta con los valores por defecto', async () => {
    const punto = await service.crear(adminSindicatoA, rutaAId, {
      orden: 0,
      coord: { type: 'Point', coordinates: [-58.4, -34.6] },
      radioToleranciaM: 20,
      obligatorio: true,
    });
    expect(punto.rutaId).toBe(rutaAId);
    expect(punto.radioToleranciaM).toBe(20);
    expect(punto.obligatorio).toBe(true);
  });

  it('rechaza un punto de control lejos de la geometría de la ruta', async () => {
    await expect(
      service.crear(adminSindicatoA, rutaAId, {
        orden: 1,
        coord: { type: 'Point', coordinates: [-58.4, -34.65] },
        radioToleranciaM: 20,
        obligatorio: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('no puede crear un punto de control en una ruta de otro tenant (404)', async () => {
    await expect(
      service.crear(adminSindicatoA, rutaBId, {
        orden: 0,
        coord: { type: 'Point', coordinates: [-58.4, -34.6] },
        radioToleranciaM: 20,
        obligatorio: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lista los puntos de control de una ruta', async () => {
    const lista = await service.listarPorRuta(adminSindicatoA, rutaAId);
    expect(lista.length).toBeGreaterThan(0);
    expect(lista.every((p) => p.rutaId === rutaAId)).toBe(true);
  });

  it('actualiza radioToleranciaM y obligatorio', async () => {
    const punto = await service.crear(adminSindicatoA, rutaAId, {
      orden: 2,
      coord: { type: 'Point', coordinates: [-58.395, -34.6] },
      radioToleranciaM: 15,
      obligatorio: true,
    });
    const actualizado = await service.actualizar(adminSindicatoA, punto.id, {
      radioToleranciaM: 30,
      obligatorio: false,
    });
    expect(actualizado.radioToleranciaM).toBe(30);
    expect(actualizado.obligatorio).toBe(false);
  });
});

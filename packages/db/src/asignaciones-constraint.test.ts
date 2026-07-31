import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from './client.js';
import { withTenantContext } from './tenant-context.js';

const GEOMETRIA_GEOJSON = JSON.stringify({
  type: 'LineString',
  coordinates: [
    [-58.4, -34.6],
    [-58.39, -34.6],
  ],
});

/**
 * Prueba de integración del constraint `@@unique([vehiculoId, fecha, horario])` en
 * `asignaciones` (QUI-231, doc técnico §12 riesgo #12: "conflicto operativo real en la
 * calle") — un mismo vehículo no puede tener dos asignaciones el mismo día en el mismo
 * horario, sin importar la rotación. Corre contra Postgres real, no un mock.
 */
describe('Asignacion — constraint anti doble-asignación', () => {
  const sindicatoId = randomUUID();
  let rutaId: string;
  let vehiculoId: string;
  let rotacionId: string;
  const asignacionIds: string[] = [];

  beforeAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({ data: { id: sindicatoId, nombre: 'Asignaciones Test', estado: 'activo' } });
      const linea = await tx.linea.create({ data: { sindicatoId, codigo: 'AS1', nombre: 'Línea Asignaciones' } });
      rutaId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
        VALUES (${rutaId}, ${linea.id}, 'ida', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA_GEOJSON}), 4326)::geography, 'activo', now(), now())
      `;
      const vehiculo = await tx.vehiculo.create({
        data: {
          sindicatoId,
          placa: 'ASG001',
          tipo: 'bus',
          marca: 'x',
          modelo: 'x',
          color: 'x',
          capacidad: 10,
          estado: 'activo',
        },
      });
      vehiculoId = vehiculo.id;
      const rotacion = await tx.rotacion.create({ data: { sindicatoId, periodo: '2026-08', estado: 'borrador' } });
      rotacionId = rotacion.id;
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.asignacion.deleteMany({ where: { id: { in: asignacionIds } } });
      await tx.rotacion.deleteMany({ where: { sindicatoId } });
      await tx.vehiculo.deleteMany({ where: { sindicatoId } });
      await tx.$executeRaw`DELETE FROM rutas WHERE id = ${rutaId}`;
      await tx.linea.deleteMany({ where: { sindicatoId } });
      await tx.sindicato.delete({ where: { id: sindicatoId } });
    });
    await prisma.$disconnect();
  });

  it('permite la primera asignación de un vehículo en una fecha/horario', async () => {
    const asignacion = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.asignacion.create({
        data: {
          rotacionId,
          vehiculoId,
          rutaId,
          fecha: new Date('2026-08-03'),
          horario: 'manana',
          orden: 1,
          venceAt: new Date('2026-08-03T23:59:59Z'),
        },
      }),
    );
    asignacionIds.push(asignacion.id);
    expect(asignacion.id).toBeTruthy();
  });

  it('rechaza una segunda asignación del mismo vehículo, misma fecha y horario', async () => {
    await expect(
      withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
        tx.asignacion.create({
          data: {
            rotacionId,
            vehiculoId,
            rutaId,
            fecha: new Date('2026-08-03'),
            horario: 'manana',
            orden: 2,
            venceAt: new Date('2026-08-03T23:59:59Z'),
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'P2002' } satisfies Partial<Prisma.PrismaClientKnownRequestError>);
  });

  it('permite el mismo vehículo el mismo día en un horario distinto', async () => {
    const asignacion = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.asignacion.create({
        data: {
          rotacionId,
          vehiculoId,
          rutaId,
          fecha: new Date('2026-08-03'),
          horario: 'tarde',
          orden: 1,
          venceAt: new Date('2026-08-03T23:59:59Z'),
        },
      }),
    );
    asignacionIds.push(asignacion.id);
    expect(asignacion.id).toBeTruthy();
  });
});

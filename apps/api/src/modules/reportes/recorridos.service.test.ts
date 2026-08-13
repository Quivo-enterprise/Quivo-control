import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { prisma, withTenantContext } from '@quivo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { RecorridosService } from './recorridos.service.js';

const GEOMETRIA_GEOJSON = JSON.stringify({
  type: 'LineString',
  coordinates: [
    [-58.4, -34.6],
    [-58.39, -34.6],
  ],
});
const PC_COORD = JSON.stringify({ type: 'Point', coordinates: [-58.395, -34.6] });

describe('RecorridosService', () => {
  const service = new RecorridosService();
  const sindicatoAId = randomUUID();
  const sindicatoBId = randomUUID();
  let rutaId: string;
  let puntoControlId: string;
  let sesionId: string;
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
  const adminSindicatoB: AuthenticatedUser = {
    userId: 'test-admin-b',
    rol: 'admin_sindicato',
    sindicatoId: sindicatoBId,
  };

  beforeAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({
        data: { id: sindicatoAId, nombre: 'Recorridos Test A', estado: 'activo' },
      });
      await tx.sindicato.create({
        data: { id: sindicatoBId, nombre: 'Recorridos Test B', estado: 'activo' },
      });

      const linea = await tx.linea.create({
        data: {
          sindicatoId: sindicatoAId,
          codigo: 'RC1',
          nombre: 'Línea Recorridos',
          color: '#FD9E15',
        },
      });
      rutaId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
        VALUES (${rutaId}, ${linea.id}, 'ida', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA_GEOJSON}), 4326)::geography, 'activo', now(), now())
      `;
      puntoControlId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO puntos_control (id, "rutaId", orden, coord, "radioToleranciaM", obligatorio, "createdAt", "updatedAt")
        VALUES (${puntoControlId}, ${rutaId}, 0, ST_SetSRID(ST_GeomFromGeoJSON(${PC_COORD}), 4326)::geography, 30, true, now(), now())
      `;

      const vehiculo = await tx.vehiculo.create({
        data: {
          sindicatoId: sindicatoAId,
          placa: 'RCD001',
          tipo: 'bus',
          marca: 'x',
          modelo: 'x',
          color: 'x',
          capacidad: 10,
          estado: 'activo',
        },
      });
      const conductor = await tx.conductor.create({
        data: {
          sindicatoId: sindicatoAId,
          nombre: 'Conductor Recorrido',
          documentoIdentidad: `RCD-${randomUUID()}`,
          licenciaConducir: 'LIC-1',
        },
      });
      const rotacion = await tx.rotacion.create({
        data: { sindicatoId: sindicatoAId, periodo: '2026-08', estado: 'publicada' },
      });
      const ahora = new Date();
      const asignacion = await tx.asignacion.create({
        data: {
          rotacionId: rotacion.id,
          vehiculoId: vehiculo.id,
          conductorId: conductor.id,
          rutaId,
          fecha: ahora,
          horario: 'manana',
          orden: 1,
          venceAt: new Date(ahora.getTime() + 60 * 60 * 1000),
          estado: 'vigente',
        },
      });

      const sesion = await tx.sesionOperativa.create({
        data: {
          sindicatoId: sindicatoAId,
          asignacionId: asignacion.id,
          vehiculoId: vehiculo.id,
          conductorId: conductor.id,
          deviceId: 'device-recorrido',
          fin: ahora,
          estado: 'finalizada',
          accessTokenHash: randomUUID(),
          refreshTokenHash: randomUUID(),
          accessExpiresAt: new Date(ahora.getTime() + 60 * 60 * 1000),
          refreshExpiresAt: new Date(ahora.getTime() + 60 * 60 * 1000),
        },
      });
      sesionId = sesion.id;

      await tx.$executeRaw`SELECT crear_particion_gps_points(CURRENT_DATE)`;
      await tx.$executeRaw`
        INSERT INTO gps_points (event_id, sesion_id, device_id, ts, lat, lng, accuracy, speed, received_at)
        VALUES
          (${randomUUID()}::uuid, ${sesionId}::uuid, 'device-recorrido', ${ahora}::timestamptz, -34.6, -58.4, 5, 8.3, now()),
          (${randomUUID()}::uuid, ${sesionId}::uuid, 'device-recorrido', ${new Date(ahora.getTime() + 1000)}::timestamptz, -34.599, -58.399, 5, 9.1, now())
      `;

      await tx.cumplimientoPc.create({
        data: {
          eventId: randomUUID(),
          sindicatoId: sindicatoAId,
          sesionId,
          puntoControlId,
          ts: ahora,
          distanciaM: 10,
          cumplido: true,
          validadoPor: 'worker',
        },
      });
      await tx.eventoOperativo.create({
        data: {
          eventId: randomUUID(),
          sindicatoId: sindicatoAId,
          sesionId,
          deviceId: 'device-recorrido',
          tipo: 'inicio_recorrido',
          ts: ahora,
          payload: { sesionId },
        },
      });
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.$executeRaw`DELETE FROM gps_points WHERE sesion_id = ${sesionId}::uuid`;
      await tx.eventoOperativo.deleteMany({ where: { sindicatoId: sindicatoAId } });
      await tx.cumplimientoPc.deleteMany({ where: { sindicatoId: sindicatoAId } });
      await tx.sesionOperativa.deleteMany({ where: { sindicatoId: sindicatoAId } });
      await tx.asignacion.deleteMany({ where: { rutaId } });
      await tx.rotacion.deleteMany({ where: { sindicatoId: sindicatoAId } });
      await tx.vehiculo.deleteMany({ where: { sindicatoId: sindicatoAId } });
      await tx.conductor.deleteMany({ where: { sindicatoId: sindicatoAId } });
      await tx.$executeRaw`DELETE FROM puntos_control WHERE "rutaId" = ${rutaId}`;
      await tx.$executeRaw`DELETE FROM rutas WHERE id = ${rutaId}`;
      await tx.linea.deleteMany({ where: { sindicatoId: sindicatoAId } });
      await tx.sindicato.deleteMany({ where: { id: { in: [sindicatoAId, sindicatoBId] } } });
    });
    await prisma.$disconnect();
  });

  it('reconstruye la traza GPS, ruta, puntos de control, cumplimientos y timeline de una sesión', async () => {
    const detalle = await service.obtener(adminQuivo, sesionId);

    expect(detalle.sesion.id).toBe(sesionId);
    expect(detalle.ruta.geometria.type).toBe('LineString');
    expect(detalle.linea.nombre).toBe('Línea Recorridos');
    expect(detalle.puntosControl).toHaveLength(1);
    expect(detalle.trazaGps).toHaveLength(2);
    expect(detalle.trazaGps[0]?.lat).toBeCloseTo(-34.6, 3);
    expect(detalle.cumplimientos).toHaveLength(1);
    expect(detalle.cumplimientos[0]?.validadoPor).toBe('worker');
    expect(detalle.eventos).toHaveLength(1);
    expect(detalle.eventos[0]?.tipo).toBe('inicio_recorrido');
  });

  it('admin_sindicato del mismo tenant puede ver la sesión', async () => {
    const detalle = await service.obtener(adminSindicatoA, sesionId);
    expect(detalle.sesion.id).toBe(sesionId);
  });

  it('admin_sindicato de otro tenant recibe 404 (RLS, no 403)', async () => {
    await expect(service.obtener(adminSindicatoB, sesionId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('una sesión inexistente devuelve 404', async () => {
    await expect(service.obtener(adminQuivo, randomUUID())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('listar devuelve la sesión con datos de vehículo/conductor/línea resueltos', async () => {
    const filas = await service.listar(adminQuivo, {});
    const fila = filas.find((f) => f.id === sesionId);
    expect(fila).toBeDefined();
    expect(fila?.vehiculoPlaca).toBe('RCD001');
    expect(fila?.conductorNombre).toBe('Conductor Recorrido');
    expect(fila?.lineaNombre).toBe('Línea Recorridos');
  });

  it('incluye una sesión del cierre del día calendario boliviano', async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.sesionOperativa.update({
        where: { id: sesionId },
        data: { inicio: new Date('2026-08-13T03:59:59.999Z') },
      }),
    );

    const filas = await service.listar(adminQuivo, {
      desde: new Date('2026-08-12T00:00:00.000Z'),
      hasta: new Date('2026-08-12T00:00:00.000Z'),
    });

    expect(filas.some((fila) => fila.id === sesionId)).toBe(true);
  });
});

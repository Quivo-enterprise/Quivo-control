import { randomUUID } from 'node:crypto';
import { prisma, withTenantContext } from '@quivo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { CumplimientoService } from './cumplimiento.service.js';

const GEOMETRIA_GEOJSON = JSON.stringify({
  type: 'LineString',
  coordinates: [
    [-58.4, -34.6],
    [-58.39, -34.6],
  ],
});
const PC_COORD = JSON.stringify({ type: 'Point', coordinates: [-58.395, -34.6] });

describe('CumplimientoService', () => {
  const service = new CumplimientoService();
  const sindicatoAId = randomUUID();
  const sindicatoBId = randomUUID();
  let rutaId: string;
  let puntoControlId: string;
  let vehiculoId: string;
  let conductorId: string;
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
        data: { id: sindicatoAId, nombre: 'Cumplimiento Test A', estado: 'activo' },
      });
      await tx.sindicato.create({
        data: { id: sindicatoBId, nombre: 'Cumplimiento Test B', estado: 'activo' },
      });

      const linea = await tx.linea.create({
        data: {
          sindicatoId: sindicatoAId,
          codigo: 'CT1',
          nombre: 'Línea Cumplimiento',
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
          placa: 'CMP001',
          tipo: 'bus',
          marca: 'x',
          modelo: 'x',
          color: 'x',
          capacidad: 10,
          estado: 'activo',
        },
      });
      vehiculoId = vehiculo.id;
      const conductor = await tx.conductor.create({
        data: {
          sindicatoId: sindicatoAId,
          nombre: 'Conductor Cumplimiento',
          documentoIdentidad: `CMP-${randomUUID()}`,
          licenciaConducir: 'LIC-1',
        },
      });
      conductorId = conductor.id;
      const rotacion = await tx.rotacion.create({
        data: { sindicatoId: sindicatoAId, periodo: '2026-08', estado: 'publicada' },
      });

      const fechaOperacion = new Date('2026-08-12T00:00:00.000Z');
      const cierreJornadaBoliviana = new Date('2026-08-13T03:59:59.999Z');
      const asignacion = await tx.asignacion.create({
        data: {
          rotacionId: rotacion.id,
          vehiculoId: vehiculo.id,
          conductorId: conductor.id,
          rutaId,
          fecha: fechaOperacion,
          horario: 'manana',
          orden: 1,
          venceAt: new Date(fechaOperacion.getTime() + 60 * 60 * 1000),
          estado: 'vigente',
        },
      });

      const sesionCompleta = await tx.sesionOperativa.create({
        data: {
          sindicatoId: sindicatoAId,
          asignacionId: asignacion.id,
          vehiculoId: vehiculo.id,
          conductorId: conductor.id,
          deviceId: 'device-cmp',
          fin: cierreJornadaBoliviana,
          estado: 'finalizada',
          accessTokenHash: randomUUID(),
          refreshTokenHash: randomUUID(),
          accessExpiresAt: new Date(cierreJornadaBoliviana.getTime() + 60 * 60 * 1000),
          refreshExpiresAt: new Date(cierreJornadaBoliviana.getTime() + 60 * 60 * 1000),
        },
      });
      await tx.cumplimientoPc.create({
        data: {
          eventId: randomUUID(),
          sindicatoId: sindicatoAId,
          sesionId: sesionCompleta.id,
          puntoControlId,
          ts: cierreJornadaBoliviana,
          distanciaM: 10,
          cumplido: true,
          validadoPor: 'worker',
        },
      });
      await tx.cumplimientoPc.create({
        data: {
          eventId: randomUUID(),
          sindicatoId: sindicatoAId,
          sesionId: sesionCompleta.id,
          puntoControlId,
          ts: cierreJornadaBoliviana,
          distanciaM: 80,
          cumplido: false,
          validadoPor: 'worker',
        },
      });
      // reportado por el app (no worker): no debe contar como fuente de verdad del dashboard.
      await tx.cumplimientoPc.create({
        data: {
          eventId: randomUUID(),
          sindicatoId: sindicatoAId,
          sesionId: sesionCompleta.id,
          puntoControlId,
          ts: cierreJornadaBoliviana,
          distanciaM: 5,
          cumplido: true,
          validadoPor: 'app',
        },
      });
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.cumplimientoPc.deleteMany({ where: { sindicatoId: sindicatoAId } });
      await tx.sesionOperativa.deleteMany({ where: { sindicatoId: sindicatoAId } });
      await tx.asignacion.deleteMany({ where: { vehiculoId } });
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

  it('agrupa por línea y calcula % de cumplimiento solo con validadoPor=worker', async () => {
    const filas = await service.obtener(adminQuivo, { por: 'linea' });
    const fila = filas.find((f) => f.nombre === 'Línea Cumplimiento');
    expect(fila).toBeDefined();
    expect(fila?.puntosTotales).toBe(2);
    expect(fila?.puntosCumplidos).toBe(1);
    expect(fila?.porcentajeCumplimiento).toBe(50);
  });

  it('una asignación con más de una sesión finalizada (reintento) no infla recorridosCompletados por encima de recorridosAsignados', async () => {
    const ahora = new Date();
    const asignacion = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.asignacion.findFirstOrThrow({ where: { vehiculoId } }),
    );
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.sesionOperativa.create({
        data: {
          sindicatoId: sindicatoAId,
          asignacionId: asignacion.id,
          vehiculoId,
          conductorId,
          deviceId: 'device-cmp-retry',
          fin: ahora,
          estado: 'finalizada',
          accessTokenHash: randomUUID(),
          refreshTokenHash: randomUUID(),
          accessExpiresAt: new Date(ahora.getTime() + 60 * 60 * 1000),
          refreshExpiresAt: new Date(ahora.getTime() + 60 * 60 * 1000),
        },
      }),
    );

    const filas = await service.obtener(adminQuivo, { por: 'linea' });
    const fila = filas.find((f) => f.nombre === 'Línea Cumplimiento');
    expect(fila?.recorridosAsignados).toBe(1);
    expect(fila?.recorridosCompletados).toBe(1);
  });

  it('agrupa por vehículo usando la placa como nombre', async () => {
    const filas = await service.obtener(adminQuivo, { por: 'vehiculo' });
    const fila = filas.find((f) => f.nombre === 'CMP001');
    expect(fila).toBeDefined();
    expect(fila?.puntosTotales).toBe(2);
  });

  it('cuenta recorridos asignados vs completados (fin no nulo)', async () => {
    const filas = await service.obtener(adminQuivo, { por: 'linea' });
    const fila = filas.find((f) => f.nombre === 'Línea Cumplimiento');
    expect(fila?.recorridosAsignados).toBe(1);
    expect(fila?.recorridosCompletados).toBe(1);
  });

  it('admin_sindicato solo ve su propio tenant (RLS vía join a lineas)', async () => {
    const filas = await service.obtener(adminSindicatoA, { por: 'linea' });
    expect(filas.every((f) => f.nombre !== undefined)).toBe(true);
    const fila = filas.find((f) => f.nombre === 'Línea Cumplimiento');
    expect(fila).toBeDefined();
  });

  it('filtra por rango de fechas: fuera del rango no aparece', async () => {
    const filas = await service.obtener(adminQuivo, {
      por: 'linea',
      desde: new Date('2000-01-01'),
      hasta: new Date('2000-01-02'),
    });
    const fila = filas.find((f) => f.nombre === 'Línea Cumplimiento');
    expect(fila).toBeUndefined();
  });

  it('incluye los cumplimientos del cierre del día calendario boliviano', async () => {
    const filas = await service.obtener(adminQuivo, {
      por: 'linea',
      desde: new Date('2026-08-12T00:00:00.000Z'),
      hasta: new Date('2026-08-12T00:00:00.000Z'),
    });
    const fila = filas.find((f) => f.nombre === 'Línea Cumplimiento');

    expect(fila?.puntosTotales).toBe(2);
    expect(fila?.puntosCumplidos).toBe(1);
  });

  it('la sesión con validadoPor=app no infla el conteo de puntos totales', async () => {
    const filas = await service.obtener(adminQuivo, { por: 'linea' });
    const fila = filas.find((f) => f.nombre === 'Línea Cumplimiento');
    expect(fila?.puntosTotales).toBe(2);
  });
});

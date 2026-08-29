import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { prisma, withTenantContext } from '@quivo/db';
import type { LineaGeoJson } from '@quivo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { ParadasService } from '../rutas/paradas.service.js';
import { RutasService } from '../rutas/rutas.service.js';
import { MobilityPublicationService } from './mobility-publication.service.js';
import { JourneyService } from './journey.service.js';
import { PublicMobilityService } from './public-mobility.service.js';

const GEOMETRIA: LineaGeoJson = {
  type: 'LineString',
  coordinates: [
    [-66.157, -17.3935],
    [-66.155, -17.392],
  ],
};

const GEOMETRIA_CONEXION: LineaGeoJson = {
  type: 'LineString',
  coordinates: [
    [-66.155, -17.392],
    [-66.151, -17.389],
  ],
};

const GEOMETRIA_TERCER_TRAMO: LineaGeoJson = {
  type: 'LineString',
  coordinates: [
    [-66.151, -17.389],
    [-66.147, -17.386],
  ],
};

describe('PublicMobilityService', () => {
  const mobility = new PublicMobilityService();
  const journeys = new JourneyService();
  const publications = new MobilityPublicationService();
  const rutas = new RutasService();
  const paradas = new ParadasService();
  const sindicatoId = randomUUID();
  const actor: AuthenticatedUser = {
    userId: 'public-mobility-test',
    rol: 'admin_quivo',
    sindicatoId: null,
  };
  let lineId: string;
  let routeId: string;
  let variantId: string;
  let stopId: string;
  let transferLineId: string;
  let transferRouteId: string;
  let thirdLineId: string;
  let thirdRouteId: string;
  let vehicleQrToken: string;
  let vehicleId: string;
  let conductorId: string;
  let rotationId: string;
  let assignmentId: string;
  let operationalSessionId: string;

  beforeAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({
        data: { id: sindicatoId, nombre: 'Sindicato Mobility Test', estado: 'activo' },
      });
      const line = await tx.linea.create({
        data: {
          sindicatoId,
          codigo: `PM-${sindicatoId.slice(0, 6)}`,
          nombre: 'Línea pública de prueba',
          color: '#3226B4',
        },
      });
      lineId = line.id;
      const transferLine = await tx.linea.create({
        data: {
          sindicatoId,
          codigo: `TX-${sindicatoId.slice(0, 6)}`,
          nombre: 'Línea de conexión de prueba',
          color: '#1479FF',
        },
      });
      transferLineId = transferLine.id;
      const thirdLine = await tx.linea.create({
        data: {
          sindicatoId,
          codigo: `T3-${sindicatoId.slice(0, 6)}`,
          nombre: 'Línea del tercer tramo',
          color: '#F59E0B',
        },
      });
      thirdLineId = thirdLine.id;
    });
    const route = await rutas.crear(actor, lineId, {
      sentido: 'ida',
      geometria: GEOMETRIA,
      estado: 'activo',
    });
    routeId = route.id;
    const transferRoute = await rutas.crear(actor, transferLineId, {
      sentido: 'ida',
      geometria: GEOMETRIA_CONEXION,
      estado: 'activo',
    });
    transferRouteId = transferRoute.id;
    const thirdRoute = await rutas.crear(actor, thirdLineId, {
      sentido: 'ida',
      geometria: GEOMETRIA_TERCER_TRAMO,
      estado: 'activo',
    });
    thirdRouteId = thirdRoute.id;
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      const variant = await tx.variante.create({
        data: { rutaId: routeId, nombre: 'Universidad', estado: 'activo' },
      });
      variantId = variant.id;
    });
    const stop = await paradas.crear(actor, routeId, {
      tipo: 'origen',
      orden: 0,
      coord: { type: 'Point', coordinates: [-66.157, -17.3935] },
      estado: 'activo',
    });
    stopId = stop.id;
    await withTenantContext(
      { rol: 'admin_quivo', sindicatoId: null },
      (tx) =>
        tx.$executeRaw`UPDATE paradas SET nombre = 'Plaza de prueba', referencia = 'Esquina norte' WHERE id = ${stopId}`,
    );
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      if (operationalSessionId)
        await tx.sesionOperativa.deleteMany({ where: { id: operationalSessionId } });
      if (assignmentId) await tx.asignacion.deleteMany({ where: { id: assignmentId } });
      if (rotationId) await tx.rotacion.deleteMany({ where: { id: rotationId } });
      if (vehicleId) await tx.vehiculo.deleteMany({ where: { id: vehicleId } });
      if (conductorId) await tx.conductor.deleteMany({ where: { id: conductorId } });
      await tx.parada.deleteMany({ where: { id: stopId } });
      await tx.variante.deleteMany({ where: { id: variantId } });
      await tx.$executeRaw`DELETE FROM rutas WHERE id = ${transferRouteId}`;
      await tx.$executeRaw`DELETE FROM rutas WHERE id = ${routeId}`;
      await tx.$executeRaw`DELETE FROM rutas WHERE id = ${thirdRouteId}`;
      await tx.auditLog.deleteMany({ where: { sindicatoId } });
      await tx.linea.deleteMany({ where: { id: lineId } });
      await tx.linea.deleteMany({ where: { id: transferLineId } });
      await tx.linea.deleteMany({ where: { id: thirdLineId } });
      await tx.sindicato.deleteMany({ where: { id: sindicatoId } });
    });
    await prisma.$disconnect();
  });

  it('no expone una línea mientras permanece en borrador', async () => {
    await expect(mobility.obtenerLinea(lineId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('solo expone el detalle después de validar y publicar sus recursos', async () => {
    await publicar('lineas', lineId);
    await publicar('rutas', routeId);
    await publicar('variantes', variantId);
    await publicar('paradas', stopId);

    const line = await mobility.obtenerLinea(lineId);
    expect(line.code).toContain('PM-');
    expect(line.cityId).toBe('cochabamba');
    expect(line.cityName).toBe('Cochabamba metropolitana');
    expect(line.routes).toHaveLength(1);
    expect(line.routes[0]?.variants).toEqual([{ id: variantId, name: 'Universidad' }]);
    expect(line.routes[0]?.stops[0]).toMatchObject({ id: stopId, name: 'Plaza de prueba' });
    await expect(mobility.listarLineas('Línea pública', '10')).resolves.toMatchObject({
      items: [{ id: lineId }],
    });
    await expect(mobility.listarParadas('plaza', '10')).resolves.toMatchObject({
      items: [{ id: stopId, name: 'Plaza de prueba' }],
    });
  });

  it('mantiene la red pública separada por ciudad', async () => {
    await expect(mobility.listarCiudades()).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ id: 'cochabamba', coverageStatus: 'ready' }),
        expect.objectContaining({ id: 'la-paz-el-alto', coverageStatus: 'community' }),
      ]),
    });
    await expect(mobility.listarLineas(undefined, '10', 'la-paz-el-alto')).resolves.toEqual({
      items: [],
    });
    await expect(mobility.listarLineas(undefined, '10', 'cochabamba')).resolves.toMatchObject({
      items: [{ id: lineId }],
    });
  });

  it('calcula una alternativa directa sin limitar artificialmente los resultados', async () => {
    const response = await journeys.buscarViajes({
      origin: { type: 'Point', coordinates: [-66.157, -17.3935] },
      destination: { type: 'Point', coordinates: [-66.155, -17.392] },
      maxWalkingMeters: 200,
    });
    expect(response.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          transfers: 0,
          segments: expect.arrayContaining([expect.objectContaining({ routeId })]),
        }),
      ]),
    );
  });

  it('propone un transbordo cuando dos rutas publicadas conectan origen y destino', async () => {
    await publicar('lineas', transferLineId);
    await publicar('rutas', transferRouteId);
    const response = await journeys.buscarViajes({
      origin: { type: 'Point', coordinates: [-66.157, -17.3935] },
      destination: { type: 'Point', coordinates: [-66.151, -17.389] },
      maxWalkingMeters: 200,
    });
    expect(response.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          transfers: 1,
          segments: expect.arrayContaining([
            expect.objectContaining({ routeId }),
            expect.objectContaining({ routeId: transferRouteId }),
          ]),
        }),
      ]),
    );
  });

  it('encadena dos transbordos cuando el destino requiere tres rutas', async () => {
    await publicar('lineas', thirdLineId);
    await publicar('rutas', thirdRouteId);
    const response = await journeys.buscarViajes({
      origin: { type: 'Point', coordinates: [-66.157, -17.3935] },
      destination: { type: 'Point', coordinates: [-66.147, -17.386] },
      maxWalkingMeters: 200,
    });
    expect(response.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          transfers: 2,
          segments: expect.arrayContaining([
            expect.objectContaining({ routeId }),
            expect.objectContaining({ routeId: transferRouteId }),
            expect.objectContaining({ routeId: thirdRouteId }),
          ]),
        }),
      ]),
    );
  });

  it('resuelve el QR opaco sólo durante una sesión operativa vigente, sin datos internos', async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      const conductor = await tx.conductor.create({
        data: {
          sindicatoId,
          nombre: 'Conductor QR',
          documentoIdentidad: `QR-${sindicatoId}`,
          licenciaConducir: `LIC-${sindicatoId}`,
          estado: 'activo',
        },
      });
      conductorId = conductor.id;
      const vehicle = await tx.vehiculo.create({
        data: {
          sindicatoId,
          placa: `QR-${sindicatoId.slice(0, 6)}`,
          tipo: 'minibús',
          marca: 'QUIVO',
          modelo: 'Prueba',
          color: 'Azul',
          capacidad: 12,
          estado: 'activo',
        },
      });
      vehicleId = vehicle.id;
      vehicleQrToken = vehicle.publicQrToken;
      const rotation = await tx.rotacion.create({
        data: { sindicatoId, periodo: 'prueba-qr', estado: 'publicada' },
      });
      rotationId = rotation.id;
      const assignment = await tx.asignacion.create({
        data: {
          rotacionId: rotationId,
          vehiculoId: vehicleId,
          conductorId,
          rutaId: routeId,
          fecha: new Date(),
          horario: 'mañana',
          orden: 1,
          venceAt: new Date(Date.now() + 60 * 60 * 1000),
          estado: 'vigente',
        },
      });
      assignmentId = assignment.id;
      const session = await tx.sesionOperativa.create({
        data: {
          sindicatoId,
          asignacionId: assignmentId,
          vehiculoId: vehicleId,
          conductorId,
          deviceId: randomUUID(),
          accessTokenHash: randomUUID(),
          refreshTokenHash: randomUUID(),
          accessExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
          refreshExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
          estado: 'activa',
        },
      });
      operationalSessionId = session.id;
    });

    await expect(mobility.resolverQrVehiculo(vehicleQrToken)).resolves.toEqual({ lineId });
    await expect(mobility.resolverQrVehiculo(randomUUID())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  async function publicar(resource: 'lineas' | 'rutas' | 'variantes' | 'paradas', id: string) {
    await publications.actualizar(actor, resource, id, 'validado');
    await publications.actualizar(actor, resource, id, 'publicado');
  }
});

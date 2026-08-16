import { randomUUID } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { prisma, withTenantContext } from '@quivo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';
import { PaqueteDiaService } from './paquete-dia.service.js';

const GEOMETRIA_GEOJSON = JSON.stringify({
  type: 'LineString',
  coordinates: [
    [-58.4, -34.6],
    [-58.39, -34.6],
  ],
});
const PARADA_COORD = JSON.stringify({ type: 'Point', coordinates: [-58.4, -34.6] });
const PC_COORD = JSON.stringify({ type: 'Point', coordinates: [-58.395, -34.6] });

describe('PaqueteDiaService', () => {
  const service = new PaqueteDiaService();
  const sindicatoId = randomUUID();
  let rutaId: string;
  let asignacionVigenteId: string;
  let asignacionVencidaId: string;
  let sesion: SesionMovilAutenticada;

  beforeAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({ data: { id: sindicatoId, nombre: 'Paquete Día Test', estado: 'activo' } });
      const linea = await tx.linea.create({
        data: { sindicatoId, codigo: 'PD1', nombre: 'Línea Paquete Día', color: '#FD9E15' },
      });
      rutaId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
        VALUES (${rutaId}, ${linea.id}, 'ida', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA_GEOJSON}), 4326)::geography, 'activo', now(), now())
      `;
      await tx.$executeRaw`
        INSERT INTO paradas (id, "rutaId", tipo, orden, coord, "createdAt", "updatedAt")
        VALUES (${randomUUID()}, ${rutaId}, 'origen', 0, ST_SetSRID(ST_GeomFromGeoJSON(${PARADA_COORD}), 4326)::geography, now(), now())
      `;
      // Parada dada de baja (soft-delete): no debe viajar en el paquete del día.
      await tx.$executeRaw`
        INSERT INTO paradas (id, "rutaId", tipo, orden, coord, estado, "createdAt", "updatedAt")
        VALUES (${randomUUID()}, ${rutaId}, 'intermedia', 1, ST_SetSRID(ST_GeomFromGeoJSON(${PARADA_COORD}), 4326)::geography, 'inactivo', now(), now())
      `;
      await tx.$executeRaw`
        INSERT INTO puntos_control (id, "rutaId", orden, coord, "radioToleranciaM", obligatorio, "createdAt", "updatedAt")
        VALUES (${randomUUID()}, ${rutaId}, 0, ST_SetSRID(ST_GeomFromGeoJSON(${PC_COORD}), 4326)::geography, 30, true, now(), now())
      `;
      // Punto de control dado de baja (soft-delete): mismo caso que disparó el bug en
      // producción — el paquete del día no debe devolverlo (QUI-236 hotfix).
      await tx.$executeRaw`
        INSERT INTO puntos_control (id, "rutaId", orden, coord, "radioToleranciaM", obligatorio, estado, "createdAt", "updatedAt")
        VALUES (${randomUUID()}, ${rutaId}, 1, ST_SetSRID(ST_GeomFromGeoJSON(${PC_COORD}), 4326)::geography, 100, true, 'inactivo', now(), now())
      `;

      const vehiculo = await tx.vehiculo.create({
        data: {
          sindicatoId,
          placa: 'PDT001',
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
          sindicatoId,
          nombre: 'Conductor Test',
          documentoIdentidad: `PDT-${randomUUID()}`,
          licenciaConducir: 'LIC-1',
        },
      });
      const rotacion = await tx.rotacion.create({
        data: { sindicatoId, periodo: '2026-08', estado: 'publicada' },
      });

      const ahora = new Date();
      const vigente = await tx.asignacion.create({
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
      asignacionVigenteId = vigente.id;

      const vencida = await tx.asignacion.create({
        data: {
          rotacionId: rotacion.id,
          vehiculoId: vehiculo.id,
          conductorId: conductor.id,
          rutaId,
          fecha: ahora,
          horario: 'tarde',
          orden: 2,
          venceAt: new Date(ahora.getTime() - 60 * 60 * 1000),
          estado: 'vencida',
        },
      });
      asignacionVencidaId = vencida.id;

      sesion = {
        sesionId: randomUUID(),
        sindicatoId,
        asignacionId: vigente.id,
        vehiculoId: vehiculo.id,
        conductorId: conductor.id,
        deviceId: 'device-test',
      };
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.asignacion.deleteMany({ where: { id: { in: [asignacionVigenteId, asignacionVencidaId] } } });
      await tx.rotacion.deleteMany({ where: { sindicatoId } });
      await tx.vehiculo.deleteMany({ where: { sindicatoId } });
      await tx.conductor.deleteMany({ where: { sindicatoId } });
      await tx.$executeRaw`DELETE FROM puntos_control WHERE "rutaId" = ${rutaId}`;
      await tx.$executeRaw`DELETE FROM paradas WHERE "rutaId" = ${rutaId}`;
      await tx.$executeRaw`DELETE FROM rutas WHERE id = ${rutaId}`;
      await tx.linea.deleteMany({ where: { sindicatoId } });
      await tx.sindicato.delete({ where: { id: sindicatoId } });
    });
    await prisma.$disconnect();
  });

  it('devuelve la geometría de ruta, paradas y puntos de control de la asignación vigente', async () => {
    const paquete = await service.obtenerPaqueteDelDia(sesion);

    expect(paquete.asignacion.id).toBe(asignacionVigenteId);
    expect(paquete.ruta.id).toBe(rutaId);
    expect(paquete.ruta.geometria.type).toBe('LineString');
    expect(paquete.linea.color).toBe('#FD9E15');
    expect(paquete.paradas).toHaveLength(1);
    expect(paquete.paradas[0]?.tipo).toBe('origen');
    expect(paquete.puntosControl).toHaveLength(1);
    expect(paquete.puntosControl[0]?.radioToleranciaM).toBe(30);
  });

  it('excluye paradas y puntos de control dados de baja (soft-delete)', async () => {
    const paquete = await service.obtenerPaqueteDelDia(sesion);

    // Regresión del hotfix: dar de baja un punto de control (o parada) no debe hacer que
    // el conductor los siga viendo en el mapa — solo deben viajar los que siguen 'activo'.
    expect(paquete.paradas.every((p) => p.tipo !== 'intermedia')).toBe(true);
    expect(paquete.puntosControl.every((pc) => pc.radioToleranciaM !== 100)).toBe(true);
  });

  it('rechaza una sesión cuya asignación ya venció', async () => {
    const sesionVencida: SesionMovilAutenticada = { ...sesion, asignacionId: asignacionVencidaId };
    await expect(service.obtenerPaqueteDelDia(sesionVencida)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('resuelve el color de línea a un valor por defecto cuando es null', async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.linea.updateMany({ where: { sindicatoId }, data: { color: null } }),
    );
    const paquete = await service.obtenerPaqueteDelDia(sesion);
    expect(paquete.linea.color).toBe('#3226B4');
  });
});

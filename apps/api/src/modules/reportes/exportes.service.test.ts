import { randomUUID } from 'node:crypto';
import { prisma, withTenantContext } from '@quivo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { ExportesService } from './exportes.service.js';

const GEOMETRIA_GEOJSON = JSON.stringify({
  type: 'LineString',
  coordinates: [
    [-58.4, -34.6],
    [-58.39, -34.6],
  ],
});
const PC_COORD = JSON.stringify({ type: 'Point', coordinates: [-58.395, -34.6] });

async function drenar<T>(generador: AsyncGenerator<T>): Promise<T[]> {
  const filas: T[] = [];
  for await (const fila of generador) {
    filas.push(fila);
  }
  return filas;
}

describe('ExportesService', () => {
  const service = new ExportesService();
  const sindicatoId = randomUUID();
  let rutaId: string;
  let puntoControlId: string;
  let vehiculoId: string;
  let conductorId: string;
  const adminQuivo: AuthenticatedUser = { userId: 'test-admin-quivo', rol: 'admin_quivo', sindicatoId: null };

  beforeAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({ data: { id: sindicatoId, nombre: 'Exportes Test', estado: 'activo' } });
      const linea = await tx.linea.create({
        data: { sindicatoId, codigo: 'EX1', nombre: 'Línea Exportes' },
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
          sindicatoId,
          placa: 'EXP001',
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
          sindicatoId,
          nombre: 'Conductor Exportes',
          documentoIdentidad: `EXP-${randomUUID()}`,
          licenciaConducir: 'LIC-1',
        },
      });
      conductorId = conductor.id;
      const rotacion = await tx.rotacion.create({
        data: { sindicatoId, periodo: '2026-08', estado: 'publicada' },
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
          sindicatoId,
          asignacionId: asignacion.id,
          vehiculoId: vehiculo.id,
          conductorId: conductor.id,
          deviceId: 'device-export',
          inicio: ahora,
          fin: new Date(ahora.getTime() + 2 * 60 * 60 * 1000),
          estado: 'finalizada',
          accessTokenHash: randomUUID(),
          refreshTokenHash: randomUUID(),
          accessExpiresAt: new Date(ahora.getTime() + 60 * 60 * 1000),
          refreshExpiresAt: new Date(ahora.getTime() + 60 * 60 * 1000),
        },
      });

      await tx.cumplimientoPc.create({
        data: {
          eventId: randomUUID(),
          sindicatoId,
          sesionId: sesion.id,
          puntoControlId,
          ts: ahora,
          distanciaM: 10,
          cumplido: true,
          validadoPor: 'worker',
        },
      });
      await tx.cumplimientoPc.create({
        data: {
          eventId: randomUUID(),
          sindicatoId,
          sesionId: sesion.id,
          puntoControlId,
          ts: ahora,
          distanciaM: 90,
          cumplido: false,
          validadoPor: 'worker',
        },
      });

      const regla = await tx.regla.create({
        data: {
          sindicatoId,
          nombre: 'Regla Exportes',
          tipo: 'reglamentaria',
          gravedad: 'leve',
          aplicaA: 'conductor',
        },
      });
      await tx.sancion.create({
        data: {
          sindicatoId,
          reglaId: regla.id,
          sujetoTipo: 'conductor',
          sujetoId: conductor.id,
          motivo: 'Motivo de prueba',
          fechaHecho: ahora,
          estado: 'aplicada',
        },
      });
      await tx.sancion.create({
        data: {
          sindicatoId,
          reglaId: regla.id,
          sujetoTipo: 'vehiculo',
          sujetoId: vehiculo.id,
          motivo: 'Otro motivo',
          fechaHecho: ahora,
          estado: 'pendiente',
        },
      });
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sancion.deleteMany({ where: { sindicatoId } });
      await tx.regla.deleteMany({ where: { sindicatoId } });
      await tx.cumplimientoPc.deleteMany({ where: { sindicatoId } });
      await tx.sesionOperativa.deleteMany({ where: { sindicatoId } });
      await tx.asignacion.deleteMany({ where: { rutaId } });
      await tx.rotacion.deleteMany({ where: { sindicatoId } });
      await tx.vehiculo.deleteMany({ where: { sindicatoId } });
      await tx.conductor.deleteMany({ where: { sindicatoId } });
      await tx.$executeRaw`DELETE FROM puntos_control WHERE "rutaId" = ${rutaId}`;
      await tx.$executeRaw`DELETE FROM rutas WHERE id = ${rutaId}`;
      await tx.linea.deleteMany({ where: { sindicatoId } });
      await tx.sindicato.deleteMany({ where: { id: sindicatoId } });
    });
    await prisma.$disconnect();
  });

  it('recorridosPorPeriodo: rinde una fila con puntos cumplidos/totales agregados', async () => {
    const filas = await drenar(service.recorridosPorPeriodo(adminQuivo, {}));
    const fila = filas.find((f) => f[3] === 'EXP001');
    expect(fila).toBeDefined();
    expect(fila?.[2]).toBe('Línea Exportes');
    expect(fila?.[6]).toBe(1); // puntosCumplidos
    expect(fila?.[7]).toBe(2); // puntosTotales
  });

  it('sancionesPorSujetoEstado: rinde ambas sanciones sin filtro', async () => {
    const filas = await drenar(service.sancionesPorSujetoEstado(adminQuivo, {}));
    const propias = filas.filter((f) => f[1] === 'Regla Exportes');
    expect(propias).toHaveLength(2);
  });

  it('sancionesPorSujetoEstado: filtra por estado', async () => {
    const filas = await drenar(service.sancionesPorSujetoEstado(adminQuivo, { estado: 'pendiente' }));
    const propias = filas.filter((f) => f[1] === 'Regla Exportes');
    expect(propias).toHaveLength(1);
    expect(propias[0]?.[5]).toBe('pendiente');
  });

  it('sancionesPorSujetoEstado: filtra por sujetoTipo', async () => {
    const filas = await drenar(service.sancionesPorSujetoEstado(adminQuivo, { sujetoTipo: 'vehiculo' }));
    const propias = filas.filter((f) => f[1] === 'Regla Exportes');
    expect(propias).toHaveLength(1);
    expect(propias[0]?.[2]).toBe('vehiculo');
  });

  it('actividadPorVehiculoConductor: agrupa por vehículo con horas operadas y cumplimientos', async () => {
    const filas = await drenar(service.actividadPorVehiculoConductor(adminQuivo, { por: 'vehiculo' }));
    const fila = filas.find((f) => f[0] === vehiculoId);
    expect(fila).toBeDefined();
    expect(fila?.[1]).toBe('EXP001');
    expect(fila?.[2]).toBe(1); // recorridos
    expect(fila?.[3]).toBe(2); // horasOperadas (2h de sesión)
    expect(fila?.[4]).toBe(1); // puntosCumplidos
    expect(fila?.[5]).toBe(2); // puntosTotales
  });

  it('actividadPorVehiculoConductor: agrupa por conductor', async () => {
    const filas = await drenar(service.actividadPorVehiculoConductor(adminQuivo, { por: 'conductor' }));
    const fila = filas.find((f) => f[0] === conductorId);
    expect(fila).toBeDefined();
    expect(fila?.[1]).toBe('Conductor Exportes');
  });
});

import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { prisma, withTenantContext } from '@quivo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RotacionesService } from './rotaciones.service.js';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

const GEOMETRIA_GEOJSON = JSON.stringify({
  type: 'LineString',
  coordinates: [
    [-58.4, -34.6],
    [-58.39, -34.6],
  ],
});

describe('RotacionesService', () => {
  const service = new RotacionesService();
  const sindicatoAId = randomUUID();
  const sindicatoBId = randomUUID();
  let rutaAId: string;
  let rutaBId: string;
  let vehiculoA1Id: string;
  let vehiculoA2Id: string;

  const adminQuivo: AuthenticatedUser = { userId: 'test-admin-quivo', rol: 'admin_quivo', sindicatoId: null };
  const adminSindicatoA: AuthenticatedUser = {
    userId: 'test-admin-sindicato-a',
    rol: 'admin_sindicato',
    sindicatoId: sindicatoAId,
  };

  beforeAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({ data: { id: sindicatoAId, nombre: 'Rotaciones Test A', estado: 'activo' } });
      await tx.sindicato.create({ data: { id: sindicatoBId, nombre: 'Rotaciones Test B', estado: 'activo' } });

      const lineaA = await tx.linea.create({ data: { sindicatoId: sindicatoAId, codigo: 'RT1', nombre: 'Línea A' } });
      const lineaB = await tx.linea.create({ data: { sindicatoId: sindicatoBId, codigo: 'RT1', nombre: 'Línea B' } });
      rutaAId = randomUUID();
      rutaBId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
        VALUES (${rutaAId}, ${lineaA.id}, 'ida', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA_GEOJSON}), 4326)::geography, 'activo', now(), now())
      `;
      await tx.$executeRaw`
        INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
        VALUES (${rutaBId}, ${lineaB.id}, 'ida', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA_GEOJSON}), 4326)::geography, 'activo', now(), now())
      `;

      const v1 = await tx.vehiculo.create({
        data: {
          sindicatoId: sindicatoAId,
          placa: 'ROT001',
          tipo: 'bus',
          marca: 'x',
          modelo: 'x',
          color: 'x',
          capacidad: 10,
          estado: 'activo',
        },
      });
      const v2 = await tx.vehiculo.create({
        data: {
          sindicatoId: sindicatoAId,
          placa: 'ROT002',
          tipo: 'bus',
          marca: 'x',
          modelo: 'x',
          color: 'x',
          capacidad: 10,
          estado: 'activo',
        },
      });
      vehiculoA1Id = v1.id;
      vehiculoA2Id = v2.id;

      await tx.conductor.create({
        data: { sindicatoId: sindicatoAId, nombre: 'Conductor A', documentoIdentidad: 'DOC-A', licenciaConducir: 'LIC-A' },
      });
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      const sindicatoIds = { in: [sindicatoAId, sindicatoBId] };
      await tx.auditLog.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.asignacion.deleteMany({ where: { rutaId: { in: [rutaAId, rutaBId] } } });
      await tx.rotacion.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.vehiculo.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.conductor.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.$executeRaw`DELETE FROM rutas WHERE id IN (${rutaAId}, ${rutaBId})`;
      await tx.linea.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.sindicato.deleteMany({ where: { id: sindicatoIds } });
    });
    await prisma.$disconnect();
  });

  it('genera un borrador repartiendo round-robin los vehículos activos', async () => {
    const rotacion = await service.generar(adminSindicatoA, {
      periodo: '2027-01-rr',
      rutaIds: [rutaAId],
      fechas: [new Date('2027-01-05')],
      horarios: ['manana', 'tarde'],
    });

    expect(rotacion.estado).toBe('borrador');
    expect(rotacion.asignaciones).toHaveLength(2);
    const vehiculosUsados = rotacion.asignaciones.map((a) => a.vehiculoId).sort();
    expect(vehiculosUsados).toEqual([vehiculoA1Id, vehiculoA2Id].sort());
    // Fin de jornada en Bolivia (UTC-4, sin DST) = 03:59:59 UTC del día siguiente al `fecha`
    // — ver QUI-234 y apps/api/src/common/tiempo/jornada.ts.
    expect(rotacion.asignaciones[0]?.venceAt.toISOString()).toBe('2027-01-06T03:59:59.000Z');
  });

  it('deja un slot sin cubrir si el único vehículo activo ya está ocupado esa fecha/horario', async () => {
    // Sindicato dedicado con un solo vehículo activo — así el reparto se queda sin
    // alternativas cuando ese vehículo ya tiene una asignación para el slot pedido.
    const sindicatoCId = randomUUID();
    const fecha = new Date('2027-02-10');
    const { rutaCId, vehiculoCId } = await withTenantContext(
      { rol: 'admin_quivo', sindicatoId: null },
      async (tx) => {
        await tx.sindicato.create({ data: { id: sindicatoCId, nombre: 'Rotaciones Test C', estado: 'activo' } });
        const linea = await tx.linea.create({ data: { sindicatoId: sindicatoCId, codigo: 'RT1', nombre: 'Línea C' } });
        const rutaId = randomUUID();
        await tx.$executeRaw`
          INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
          VALUES (${rutaId}, ${linea.id}, 'ida', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA_GEOJSON}), 4326)::geography, 'activo', now(), now())
        `;
        const vehiculo = await tx.vehiculo.create({
          data: {
            sindicatoId: sindicatoCId,
            placa: 'ROTC01',
            tipo: 'bus',
            marca: 'x',
            modelo: 'x',
            color: 'x',
            capacidad: 10,
            estado: 'activo',
          },
        });
        return { rutaCId: rutaId, vehiculoCId: vehiculo.id };
      },
    );
    const adminSindicatoC: AuthenticatedUser = {
      userId: 'test-admin-sindicato-c',
      rol: 'admin_sindicato',
      sindicatoId: sindicatoCId,
    };

    const primera = await service.generar(adminSindicatoC, {
      periodo: '2027-02-c1',
      rutaIds: [rutaCId],
      fechas: [fecha],
      horarios: ['noche'],
    });
    expect(primera.asignaciones).toHaveLength(1);

    const segunda = await service.generar(adminSindicatoC, {
      periodo: '2027-02-c2',
      rutaIds: [rutaCId],
      fechas: [fecha],
      horarios: ['noche'],
    });
    expect(segunda.asignaciones).toHaveLength(0);

    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.asignacion.deleteMany({ where: { vehiculoId: vehiculoCId } });
      await tx.rotacion.deleteMany({ where: { sindicatoId: sindicatoCId } });
      await tx.vehiculo.deleteMany({ where: { sindicatoId: sindicatoCId } });
      await tx.$executeRaw`DELETE FROM rutas WHERE id = ${rutaCId}`;
      await tx.linea.deleteMany({ where: { sindicatoId: sindicatoCId } });
      await tx.sindicato.delete({ where: { id: sindicatoCId } });
    });
  });

  it('el conflicto de unicidad hace que el reparto pruebe el siguiente vehículo, no que falle', async () => {
    const fecha = new Date('2027-03-01');
    const rotacionOcupante = await service.generar(adminSindicatoA, {
      periodo: '2027-03-ocupante',
      rutaIds: [rutaAId],
      fechas: [fecha],
      horarios: ['manana'],
    });
    // El reparto round-robin empezó en vehiculoA1 para esta rotación (arrancó "limpio" en
    // el índice global del proceso) — lo importante es que ocupó exactamente un vehículo.
    expect(rotacionOcupante.asignaciones).toHaveLength(1);
    const vehiculoOcupado = rotacionOcupante.asignaciones[0]!.vehiculoId;

    // Genera una segunda rotación para la misma fecha/horario: el vehículo ya ocupado debe
    // quedar excluido y la asignación debe caer en el otro vehículo activo.
    const rotacionNueva = await service.generar(adminSindicatoA, {
      periodo: '2027-03-nueva',
      rutaIds: [rutaAId],
      fechas: [fecha],
      horarios: ['manana'],
    });
    expect(rotacionNueva.asignaciones).toHaveLength(1);
    expect(rotacionNueva.asignaciones[0]?.vehiculoId).not.toBe(vehiculoOcupado);
  });

  it('cada vehículo cubre al menos una vez cada ruta pedida, sin inflar el total de asignaciones (modelo Línea 120)', async () => {
    const sindicatoDId = randomUUID();
    const fechaUno = new Date('2027-02-20');
    const fechaDos = new Date('2027-02-21');
    const { rutaD1Id, rutaD2Id, vehiculoD1Id, vehiculoD2Id } = await withTenantContext(
      { rol: 'admin_quivo', sindicatoId: null },
      async (tx) => {
        await tx.sindicato.create({ data: { id: sindicatoDId, nombre: 'Rotaciones Test D', estado: 'activo' } });
        const linea = await tx.linea.create({ data: { sindicatoId: sindicatoDId, codigo: '120', nombre: 'Línea 120' } });
        const rutaD1 = randomUUID();
        const rutaD2 = randomUUID();
        await tx.$executeRaw`
          INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
          VALUES (${rutaD1}, ${linea.id}, 'ida', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA_GEOJSON}), 4326)::geography, 'activo', now(), now())
        `;
        await tx.$executeRaw`
          INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
          VALUES (${rutaD2}, ${linea.id}, 'ida', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA_GEOJSON}), 4326)::geography, 'activo', now(), now())
        `;
        const v1 = await tx.vehiculo.create({
          data: {
            sindicatoId: sindicatoDId,
            placa: 'ROTD01',
            tipo: 'bus',
            marca: 'x',
            modelo: 'x',
            color: 'x',
            capacidad: 10,
            estado: 'activo',
          },
        });
        const v2 = await tx.vehiculo.create({
          data: {
            sindicatoId: sindicatoDId,
            placa: 'ROTD02',
            tipo: 'bus',
            marca: 'x',
            modelo: 'x',
            color: 'x',
            capacidad: 10,
            estado: 'activo',
          },
        });
        return { rutaD1Id: rutaD1, rutaD2Id: rutaD2, vehiculoD1Id: v1.id, vehiculoD2Id: v2.id };
      },
    );
    const adminSindicatoD: AuthenticatedUser = {
      userId: 'test-admin-sindicato-d',
      rol: 'admin_sindicato',
      sindicatoId: sindicatoDId,
    };

    const rotacion = await service.generar(adminSindicatoD, {
      periodo: '2027-02-linea120',
      rutaIds: [rutaD1Id, rutaD2Id],
      fechas: [fechaUno, fechaDos],
      horarios: ['manana', 'tarde'],
    });

    // 2 fechas × 2 horarios × 2 rutas = 8 slots, cada uno con exactamente un vehículo — el
    // total de asignaciones no cambia por agregar la preferencia de cobertura.
    expect(rotacion.asignaciones).toHaveLength(8);
    expect(rotacion.sinCobertura).toEqual([]);

    const rutasPorVehiculo = new Map<string, Set<string>>([
      [vehiculoD1Id, new Set()],
      [vehiculoD2Id, new Set()],
    ]);
    for (const a of rotacion.asignaciones) {
      rutasPorVehiculo.get(a.vehiculoId)?.add(a.rutaId);
    }
    expect(rutasPorVehiculo.get(vehiculoD1Id)).toEqual(new Set([rutaD1Id, rutaD2Id]));
    expect(rutasPorVehiculo.get(vehiculoD2Id)).toEqual(new Set([rutaD1Id, rutaD2Id]));

    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.asignacion.deleteMany({ where: { vehiculoId: { in: [vehiculoD1Id, vehiculoD2Id] } } });
      await tx.rotacion.deleteMany({ where: { sindicatoId: sindicatoDId } });
      await tx.vehiculo.deleteMany({ where: { sindicatoId: sindicatoDId } });
      await tx.$executeRaw`DELETE FROM rutas WHERE id IN (${rutaD1Id}, ${rutaD2Id})`;
      await tx.linea.deleteMany({ where: { sindicatoId: sindicatoDId } });
      await tx.sindicato.delete({ where: { id: sindicatoDId } });
    });
  });

  it('reporta en sinCobertura la ruta que un vehículo no llegó a cubrir por falta de slots libres', async () => {
    const sindicatoEId = randomUUID();
    const fecha = new Date('2027-02-22');
    const { rutaE1Id, rutaE2Id, vehiculoE1Id } = await withTenantContext(
      { rol: 'admin_quivo', sindicatoId: null },
      async (tx) => {
        await tx.sindicato.create({ data: { id: sindicatoEId, nombre: 'Rotaciones Test E', estado: 'activo' } });
        const linea = await tx.linea.create({ data: { sindicatoId: sindicatoEId, codigo: '120', nombre: 'Línea 120' } });
        const rutaE1 = randomUUID();
        const rutaE2 = randomUUID();
        await tx.$executeRaw`
          INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
          VALUES (${rutaE1}, ${linea.id}, 'ida', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA_GEOJSON}), 4326)::geography, 'activo', now(), now())
        `;
        await tx.$executeRaw`
          INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
          VALUES (${rutaE2}, ${linea.id}, 'ida', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA_GEOJSON}), 4326)::geography, 'activo', now(), now())
        `;
        const v1 = await tx.vehiculo.create({
          data: {
            sindicatoId: sindicatoEId,
            placa: 'ROTE01',
            tipo: 'bus',
            marca: 'x',
            modelo: 'x',
            color: 'x',
            capacidad: 10,
            estado: 'activo',
          },
        });
        return { rutaE1Id: rutaE1, rutaE2Id: rutaE2, vehiculoE1Id: v1.id };
      },
    );
    const adminSindicatoE: AuthenticatedUser = {
      userId: 'test-admin-sindicato-e',
      rol: 'admin_sindicato',
      sindicatoId: sindicatoEId,
    };

    // Un solo vehículo, un solo horario: solo hay un slot disponible para dos rutas — como
    // mucho una de las dos queda cubierta en este período.
    const rotacion = await service.generar(adminSindicatoE, {
      periodo: '2027-02-e-sincov',
      rutaIds: [rutaE1Id, rutaE2Id],
      fechas: [fecha],
      horarios: ['noche'],
    });

    expect(rotacion.asignaciones).toHaveLength(1);
    expect(rotacion.sinCobertura).toEqual([{ vehiculoId: vehiculoE1Id, rutaId: rutaE2Id }]);

    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.asignacion.deleteMany({ where: { vehiculoId: vehiculoE1Id } });
      await tx.rotacion.deleteMany({ where: { sindicatoId: sindicatoEId } });
      await tx.vehiculo.deleteMany({ where: { sindicatoId: sindicatoEId } });
      await tx.$executeRaw`DELETE FROM rutas WHERE id IN (${rutaE1Id}, ${rutaE2Id})`;
      await tx.linea.deleteMany({ where: { sindicatoId: sindicatoEId } });
      await tx.sindicato.delete({ where: { id: sindicatoEId } });
    });
  });

  it('con configHorarios genera varias salidas espaciadas por headway, cicladas entre rutas, con hora de presentación', async () => {
    const sindicatoFId = randomUUID();
    const fecha = new Date('2027-02-23');
    const { rutaF1Id, rutaF2Id, vehiculoIds } = await withTenantContext(
      { rol: 'admin_quivo', sindicatoId: null },
      async (tx) => {
        await tx.sindicato.create({ data: { id: sindicatoFId, nombre: 'Rotaciones Test F', estado: 'activo' } });
        const linea = await tx.linea.create({ data: { sindicatoId: sindicatoFId, codigo: '120', nombre: 'Línea 120' } });
        const rutaF1 = randomUUID();
        const rutaF2 = randomUUID();
        await tx.$executeRaw`
          INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
          VALUES (${rutaF1}, ${linea.id}, 'ida', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA_GEOJSON}), 4326)::geography, 'activo', now(), now())
        `;
        await tx.$executeRaw`
          INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
          VALUES (${rutaF2}, ${linea.id}, 'ida', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA_GEOJSON}), 4326)::geography, 'activo', now(), now())
        `;
        const placas = ['ROTF01', 'ROTF02', 'ROTF03'];
        const ids: string[] = [];
        for (const placa of placas) {
          const v = await tx.vehiculo.create({
            data: {
              sindicatoId: sindicatoFId,
              placa,
              tipo: 'bus',
              marca: 'x',
              modelo: 'x',
              color: 'x',
              capacidad: 10,
              estado: 'activo',
            },
          });
          ids.push(v.id);
        }
        return { rutaF1Id: rutaF1, rutaF2Id: rutaF2, vehiculoIds: ids };
      },
    );
    const adminSindicatoF: AuthenticatedUser = {
      userId: 'test-admin-sindicato-f',
      rol: 'admin_sindicato',
      sindicatoId: sindicatoFId,
    };

    const rotacion = await service.generar(adminSindicatoF, {
      periodo: '2027-02-headway',
      rutaIds: [rutaF1Id, rutaF2Id],
      fechas: [fecha],
      horarios: ['manana'],
      configHorarios: {
        manana: { horaInicio: '05:30', horaFin: '05:40', headwayMinutos: 5, bufferPresentacionMinutos: 10 },
      },
    });

    // 05:30, 05:35, 05:40 → 3 salidas, una por cada vehículo activo (headway corto = hora
    // pico, más trufis seguidos), cicladas entre las 2 rutas.
    expect(rotacion.asignaciones).toHaveLength(3);
    const vehiculosUsados = new Set(rotacion.asignaciones.map((a) => a.vehiculoId));
    expect(vehiculosUsados.size).toBe(3);

    const ordenadas = [...rotacion.asignaciones].sort(
      (a, b) => a.horaSalida!.getTime() - b.horaSalida!.getTime(),
    );
    // Bolivia UTC-4: 05:30 local → 09:30Z, buffer de 10 min → presentación 09:20Z.
    expect(ordenadas[0]?.horaSalida?.toISOString()).toBe('2027-02-23T09:30:00.000Z');
    expect(ordenadas[0]?.horaPresentacion?.toISOString()).toBe('2027-02-23T09:20:00.000Z');
    expect(ordenadas[1]?.horaSalida?.toISOString()).toBe('2027-02-23T09:35:00.000Z');
    expect(ordenadas[2]?.horaSalida?.toISOString()).toBe('2027-02-23T09:40:00.000Z');
    // Cicladas entre las 2 rutas en orden: F1, F2, F1.
    expect(ordenadas.map((a) => a.rutaId)).toEqual([rutaF1Id, rutaF2Id, rutaF1Id]);

    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.asignacion.deleteMany({ where: { vehiculoId: { in: vehiculoIds } } });
      await tx.rotacion.deleteMany({ where: { sindicatoId: sindicatoFId } });
      await tx.vehiculo.deleteMany({ where: { sindicatoId: sindicatoFId } });
      await tx.$executeRaw`DELETE FROM rutas WHERE id IN (${rutaF1Id}, ${rutaF2Id})`;
      await tx.linea.deleteMany({ where: { sindicatoId: sindicatoFId } });
      await tx.sindicato.delete({ where: { id: sindicatoFId } });
    });
  });

  it('sin configHorarios para ese horario, horaSalida/horaPresentacion quedan null (comportamiento previo)', async () => {
    const rotacion = await service.generar(adminSindicatoA, {
      periodo: '2027-02-sinhw',
      rutaIds: [rutaAId],
      fechas: [new Date('2027-02-24')],
      horarios: ['manana'],
    });
    expect(rotacion.asignaciones[0]?.horaSalida).toBeNull();
    expect(rotacion.asignaciones[0]?.horaPresentacion).toBeNull();
  });

  it('rechaza rutas que no son del tenant del actor', async () => {
    await expect(
      service.generar(adminSindicatoA, {
        periodo: '2027-04-cross',
        rutaIds: [rutaBId],
        fechas: [new Date('2027-04-01')],
        horarios: ['manana'],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('publica una rotación con asignaciones y no permite publicarla dos veces', async () => {
    const rotacion = await service.generar(adminSindicatoA, {
      periodo: '2027-05-publicar',
      rutaIds: [rutaAId],
      fechas: [new Date('2027-05-01')],
      horarios: ['manana'],
    });
    const publicada = await service.publicar(adminSindicatoA, rotacion.id);
    expect(publicada.estado).toBe('publicada');

    await expect(service.publicar(adminSindicatoA, rotacion.id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('no permite publicar una rotación sin asignaciones', async () => {
    const rotacion = await service.generar(adminSindicatoA, {
      periodo: '2027-06-vacia',
      rutaIds: [rutaAId],
      fechas: [new Date('2027-06-01')],
      horarios: ['manana'],
    });
    // Vaciar a mano para simular el caso "0 asignaciones" (todas rechazadas por conflicto).
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.asignacion.deleteMany({ where: { rotacionId: rotacion.id } }),
    );
    await expect(service.publicar(adminSindicatoA, rotacion.id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('anula una rotación publicada (vuelve a borrador) y no anula una que ya está en borrador', async () => {
    const rotacion = await service.generar(adminSindicatoA, {
      periodo: '2027-07-anular',
      rutaIds: [rutaAId],
      fechas: [new Date('2027-07-01')],
      horarios: ['manana'],
    });
    await service.publicar(adminSindicatoA, rotacion.id);
    const anulada = await service.anular(adminSindicatoA, rotacion.id);
    expect(anulada.estado).toBe('borrador');

    await expect(service.anular(adminSindicatoA, rotacion.id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('permite crear, editar y eliminar asignaciones a mano mientras la rotación está en borrador', async () => {
    const rotacion = await service.generar(adminSindicatoA, {
      periodo: '2027-08-manual',
      rutaIds: [rutaAId],
      fechas: [new Date('2027-08-01')],
      horarios: ['manana'],
    });

    const creada = await service.crearAsignacion(adminSindicatoA, rotacion.id, {
      vehiculoId: vehiculoA1Id,
      rutaId: rutaAId,
      fecha: new Date('2027-08-01'),
      horario: 'tarde',
      orden: 2,
    });
    expect(creada.horario).toBe('tarde');

    const editada = await service.actualizarAsignacion(adminSindicatoA, rotacion.id, creada.id, { orden: 3 });
    expect(editada.orden).toBe(3);

    await service.eliminarAsignacion(adminSindicatoA, rotacion.id, creada.id);
    const detalle = await service.obtener(adminSindicatoA, rotacion.id);
    expect(detalle.asignaciones.find((a) => a.id === creada.id)).toBeUndefined();
  });

  it('no permite editar asignaciones de una rotación ya publicada', async () => {
    const rotacion = await service.generar(adminSindicatoA, {
      periodo: '2027-09-publicada',
      rutaIds: [rutaAId],
      fechas: [new Date('2027-09-01')],
      horarios: ['manana'],
    });
    await service.publicar(adminSindicatoA, rotacion.id);

    await expect(
      service.crearAsignacion(adminSindicatoA, rotacion.id, {
        vehiculoId: vehiculoA1Id,
        rutaId: rutaAId,
        fecha: new Date('2027-09-01'),
        horario: 'tarde',
        orden: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('traduce el conflicto de unicidad al editar una asignación a un conflicto 409', async () => {
    const rotacion = await service.generar(adminSindicatoA, {
      periodo: '2027-10-conflicto',
      rutaIds: [rutaAId],
      fechas: [new Date('2027-10-01')],
      horarios: ['manana', 'tarde'],
    });
    const [primera, segunda] = rotacion.asignaciones;
    await expect(
      service.actualizarAsignacion(adminSindicatoA, rotacion.id, segunda!.id, {
        vehiculoId: primera!.vehiculoId,
        horario: primera!.horario,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('admin_quivo puede generar rotaciones para el sindicato que indique en el body', async () => {
    const rotacion = await service.generar(adminQuivo, {
      sindicatoId: sindicatoAId,
      periodo: '2027-11-admin-quivo',
      rutaIds: [rutaAId],
      fechas: [new Date('2027-11-01')],
      horarios: ['manana'],
    });
    expect(rotacion.sindicatoId).toBe(sindicatoAId);
  });

  describe('marcarVencidas (QUI-234)', () => {
    it('marca vencida solo la asignación cuyo venceAt ya pasó, no la futura', async () => {
      const rotacion = await service.generar(adminSindicatoA, {
        periodo: '2027-12-vencimiento',
        rutaIds: [rutaAId],
        fechas: [new Date('2020-01-01'), new Date('2099-01-01')],
        horarios: ['noche'],
      });
      const [vencida, vigente] = rotacion.asignaciones;
      expect(vencida?.estado).toBe('vigente');
      expect(vigente?.estado).toBe('vigente');

      // `venceAt` de la primera (fecha 2020-01-01) ya pasó hace años; la segunda
      // (2099-01-01) no va a pasar en la vida útil de este repo.
      const marcadas = await service.marcarVencidas();
      expect(marcadas).toBeGreaterThanOrEqual(1);

      const detalle = await service.obtener(adminSindicatoA, rotacion.id);
      const vencidaActualizada = detalle.asignaciones.find((a) => a.id === vencida!.id);
      const vigenteActualizada = detalle.asignaciones.find((a) => a.id === vigente!.id);
      expect(vencidaActualizada?.estado).toBe('vencida');
      expect(vigenteActualizada?.estado).toBe('vigente');
    });

    it('es idempotente — correrlo de nuevo no cambia nada ya marcado', async () => {
      const primera = await service.marcarVencidas();
      const segunda = await service.marcarVencidas();
      expect(segunda).toBeLessThanOrEqual(primera);
    });
  });

  describe('cerrarSesionesVencidas (sesiones zombi)', () => {
    const HORA_MS = 60 * 60 * 1000;

    async function crearSesion(venceAt: Date, ultimoFix: Date | null, placa: string) {
      return withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
        const vehiculo = await tx.vehiculo.create({
          data: { sindicatoId: sindicatoAId, placa, tipo: 'bus', marca: 'x', modelo: 'x', color: 'x', capacidad: 10, estado: 'activo' },
        });
        const conductor = await tx.conductor.create({
          data: { sindicatoId: sindicatoAId, nombre: placa, documentoIdentidad: `DOC-${placa}`, licenciaConducir: 'L' },
        });
        const rotacion = await tx.rotacion.create({ data: { sindicatoId: sindicatoAId, periodo: `zombi-${placa}`, estado: 'publicada' } });
        const asignacion = await tx.asignacion.create({
          data: {
            rotacionId: rotacion.id, vehiculoId: vehiculo.id, conductorId: conductor.id, rutaId: rutaAId,
            fecha: new Date('2020-01-01'), horario: 'manana', orden: 1, venceAt, estado: 'vencida',
          },
        });
        const sesion = await tx.sesionOperativa.create({
          data: {
            sindicatoId: sindicatoAId, asignacionId: asignacion.id, vehiculoId: vehiculo.id, conductorId: conductor.id,
            inicio: new Date(venceAt.getTime() - 8 * HORA_MS), deviceId: `dev-${placa}`, accessTokenHash: `a-${randomUUID()}`, refreshTokenHash: `r-${randomUUID()}`,
            accessExpiresAt: new Date(Date.now() + HORA_MS), refreshExpiresAt: new Date(Date.now() + HORA_MS),
          },
        });
        if (ultimoFix) {
          await tx.$executeRaw`
            INSERT INTO gps_sesion_resumen (sesion_id, jornada, "sindicatoId", total_puntos, ultimo_fix_ts, ultimo_ingreso_ts, lat, lng)
            VALUES (${sesion.id}::uuid, ${ultimoFix.toISOString().slice(0, 10)}::date, ${sindicatoAId}, 1, ${ultimoFix}, ${ultimoFix}, 0, 0)
          `;
        }
        return sesion.id;
      });
    }

    const estadoDe = (id: string) =>
      withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
        tx.sesionOperativa.findUniqueOrThrow({ where: { id }, select: { estado: true, fin: true, revokedAt: true } }),
      );

    afterAll(async () => {
      await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
        await tx.$executeRaw`DELETE FROM gps_sesion_resumen WHERE "sindicatoId" = ${sindicatoAId}`;
        await tx.sesionOperativa.deleteMany({ where: { sindicatoId: sindicatoAId } }); // cascada a fila_salida
      });
    });

    // Las aserciones miran SOLO las sesiones creadas acá: otros archivos corren en paralelo contra la misma DB.
    it('no cierra un turno nocturno con GPS reciente ni una asignación vencida hace menos de 4 h', async () => {
      const ahora = new Date();
      const nocturna = await crearSesion(new Date(ahora.getTime() - 24 * HORA_MS), new Date(ahora.getTime() - 30 * 60 * 1000), 'ZMB001');
      const entre2y4h = await crearSesion(new Date(ahora.getTime() - 3 * HORA_MS), null, 'ZMB002');
      const vigente = await crearSesion(new Date(ahora.getTime() + HORA_MS), null, 'ZMB003');

      await service.cerrarSesionesVencidas(ahora);

      for (const id of [nocturna, entre2y4h, vigente]) {
        expect((await estadoDe(id)).estado).toBe('activa');
      }
    });

    it('cierra la sesión vencida hace más de 4 h sin actividad y retira su fila de salida; es idempotente', async () => {
      const ahora = new Date();
      const vieja = new Date(ahora.getTime() - 24 * HORA_MS);
      const zombi = await crearSesion(vieja, null, 'ZMB004');
      const ultimaActividad = new Date(vieja.getTime() + HORA_MS);
      const zombiActividadVieja = await crearSesion(vieja, ultimaActividad, 'ZMB005');
      const filaId = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
        const puntoId = randomUUID();
        await tx.$executeRaw`
          INSERT INTO puntos_control (id, "rutaId", orden, coord, "radioToleranciaM", obligatorio, estado, "createdAt", "updatedAt")
          VALUES (${puntoId}, ${rutaAId}, 1, ST_SetSRID(ST_MakePoint(-58.4, -34.6), 4326)::geography, 30, true, 'activo', now(), now())
        `;
        const sesion = await tx.sesionOperativa.findUniqueOrThrow({ where: { id: zombi }, select: { vehiculoId: true } });
        const fila = await tx.filaSalida.create({
          data: { sindicatoId: sindicatoAId, puntoControlId: puntoId, fecha: vieja, sesionId: zombi, vehiculoId: sesion.vehiculoId, llegadaTs: vieja, ordenTs: vieja },
        });
        return fila.id;
      });

      await service.cerrarSesionesVencidas(ahora);

      for (const id of [zombi, zombiActividadVieja]) {
        const s = await estadoDe(id);
        expect(s.estado).toBe('cerrada');
        expect(s.fin).not.toBeNull();
        expect(s.revokedAt).not.toBeNull();
      }
      // fin = fin real: última actividad GPS; sin GPS, el venceAt de la asignación.
      expect((await estadoDe(zombi)).fin).toEqual(vieja);
      expect((await estadoDe(zombiActividadVieja)).fin).toEqual(ultimaActividad);
      const filaDe = () =>
        withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
          tx.filaSalida.findUniqueOrThrow({ where: { id: filaId }, select: { estado: true } }),
        );
      expect((await filaDe()).estado).toBe('retirado');

      // Segunda corrida: las filas ya cerradas no cambian (fin/revokedAt intactos).
      const antes = await estadoDe(zombi);
      await service.cerrarSesionesVencidas(new Date(ahora.getTime() + 60_000));
      expect(await estadoDe(zombi)).toEqual(antes);
    });
  });
});

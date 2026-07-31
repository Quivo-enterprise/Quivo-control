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
});

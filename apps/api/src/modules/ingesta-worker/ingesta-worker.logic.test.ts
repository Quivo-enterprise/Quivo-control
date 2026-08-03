import { randomUUID } from 'node:crypto';
import { prisma, withTenantContext } from '@quivo/db';
import type { EventoSync } from '@quivo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  agruparPorTipo,
  insertarEventoOperativoEnTx,
  insertarGpsPoints,
  procesarCumplimientoEnTx,
} from './ingesta-worker.service.js';

const GEOMETRIA_GEOJSON = JSON.stringify({
  type: 'LineString',
  coordinates: [
    [-63.18, -17.78],
    [-63.17, -17.78],
  ],
});
// Punto de control en (-63.18, -17.78), radio 30m.
const PC_COORD = JSON.stringify({ type: 'Point', coordinates: [-63.18, -17.78] });

function evento(overrides: Partial<EventoSync> = {}): EventoSync {
  return {
    eventId: '018e6e6a-0000-7000-8000-000000000000',
    deviceId: 'device-test',
    ts: new Date().toISOString(),
    tipo: 'gps_point',
    payload: {},
    ...overrides,
  };
}

describe('IngestaWorkerService — lógica de procesamiento por tipo', () => {
  const sindicatoId = randomUUID();
  const sindicatoOtroId = randomUUID();
  let rutaId: string;
  let puntoControlId: string;
  let rutaOtroId: string;
  let puntoControlOtroId: string;
  let sesionId: string;

  beforeAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({ data: { id: sindicatoId, nombre: 'Ingesta Worker Test', estado: 'activo' } });
      await tx.sindicato.create({ data: { id: sindicatoOtroId, nombre: 'Ingesta Worker Test — Otro', estado: 'activo' } });
      const linea = await tx.linea.create({ data: { sindicatoId, codigo: 'IW1', nombre: 'Línea Ingesta' } });
      const lineaOtro = await tx.linea.create({ data: { sindicatoId: sindicatoOtroId, codigo: 'IW1', nombre: 'Línea Otro' } });
      rutaId = randomUUID();
      rutaOtroId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
        VALUES (${rutaId}, ${linea.id}, 'ida', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA_GEOJSON}), 4326)::geography, 'activo', now(), now())
      `;
      await tx.$executeRaw`
        INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
        VALUES (${rutaOtroId}, ${lineaOtro.id}, 'ida', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA_GEOJSON}), 4326)::geography, 'activo', now(), now())
      `;
      puntoControlId = randomUUID();
      puntoControlOtroId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO puntos_control (id, "rutaId", orden, coord, "radioToleranciaM", obligatorio, "createdAt", "updatedAt")
        VALUES (${puntoControlOtroId}, ${rutaOtroId}, 0, ST_SetSRID(ST_GeomFromGeoJSON(${PC_COORD}), 4326)::geography, 30, true, now(), now())
      `;
      await tx.$executeRaw`
        INSERT INTO puntos_control (id, "rutaId", orden, coord, "radioToleranciaM", obligatorio, "createdAt", "updatedAt")
        VALUES (${puntoControlId}, ${rutaId}, 0, ST_SetSRID(ST_GeomFromGeoJSON(${PC_COORD}), 4326)::geography, 30, true, now(), now())
      `;

      const vehiculo = await tx.vehiculo.create({
        data: { sindicatoId, placa: 'IWT001', tipo: 'bus', marca: 'x', modelo: 'x', color: 'x', capacidad: 10, estado: 'activo' },
      });
      const conductor = await tx.conductor.create({
        data: { sindicatoId, nombre: 'Conductor Test', documentoIdentidad: `IWT-${randomUUID()}`, licenciaConducir: 'LIC-1' },
      });
      const rotacion = await tx.rotacion.create({ data: { sindicatoId, periodo: '2026-08', estado: 'publicada' } });
      const asignacion = await tx.asignacion.create({
        data: {
          rotacionId: rotacion.id,
          vehiculoId: vehiculo.id,
          conductorId: conductor.id,
          rutaId,
          fecha: new Date(),
          horario: 'manana',
          orden: 1,
          venceAt: new Date(Date.now() + 60 * 60 * 1000),
          estado: 'vigente',
        },
      });
      const sesion = await tx.sesionOperativa.create({
        data: {
          sindicatoId,
          asignacionId: asignacion.id,
          vehiculoId: vehiculo.id,
          conductorId: conductor.id,
          deviceId: 'device-test',
          accessTokenHash: randomUUID(),
          refreshTokenHash: randomUUID(),
          accessExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
          refreshExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      sesionId = sesion.id;
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.cumplimientoPc.deleteMany({ where: { sindicatoId } });
      await tx.eventoOperativo.deleteMany({ where: { sindicatoId } });
      await tx.$executeRaw`DELETE FROM gps_points WHERE sesion_id = ${sesionId}::uuid`;
      await tx.sesionOperativa.deleteMany({ where: { sindicatoId } });
      await tx.asignacion.deleteMany({ where: { rutaId } });
      await tx.rotacion.deleteMany({ where: { sindicatoId } });
      await tx.vehiculo.deleteMany({ where: { sindicatoId } });
      await tx.conductor.deleteMany({ where: { sindicatoId } });
      await tx.$executeRaw`DELETE FROM puntos_control WHERE "rutaId" IN (${rutaId}, ${rutaOtroId})`;
      await tx.$executeRaw`DELETE FROM rutas WHERE id IN (${rutaId}, ${rutaOtroId})`;
      await tx.linea.deleteMany({ where: { sindicatoId: { in: [sindicatoId, sindicatoOtroId] } } });
      await tx.sindicato.delete({ where: { id: sindicatoId } });
      await tx.sindicato.delete({ where: { id: sindicatoOtroId } });
    });
    await prisma.$disconnect();
  });

  it('agruparPorTipo separa los eventos por su tipo de outbox', () => {
    const eventos = [
      evento({ eventId: randomUUID(), tipo: 'gps_point' }),
      evento({ eventId: randomUUID(), tipo: 'cumplimiento_punto_control' }),
      evento({ eventId: randomUUID(), tipo: 'observacion' }),
    ];
    const grupos = agruparPorTipo(eventos);
    expect(grupos.gps_point).toHaveLength(1);
    expect(grupos.cumplimiento_punto_control).toHaveLength(1);
    expect(grupos.observacion).toHaveLength(1);
    expect(grupos.inicio_recorrido).toHaveLength(0);
  });

  it('inserta puntos GPS de forma idempotente por event_id+ts', async () => {
    const eventId = randomUUID();
    const ts = new Date().toISOString();
    const eventoGps = evento({
      eventId,
      ts,
      tipo: 'gps_point',
      payload: { sesionId, lat: -17.78, lng: -63.18, accuracy: 5, speed: 10 },
    });

    await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) => insertarGpsPoints(tx, [eventoGps]));
    // Reenviar el mismo evento (mismo event_id+ts) no debe duplicar la fila.
    await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) => insertarGpsPoints(tx, [eventoGps]));

    const filas = await prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) as total FROM gps_points WHERE event_id = ${eventId}::uuid
    `;
    expect(Number(filas[0]!.total)).toBe(1);
  });

  it('valida server-side un cumplimiento dentro del radio de tolerancia', async () => {
    const eventoCumplimiento = evento({
      eventId: randomUUID(),
      tipo: 'cumplimiento_punto_control',
      payload: { sesionId, puntoControlId, lat: -17.78, lng: -63.18 },
    });

    await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      procesarCumplimientoEnTx(tx, sindicatoId, eventoCumplimiento),
    );

    const registro = await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      tx.cumplimientoPc.findFirst({ where: { sesionId, puntoControlId } }),
    );
    expect(registro?.cumplido).toBe(true);
    expect(registro?.validadoPor).toBe('worker');
    expect(registro?.distanciaM).toBeLessThan(5);
  });

  it('marca no cumplido un punto de control fuera del radio, aunque el app haya reportado que sí', async () => {
    const eventoCumplimiento = evento({
      eventId: randomUUID(),
      tipo: 'cumplimiento_punto_control',
      // ~1km de distancia real, aunque el payload venga marcado como si el app lo hubiera
      // detectado — el worker es la fuente de verdad, no confía en el reporte del cliente.
      payload: { sesionId, puntoControlId, lat: -17.79, lng: -63.18 },
    });

    await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      procesarCumplimientoEnTx(tx, sindicatoId, eventoCumplimiento),
    );

    const registros = await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      tx.cumplimientoPc.findMany({ where: { sesionId, puntoControlId } }),
    );
    const ultimo = registros[registros.length - 1];
    expect(ultimo?.cumplido).toBe(false);
    expect(ultimo?.distanciaM).toBeGreaterThan(30);
  });

  it('rechaza un cumplimiento contra un punto de control inexistente', async () => {
    const eventoCumplimiento = evento({
      eventId: randomUUID(),
      tipo: 'cumplimiento_punto_control',
      payload: { sesionId, puntoControlId: randomUUID(), lat: -17.78, lng: -63.18 },
    });

    await expect(
      withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
        procesarCumplimientoEnTx(tx, sindicatoId, eventoCumplimiento),
      ),
    ).rejects.toThrow('no encontrado');
  });

  it('rechaza un cumplimiento contra un punto de control de OTRO sindicato (puntos_control no tiene RLS propia)', async () => {
    const eventoCumplimiento = evento({
      eventId: randomUUID(),
      tipo: 'cumplimiento_punto_control',
      // `puntoControlOtroId` existe de verdad, pero pertenece a `sindicatoOtroId` — sin el
      // join de tenant en `procesarCumplimientoEnTx`, esto pasaría igual (la tabla es
      // legible por cualquier actor, RLS no aplica acá).
      payload: { sesionId, puntoControlId: puntoControlOtroId, lat: -17.78, lng: -63.18 },
    });

    await expect(
      withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
        procesarCumplimientoEnTx(tx, sindicatoId, eventoCumplimiento),
      ),
    ).rejects.toThrow('no encontrado');
  });

  it('reenviar el mismo cumplimiento (mismo event_id) no duplica la fila — idempotencia RF-72', async () => {
    const eventoCumplimiento = evento({
      eventId: randomUUID(),
      tipo: 'cumplimiento_punto_control',
      payload: { sesionId, puntoControlId, lat: -17.78, lng: -63.18 },
    });

    await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      procesarCumplimientoEnTx(tx, sindicatoId, eventoCumplimiento),
    );
    // Reenvío del mismo lote (comportamiento esperado del cliente ante un timeout, QUI-240).
    await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      procesarCumplimientoEnTx(tx, sindicatoId, eventoCumplimiento),
    );

    const registros = await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      tx.cumplimientoPc.findMany({ where: { eventId: eventoCumplimiento.eventId } }),
    );
    expect(registros).toHaveLength(1);
  });

  it('inserta un evento operativo genérico (inicio_recorrido/fin_recorrido/observacion)', async () => {
    const eventoObservacion = evento({
      eventId: randomUUID(),
      tipo: 'observacion',
      payload: { sesionId, texto: 'Desvío por corte de calle' },
    });

    await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      insertarEventoOperativoEnTx(tx, sindicatoId, eventoObservacion),
    );

    const registro = await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      tx.eventoOperativo.findFirst({ where: { eventId: eventoObservacion.eventId } }),
    );
    expect(registro).not.toBeNull();
    expect((registro?.payload as { texto: string }).texto).toBe('Desvío por corte de calle');
  });

  it('reenviar el mismo evento operativo (mismo event_id) no duplica la fila — idempotencia RF-72', async () => {
    const eventoObservacion = evento({
      eventId: randomUUID(),
      tipo: 'observacion',
      payload: { sesionId, texto: 'Reenvío de prueba' },
    });

    await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      insertarEventoOperativoEnTx(tx, sindicatoId, eventoObservacion),
    );
    await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      insertarEventoOperativoEnTx(tx, sindicatoId, eventoObservacion),
    );

    const registros = await withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
      tx.eventoOperativo.findMany({ where: { eventId: eventoObservacion.eventId } }),
    );
    expect(registros).toHaveLength(1);
  });

  it('rechaza un evento operativo sin sesionId en el payload', async () => {
    const eventoInvalido = evento({ eventId: randomUUID(), tipo: 'observacion', payload: {} });

    await expect(
      withTenantContext({ rol: 'admin_quivo', sindicatoId }, (tx) =>
        insertarEventoOperativoEnTx(tx, sindicatoId, eventoInvalido),
      ),
    ).rejects.toThrow('sin sesionId');
  });
});

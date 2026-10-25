import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { prisma, withTenantContext } from '@quivo/db';
import { fechaActualBolivia, type EventoSync, type SancionarInfraccion } from '@quivo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { InfraccionesService } from '../infracciones/infracciones.service.js';
import { SancionesService } from '../reglas/sanciones.service.js';
import { EnVivoService } from '../reportes/en-vivo.service.js';
import { procesarDesvioSesion } from './deteccion-infracciones.js';
import { IngestaWorkerService } from './ingesta-worker.service.js';

/**
 * docs/plan-en-vivo-alertas.md, PR A — integración contra Postgres real: detección de desvío
 * y de PC omitido en el worker (lotes sintéticos), acciones del admin sobre infracciones,
 * campos nuevos de `obtenerPosiciones` y aislamiento RLS de las tablas nuevas.
 *
 * Sin aserciones de reloj: todos los instantes salen de una base fija relativa a "hace 30 min"
 * (para caer en una partición de `gps_points` existente) y con margen bajo el límite de ts futuro y se pasan como `tsFix`.
 */

const ADMIN = { rol: 'admin_quivo', sindicatoId: null } as const;
const LON0 = -63.18;
const LON1 = -63.17;
const LAT_RUTA = -17.78;
// ~200 m al sur de la ruta (1° de latitud ≈ 111 km).
const LAT_FUERA = -17.78 - 0.0018;
const GEOMETRIA = JSON.stringify({
  type: 'LineString',
  coordinates: [
    [LON0, LAT_RUTA],
    [LON1, LAT_RUTA],
  ],
});
const pcCoord = (lon: number) => JSON.stringify({ type: 'Point', coordinates: [lon, LAT_RUTA] });

const BASE = Date.now() - 60 * 60 * 1000;
const iso = (segundos: number) => new Date(BASE + segundos * 1000).toISOString();

function evento(tipo: EventoSync['tipo'], ts: string, payload: Record<string, unknown>): EventoSync {
  return { eventId: randomUUID(), deviceId: 'device-det', ts, tipo, payload };
}
const gps = (sesionId: string, seg: number, lat: number, lon = -63.175, accuracy = 5) =>
  evento('gps_point', iso(seg), { sesionId, lat, lng: lon, accuracy, tsFix: iso(seg) });
const cumplimiento = (sesionId: string, puntoControlId: string, lon: number, seg: number) =>
  evento('cumplimiento_punto_control', iso(seg), {
    sesionId,
    puntoControlId,
    lat: LAT_RUTA,
    lng: lon,
    tsFix: iso(seg),
  });

describe('detección de infracciones (PR A)', () => {
  const sindicatoA = randomUUID();
  const sindicatoB = randomUUID();
  const adminA: AuthenticatedUser = { userId: 'admin-a', rol: 'admin_sindicato', sindicatoId: sindicatoA };
  const adminB: AuthenticatedUser = { userId: 'admin-b', rol: 'admin_sindicato', sindicatoId: sindicatoB };
  // Segundo admin del mismo sindicato: para verificar que se conserva la PRIMERA atención.
  const adminA2: AuthenticatedUser = { userId: 'admin-a2', rol: 'admin_sindicato', sindicatoId: sindicatoA };
  const sanciones = new SancionesService();
  const infracciones = new InfraccionesService(sanciones);
  const enVivo = new EnVivoService();

  let rutaId: string;
  let rutaNoHabId: string;
  let lineaId: string;
  let vehiculoId: string;
  let conductorId: string;
  let sesionDesvio: string;
  let sesionPc: string;
  /** Vehículo propio de `sesionPc`: `obtenerPosiciones` devuelve una sola sesión por vehículo. */
  let vehiculoPcId: string;
  let vehiculoDesvioId: string;
  let sesionSinInicio: string;
  let sesionPrecision: string;
  let sesionRecorridos: string;
  let sesionNoHab: string;
  let sesionMismoLote: string;
  let sesionVentana: string;
  let sesionTolerancia: string;
  let sesionIntermedio: string;
  let sesionRol: string;
  let sesionInactivo: string;
  let sesionSinRetorno: string;
  let pcSinRetorno: Record<'1' | '2' | '3', string>;
  let pc: Record<'1' | '2' | '3' | '4' | '5', string>;
  let pcRetorno: string;
  let pcRetornoInactivo: string;
  let reglaAId: string;
  let reglaBId: string;

  function servicioSinCola(): { procesarLote(job: unknown): Promise<{ procesados: number; errores: number }> } {
    const servicio = Object.create(IngestaWorkerService.prototype) as Record<string, unknown>;
    servicio.logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
    servicio.ingestaQueueStats = { getWaitingCount: async () => 0 };
    return servicio as never;
  }
  const lote = (sindicatoId: string, eventos: EventoSync[]) =>
    servicioSinCola().procesarLote({ id: 'job-det', data: { sindicatoId, eventos } });

  const infraccionesDe = (sesionId: string) =>
    withTenantContext(ADMIN, (tx) => tx.infraccion.findMany({ where: { sesionId }, orderBy: [{ inicioTs: 'asc' }, { dedupeKey: 'asc' }] }));
  const estadoDesvio = (sesionId: string) =>
    withTenantContext(ADMIN, (tx) =>
      tx.$queryRaw<{ puntos_fuera: number; infraccion_id: string | null; ultimo_ts: Date | null }[]>`
        SELECT puntos_fuera, infraccion_id, ultimo_ts FROM sesion_desvio_estado WHERE sesion_id = ${sesionId}`,
    );

  beforeAll(async () => {
    await withTenantContext(ADMIN, async (tx) => {
      await tx.sindicato.create({ data: { id: sindicatoA, nombre: 'Detección A', estado: 'activo' } });
      await tx.sindicato.create({ data: { id: sindicatoB, nombre: 'Detección B', estado: 'activo' } });
      const linea = await tx.linea.create({ data: { sindicatoId: sindicatoA, codigo: 'DET1', nombre: 'Línea Detección' } });
      lineaId = linea.id;
      rutaId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
        VALUES (${rutaId}, ${lineaId}, 'ida', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA}), 4326)::geography, 'activo', now(), now())`;
      // Solo las geometrías con `desvioHabilitado` admiten detección de desvío (default false).
      await tx.$executeRaw`UPDATE rutas SET "desvioHabilitado" = true WHERE id = ${rutaId}`;
      rutaNoHabId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
        VALUES (${rutaNoHabId}, ${lineaId}, 'vuelta', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA}), 4326)::geography, 'activo', now(), now())`;
      // Cinco PC sobre la ruta: 1-4 obligatorios, 5 opcional.
      pc = { '1': randomUUID(), '2': randomUUID(), '3': randomUUID(), '4': randomUUID(), '5': randomUUID() };
      const lons = { '1': -63.178, '2': -63.176, '3': -63.174, '4': -63.172, '5': -63.171 } as const;
      for (const k of ['1', '2', '3', '4', '5'] as const) {
        await tx.$executeRaw`
          INSERT INTO puntos_control (id, "rutaId", orden, coord, "radioToleranciaM", obligatorio, "createdAt", "updatedAt")
          VALUES (${pc[k]}, ${rutaId}, ${Number(k)}, ST_SetSRID(ST_GeomFromGeoJSON(${pcCoord(lons[k])}), 4326)::geography,
                  30, ${k !== '5'}, now(), now())`;
      }
      // Fuera de los 5 de arriba (todos obligatorios salvo el 5): un PC con rol (no obligatorio) y
      // uno con rol pero inactivo, para el filtro de `cumplimientoDisparaPcOmitido` en vivo.
      pcRetorno = randomUUID();
      pcRetornoInactivo = randomUUID();
      await tx.$executeRaw`
        INSERT INTO puntos_control (id, "rutaId", orden, coord, "radioToleranciaM", obligatorio, rol, estado, "createdAt", "updatedAt")
        VALUES (${pcRetorno}, ${rutaId}, 6, ST_SetSRID(ST_GeomFromGeoJSON(${pcCoord(-63.1705)}), 4326)::geography,
                30, false, 'retorno', 'activo', now(), now()),
               (${pcRetornoInactivo}, ${rutaId}, 7, ST_SetSRID(ST_GeomFromGeoJSON(${pcCoord(-63.1702)}), 4326)::geography,
                30, false, 'retorno', 'inactivo', now(), now())`;
      // Ruta SIN PC retorno activo (como L120/Z12): 1-2 obligatorios, 3 opcional sin rol.
      pcSinRetorno = { '1': randomUUID(), '2': randomUUID(), '3': randomUUID() };
      for (const [k, lon] of [['1', -63.178], ['2', -63.176], ['3', -63.174]] as const) {
        await tx.$executeRaw`
          INSERT INTO puntos_control (id, "rutaId", orden, coord, "radioToleranciaM", obligatorio, "createdAt", "updatedAt")
          VALUES (${pcSinRetorno[k]}, ${rutaNoHabId}, ${Number(k)}, ST_SetSRID(ST_GeomFromGeoJSON(${pcCoord(lon)}), 4326)::geography,
                  30, ${k !== '3'}, now(), now())`;
      }
      const vehiculo = await tx.vehiculo.create({
        data: {
          sindicatoId: sindicatoA,
          placa: `DT${randomUUID().slice(0, 5).toUpperCase()}`,
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
        data: { sindicatoId: sindicatoA, nombre: 'Conductor Det', documentoIdentidad: `DET-${randomUUID()}`, licenciaConducir: 'L1' },
      });
      conductorId = conductor.id;
      const rotacion = await tx.rotacion.create({ data: { sindicatoId: sindicatoA, periodo: '2026-10', estado: 'publicada' } });
      const asignacion = await tx.asignacion.create({
        data: {
          rotacionId: rotacion.id,
          vehiculoId,
          conductorId,
          rutaId,
          fecha: fechaActualBolivia(new Date()),
          horario: 'manana',
          orden: 1,
          venceAt: new Date(Date.now() + 60 * 60 * 1000),
          estado: 'vigente',
        },
      });
      const asignacionNoHab = await tx.asignacion.create({
        data: {
          rotacionId: rotacion.id,
          vehiculoId,
          conductorId,
          rutaId: rutaNoHabId,
          fecha: fechaActualBolivia(new Date()),
          horario: 'tarde',
          orden: 2,
          venceAt: new Date(Date.now() + 60 * 60 * 1000),
          estado: 'vigente',
        },
      });
      const vehiculoPropio = async () =>
        (
          await tx.vehiculo.create({
            data: { sindicatoId: sindicatoA, placa: `DT${randomUUID().slice(0, 5).toUpperCase()}`, tipo: 'bus', marca: 'x', modelo: 'x', color: 'x', capacidad: 10, estado: 'activo' },
          })
        ).id;
      const crearSesion = async (asignacionId = asignacion.id, vehiculoSesionId = vehiculoId) =>
        (
          await tx.sesionOperativa.create({
            data: {
              sindicatoId: sindicatoA,
              asignacionId,
              vehiculoId: vehiculoSesionId,
              conductorId,
              deviceId: 'device-det',
              accessTokenHash: randomUUID(),
              refreshTokenHash: randomUUID(),
              accessExpiresAt: new Date(Date.now() + 3_600_000),
              refreshExpiresAt: new Date(Date.now() + 3_600_000),
            },
          })
        ).id;
      vehiculoDesvioId = await vehiculoPropio();
      sesionDesvio = await crearSesion(undefined, vehiculoDesvioId);
      vehiculoPcId = await vehiculoPropio();
      sesionPc = await crearSesion(undefined, vehiculoPcId);
      sesionSinInicio = await crearSesion(undefined, await vehiculoPropio());
      sesionPrecision = await crearSesion();
      sesionRecorridos = await crearSesion();
      sesionNoHab = await crearSesion(asignacionNoHab.id);
      sesionMismoLote = await crearSesion();
      sesionVentana = await crearSesion();
      sesionTolerancia = await crearSesion();
      sesionIntermedio = await crearSesion();
      sesionRol = await crearSesion();
      sesionInactivo = await crearSesion();
      sesionSinRetorno = await crearSesion(asignacionNoHab.id);
      reglaAId = (
        await tx.regla.create({
          data: { sindicatoId: sindicatoA, nombre: 'Sanción genérica', tipo: 'operativo', gravedad: 'grave', aplicaA: 'conductor' },
        })
      ).id;
      reglaBId = (
        await tx.regla.create({
          data: { sindicatoId: sindicatoB, nombre: 'Regla B', tipo: 'operativo', gravedad: 'leve', aplicaA: 'conductor' },
        })
      ).id;
    });
  });

  afterAll(async () => {
    await withTenantContext(ADMIN, async (tx) => {
      const ids = { in: [sindicatoA, sindicatoB] };
      const sesiones = [
        sesionDesvio,
        sesionPc,
        sesionSinInicio,
        sesionPrecision,
        sesionRecorridos,
        sesionNoHab,
        sesionMismoLote,
        sesionVentana,
        sesionTolerancia,
        sesionIntermedio,
        sesionRol,
        sesionInactivo,
        sesionSinRetorno,
      ];
      await tx.sancion.deleteMany({ where: { sindicatoId: ids } });
      await tx.infraccion.deleteMany({ where: { sindicatoId: ids } });
      await tx.$executeRaw`DELETE FROM sesion_desvio_estado WHERE "sindicatoId" IN (${sindicatoA}, ${sindicatoB})`;
      await tx.$executeRaw`DELETE FROM gps_sesion_resumen WHERE "sindicatoId" IN (${sindicatoA}, ${sindicatoB})`;
      await tx.$executeRaw`DELETE FROM gps_points WHERE "sindicatoId" IN (${sindicatoA}, ${sindicatoB})`;
      await tx.syncError.deleteMany({ where: { sindicatoId: ids } });
      await tx.cumplimientoPc.deleteMany({ where: { sindicatoId: ids } });
      await tx.eventoOperativo.deleteMany({ where: { sindicatoId: ids } });
      await tx.sesionOperativa.deleteMany({ where: { id: { in: sesiones } } });
      await tx.asignacion.deleteMany({ where: { rutaId: { in: [rutaId, rutaNoHabId] } } });
      await tx.rotacion.deleteMany({ where: { sindicatoId: ids } });
      await tx.vehiculo.deleteMany({ where: { sindicatoId: ids } });
      await tx.conductor.deleteMany({ where: { sindicatoId: ids } });
      await tx.$executeRaw`DELETE FROM puntos_control WHERE "rutaId" IN (${rutaId}, ${rutaNoHabId})`;
      await tx.$executeRaw`DELETE FROM rutas WHERE id IN (${rutaId}, ${rutaNoHabId})`;
      await tx.linea.deleteMany({ where: { sindicatoId: ids } });
      await tx.regla.deleteMany({ where: { sindicatoId: ids } });
      await tx.sindicato.deleteMany({ where: { id: ids } });
    });
    await prisma.$disconnect();
  });

  describe('desvío de ruta', () => {
    it('puntos sobre la ruta no generan infracción pero sí dejan estado', async () => {
      const r = await lote(sindicatoA, [
        evento('inicio_recorrido', iso(-60), { sesionId: sesionDesvio }),
        gps(sesionDesvio, 0, LAT_RUTA),
        gps(sesionDesvio, 15, LAT_RUTA),
      ]);
      expect(r).toEqual({ procesados: 3, errores: 0 });
      expect(await infraccionesDe(sesionDesvio)).toHaveLength(0);
      const [estado] = await estadoDesvio(sesionDesvio);
      expect(estado?.puntos_fuera).toBe(0);
      expect(estado?.ultimo_ts?.toISOString()).toBe(iso(15));
    });

    it('una racha que cruza lotes abre UNA infracción con la gravedad por defecto (grave) y los datos del primer punto fuera', async () => {
      await lote(sindicatoA, [gps(sesionDesvio, 30, LAT_FUERA), gps(sesionDesvio, 50, LAT_FUERA)]);
      expect(await infraccionesDe(sesionDesvio)).toHaveLength(0);
      const [parcial] = await estadoDesvio(sesionDesvio);
      expect(parcial?.puntos_fuera).toBe(2);

      await lote(sindicatoA, [gps(sesionDesvio, 70, LAT_FUERA), gps(sesionDesvio, 90, LAT_FUERA)]);
      const filas = await infraccionesDe(sesionDesvio);
      expect(filas).toHaveLength(1);
      const inf = filas[0]!;
      expect(inf).toMatchObject({
        sindicatoId: sindicatoA,
        sesionId: sesionDesvio,
        vehiculoId: vehiculoDesvioId,
        conductorId,
        lineaId,
        rutaId,
        tipo: 'desvio_ruta',
        gravedad: 'grave',
        reglaId: null,
        estado: 'abierta',
        finTs: null,
      });
      expect(inf.inicioTs.toISOString()).toBe(iso(30));
      expect(inf.lat).toBeCloseTo(LAT_FUERA, 6);
      expect(inf.dedupeKey).toBe(`desvio:${sesionDesvio}:${iso(30)}`);
      const detalle = inf.detalle as { distanciaMaxM: number; puntos: number; duracionS: number };
      expect(detalle.distanciaMaxM).toBeGreaterThan(190);
      expect(detalle.distanciaMaxM).toBeLessThan(210);
      expect(detalle.puntos).toBe(4);
      expect(detalle.duracionS).toBe(60);
      const [estado] = await estadoDesvio(sesionDesvio);
      expect(estado?.infraccion_id).toBe(inf.id);
    });

    it('el regreso (2 puntos < 60 m) cierra con fin_ts; reenviar lotes ya procesados es idempotente', async () => {
      const regreso = [gps(sesionDesvio, 110, LAT_RUTA), gps(sesionDesvio, 130, LAT_RUTA)];
      await lote(sindicatoA, regreso);
      let filas = await infraccionesDe(sesionDesvio);
      expect(filas).toHaveLength(1);
      expect(filas[0]!.finTs?.toISOString()).toBe(iso(130));
      expect(filas[0]!.estado).toBe('abierta'); // cerrar no cambia el estado de atención
      const [estado] = await estadoDesvio(sesionDesvio);
      expect(estado?.infraccion_id).toBeNull();

      // Mismos puntos con eventIds nuevos (ts <= ultimo_ts): no mueven la máquina.
      await lote(sindicatoA, [gps(sesionDesvio, 90, LAT_FUERA), gps(sesionDesvio, 110, LAT_RUTA)]);
      filas = await infraccionesDe(sesionDesvio);
      expect(filas).toHaveLength(1);
    });

    it('con una Regla activa tipo desvio_ruta la nueva infracción toma su gravedad y regla_id', async () => {
      const reglaId = await withTenantContext(ADMIN, async (tx) =>
        (
          await tx.regla.create({
            data: { sindicatoId: sindicatoA, nombre: 'Desvío', tipo: 'desvio_ruta', gravedad: 'gravisima', aplicaA: 'conductor' },
          })
        ).id,
      );
      await lote(sindicatoA, [
        gps(sesionDesvio, 300, LAT_FUERA),
        gps(sesionDesvio, 320, LAT_FUERA),
        gps(sesionDesvio, 340, LAT_FUERA),
        gps(sesionDesvio, 360, LAT_FUERA),
      ]);
      const filas = await infraccionesDe(sesionDesvio);
      expect(filas).toHaveLength(2);
      expect(filas[1]).toMatchObject({ gravedad: 'gravisima', reglaId, estado: 'abierta', finTs: null });
    });

    it('un lote cuyo sesionId es de OTRO sindicato no crea estado ni infracciones', async () => {
      const otraSesion = randomUUID();
      const r = await lote(sindicatoB, [
        gps(sesionDesvio, 400, LAT_FUERA),
        gps(otraSesion, 400, LAT_FUERA),
      ]);
      // gps_points inserta (la evidencia es del tenant del lote); la detección no.
      expect(r.errores).toBe(0);
      const filas = await withTenantContext(ADMIN, (tx) =>
        tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM sesion_desvio_estado WHERE "sindicatoId" = ${sindicatoB}`,
      );
      expect(filas[0]?.n).toBe(0);
      expect((await infraccionesDe(sesionDesvio)).filter((i) => i.sindicatoId === sindicatoB)).toHaveLength(0);
    });

    it('puntos con accuracy > 30 m no abren una infracción', async () => {
      const sesion = sesionPrecision;
      await lote(sindicatoA, [
        evento('inicio_recorrido', iso(-60), { sesionId: sesion }),
        gps(sesion, 10, LAT_FUERA, -63.175, 90),
        gps(sesion, 30, LAT_FUERA, -63.175, 90),
        gps(sesion, 60, LAT_FUERA, -63.175, 90),
        gps(sesion, 90, LAT_FUERA, -63.175, 90),
      ]);
      expect(await infraccionesDe(sesion)).toHaveLength(0);
    });

    it('ts futuro (> ahora + drift) se ignora y no adelanta ultimo_ts', async () => {
      const sesion = sesionPrecision;
      const p = (seg: number) => ({ ts: new Date(BASE + seg * 1000), lat: LAT_RUTA, lng: -63.175, accuracy: 5 });
      const correr = (ahoraSeg: number, puntos: ReturnType<typeof p>[]) =>
        withTenantContext(ADMIN, (tx) =>
          procesarDesvioSesion(tx, sindicatoA, sesion, puntos, [], new Date(BASE + ahoraSeg * 1000)),
        );
      // "Ahora" = t+120 s: el punto a t+100 es válido; el de t+2 h es futuro.
      await correr(120, [p(100), p(7200)]);
      expect((await estadoDesvio(sesion))[0]?.ultimo_ts?.toISOString()).toBe(iso(100));
      // Si ultimo_ts hubiera saltado al futuro, este punto (posterior al válido) sería "tardío".
      await correr(200, [p(130)]);
      expect((await estadoDesvio(sesion))[0]?.ultimo_ts?.toISOString()).toBe(iso(130));
    });

    it('ruta sin desvioHabilitado: no hay detección ni estado aunque los puntos estén lejos', async () => {
      await lote(sindicatoA, [
        evento('inicio_recorrido', iso(-60), { sesionId: sesionNoHab }),
        gps(sesionNoHab, 10, LAT_FUERA),
        gps(sesionNoHab, 30, LAT_FUERA),
        gps(sesionNoHab, 50, LAT_FUERA),
        gps(sesionNoHab, 70, LAT_FUERA),
      ]);
      expect(await infraccionesDe(sesionNoHab)).toHaveLength(0);
      expect(await estadoDesvio(sesionNoHab)).toHaveLength(0);
    });

    it('solo evalúa dentro del recorrido: traslado en vacío no abre; el fin cierra lo abierto; la racha no se arrastra', async () => {
      const sesion = sesionRecorridos;
      const fuera = (seg: number) => gps(sesion, seg, LAT_FUERA);
      // El fin_recorrido también dispara PC omitido (otro detector): acá solo importan los desvíos.
      const desvios = async () => (await infraccionesDe(sesion)).filter((i) => i.tipo === 'desvio_ruta');
      // Recorrido 1 (0..100) sin puntos; luego traslado en vacío lejos de la ruta: nada.
      await lote(sindicatoA, [
        evento('inicio_recorrido', iso(0), { sesionId: sesion }),
        evento('fin_recorrido', iso(100), { sesionId: sesion }),
      ]);
      await lote(sindicatoA, [fuera(200), fuera(220), fuera(240), fuera(260)]);
      expect(await desvios()).toHaveLength(0);
      expect((await estadoDesvio(sesion))[0]?.ultimo_ts).toBeNull();

      // Recorrido 2: el inicio_recorrido llega al FINAL del array del mismo lote que sus puntos.
      await lote(sindicatoA, [fuera(1010), fuera(1030), fuera(1060), evento('inicio_recorrido', iso(1000), { sesionId: sesion })]);
      let filas = await desvios();
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({ tipo: 'desvio_ruta', estado: 'abierta', finTs: null });
      expect(filas[0]!.inicioTs.toISOString()).toBe(iso(1010));

      // El fin_recorrido cierra la infracción con el ts del último punto evaluado y reinicia la máquina.
      await lote(sindicatoA, [evento('fin_recorrido', iso(1100), { sesionId: sesion })]);
      filas = await desvios();
      expect(filas[0]!.finTs?.toISOString()).toBe(iso(1060));
      const [estado] = await estadoDesvio(sesion);
      expect(estado).toMatchObject({ puntos_fuera: 0, infraccion_id: null });

      // Traslado en vacío tras el fin: no mueve la máquina.
      await lote(sindicatoA, [fuera(1200), fuera(1220), fuera(1240), fuera(1260)]);
      expect(await desvios()).toHaveLength(1);

      // Recorrido 3: 2 puntos fuera; recorrido 4: 1 punto fuera. Ninguna racha se acumula entre recorridos.
      await lote(sindicatoA, [
        evento('inicio_recorrido', iso(2000), { sesionId: sesion }),
        fuera(2010),
        fuera(2030),
      ]);
      await lote(sindicatoA, [evento('inicio_recorrido', iso(3000), { sesionId: sesion }), fuera(3010)]);
      expect(await desvios()).toHaveLength(1);
      expect((await estadoDesvio(sesion))[0]?.puntos_fuera).toBe(1);
    });
  });

  describe('PC omitido', () => {
    it('sin inicio_recorrido no se detecta nada (documentado)', async () => {
      await lote(sindicatoA, [cumplimiento(sesionSinInicio, pc['3'], -63.174, 100)]);
      expect((await infraccionesDe(sesionSinInicio)).filter((i) => i.tipo === 'pc_omitido')).toHaveLength(0);
    });

    it('cumplir el PC de orden 3 marca omitidos los obligatorios 1 y 2 (no el 4 ni el opcional), con gravedad leve', async () => {
      await lote(sindicatoA, [evento('inicio_recorrido', iso(0), { sesionId: sesionPc })]);
      await lote(sindicatoA, [cumplimiento(sesionPc, pc['3'], -63.174, 100)]);
      const filas = (await infraccionesDe(sesionPc)).filter((i) => i.tipo === 'pc_omitido');
      expect(filas).toHaveLength(2);
      const porOrden = filas
        .map((f) => f.detalle as { puntoControlId: string; orden: number })
        .sort((a, b) => a.orden - b.orden);
      expect(porOrden.map((d) => d.puntoControlId)).toEqual([pc['1'], pc['2']]);
      for (const f of filas) {
        expect(f).toMatchObject({ gravedad: 'leve', reglaId: null, estado: 'abierta', sesionId: sesionPc, vehiculoId: vehiculoPcId, conductorId });
        expect(f.dedupeKey).toBe(`pc_omitido:${sesionPc}:${(f.detalle as { puntoControlId: string }).puntoControlId}:${iso(0)}`);
        expect(f.inicioTs.toISOString()).toBe(iso(100));
      }
    });

    it('reenviar el cumplimiento (otro eventId) no duplica; un cumplimiento fuera del radio (no cumplido) no dispara nada', async () => {
      await lote(sindicatoA, [
        cumplimiento(sesionPc, pc['3'], -63.174, 100),
        // Lejos del PC 4: el worker lo marca cumplido=false → sin detección.
        evento('cumplimiento_punto_control', iso(150), {
          sesionId: sesionPc,
          puntoControlId: pc['4'],
          lat: LAT_FUERA,
          lng: -63.172,
          tsFix: iso(150),
        }),
      ]);
      expect((await infraccionesDe(sesionPc)).filter((i) => i.tipo === 'pc_omitido')).toHaveLength(2);
    });

    it('al fin_recorrido los obligatorios restantes (PC 4) pasan a omitido; el opcional y el ya cumplido no', async () => {
      await lote(sindicatoA, [evento('fin_recorrido', iso(1000), { sesionId: sesionPc })]);
      const filas = (await infraccionesDe(sesionPc)).filter((i) => i.tipo === 'pc_omitido');
      const ids = filas.map((f) => (f.detalle as { puntoControlId: string }).puntoControlId).sort();
      expect(ids).toEqual([pc['1'], pc['2'], pc['4']].sort());
      // Reprocesar el fin (otro eventId) es idempotente.
      await lote(sindicatoA, [evento('fin_recorrido', iso(1000), { sesionId: sesionPc })]);
      expect((await infraccionesDe(sesionPc)).filter((i) => i.tipo === 'pc_omitido')).toHaveLength(3);
    });

    it('la ventana es la del último inicio_recorrido: un cumplimiento de la vuelta anterior no cuenta', async () => {
      // Nuevo inicio_recorrido DESPUÉS del fin: los cumplimientos previos quedan fuera de la ventana.
      await lote(sindicatoA, [evento('inicio_recorrido', iso(2000), { sesionId: sesionPc })]);
      await lote(sindicatoA, [cumplimiento(sesionPc, pc['2'], -63.176, 2100)]);
      const filas = (await infraccionesDe(sesionPc)).filter((i) => i.tipo === 'pc_omitido');
      // Solo el PC 1 es nuevo para la ventana de 2000 (clave de dedupe distinta de la anterior).
      expect(filas).toHaveLength(4);
      const nuevas = filas.filter((f) => f.dedupeKey.endsWith(iso(2000)));
      expect(nuevas.map((f) => (f.detalle as { puntoControlId: string }).puntoControlId)).toEqual([pc['1']]);
    });

    const pcOmitidos = async (sesionId: string) =>
      (await infraccionesDe(sesionId))
        .filter((i) => i.tipo === 'pc_omitido')
        .map((i) => ({ pc: (i.detalle as { puntoControlId: string }).puntoControlId, key: i.dedupeKey }));

    it('orden entre tipos en un lote: cumplimiento, fin e inicio del MISMO lote en cualquier orden se ven entre sí', async () => {
      const sesion = sesionMismoLote;
      await lote(sindicatoA, [
        cumplimiento(sesion, pc['3'], -63.174, 100),
        evento('fin_recorrido', iso(1000), { sesionId: sesion }),
        evento('inicio_recorrido', iso(0), { sesionId: sesion }),
      ]);
      const omitidos = await pcOmitidos(sesion);
      // En vivo (cumplir el 3): PC 1 y 2. Al fin: el PC 4 (el 3 está cumplido; el 5 es opcional).
      expect(omitidos.map((o) => o.pc).sort()).toEqual([pc['1'], pc['2'], pc['4']].sort());
      expect(omitidos.every((o) => o.key.endsWith(`:${iso(0)}`))).toBe(true);
    });

    it('ventana acotada por arriba: los cumplimientos de un recorrido POSTERIOR no cumplen un PC del anterior', async () => {
      const sesion = sesionVentana;
      await lote(sindicatoA, [
        evento('inicio_recorrido', iso(0), { sesionId: sesion }),
        evento('fin_recorrido', iso(1000), { sesionId: sesion }),
        evento('inicio_recorrido', iso(2000), { sesionId: sesion }),
        cumplimiento(sesion, pc['1'], -63.178, 2050),
        cumplimiento(sesion, pc['3'], -63.174, 2100),
      ]);
      const omitidos = await pcOmitidos(sesion);
      const del = (inicioSeg: number) =>
        omitidos.filter((o) => o.key.endsWith(`:${iso(inicioSeg)}`)).map((o) => o.pc).sort();
      // Recorrido 1 (sin cumplimientos propios): los 4 obligatorios. Recorrido 2: solo el PC 2.
      expect(del(0)).toEqual([pc['1'], pc['2'], pc['3'], pc['4']].sort());
      expect(del(2000)).toEqual([pc['2']]);
    });

    it('tolerancia de relojes: un cumplimiento justo ANTES del inicio_recorrido cuenta; uno 5 min antes queda fuera', async () => {
      const sesion = sesionTolerancia;
      await lote(sindicatoA, [
        evento('inicio_recorrido', iso(1000), { sesionId: sesion }),
        cumplimiento(sesion, pc['1'], -63.178, 940), // 60 s antes: dentro de la tolerancia (120 s)
        cumplimiento(sesion, pc['4'], -63.172, 700), // 300 s antes: fuera de todo recorrido
        cumplimiento(sesion, pc['3'], -63.174, 1100),
      ]);
      const omitidos = await pcOmitidos(sesion);
      // Solo el PC 2: el 1 cuenta como cumplido por la tolerancia y el cumplimiento del 4
      // (fuera de ventana) no dispara detección alguna.
      expect(omitidos.map((o) => o.pc)).toEqual([pc['2']]);
      expect(omitidos[0]!.key.endsWith(`:${iso(1000)}`)).toBe(true);
    });
  });

  describe('PC omitido: qué cumplimientos disparan la detección en vivo', () => {
    const omitidosDe = async (sesionId: string) =>
      (await infraccionesDe(sesionId)).filter((i) => i.tipo === 'pc_omitido');

    it('ruta con retorno: un intermedio (sin rol, no obligatorio) cumplido tras obligatorios sin visitar no abre omisiones', async () => {
      await lote(sindicatoA, [
        evento('inicio_recorrido', iso(0), { sesionId: sesionIntermedio }),
        cumplimiento(sesionIntermedio, pc['5'], -63.171, 100),
      ]);
      expect(await omitidosDe(sesionIntermedio)).toHaveLength(0);
    });

    it('un PC con rol (no obligatorio) sí dispara: los 4 obligatorios anteriores quedan omitidos', async () => {
      await lote(sindicatoA, [
        evento('inicio_recorrido', iso(0), { sesionId: sesionRol }),
        cumplimiento(sesionRol, pcRetorno, -63.1705, 100),
      ]);
      const ids = (await omitidosDe(sesionRol)).map((f) => (f.detalle as { puntoControlId: string }).puntoControlId);
      expect(ids.sort()).toEqual([pc['1'], pc['2'], pc['3'], pc['4']].sort());
    });

    it('ruta SIN retorno activo: un opcional sin rol cumplido tras obligatorios sin visitar sí abre pc_omitido (como antes)', async () => {
      await lote(sindicatoA, [
        evento('inicio_recorrido', iso(0), { sesionId: sesionSinRetorno }),
        cumplimiento(sesionSinRetorno, pcSinRetorno['3'], -63.174, 100),
      ]);
      const ids = (await omitidosDe(sesionSinRetorno)).map((f) => (f.detalle as { puntoControlId: string }).puntoControlId);
      expect(ids.sort()).toEqual([pcSinRetorno['1'], pcSinRetorno['2']].sort());
    });

    it('un PC con rol pero inactivo no dispara', async () => {
      await lote(sindicatoA, [
        evento('inicio_recorrido', iso(0), { sesionId: sesionInactivo }),
        cumplimiento(sesionInactivo, pcRetornoInactivo, -63.1702, 100),
      ]);
      expect(await omitidosDe(sesionInactivo)).toHaveLength(0);
    });
  });

  describe('acciones del admin', () => {
    it('atender: abierta → atendida (registra actor y hora); repetir da 409', async () => {
      const [primera] = (await infraccionesDe(sesionPc)).filter((i) => i.tipo === 'pc_omitido');
      const r = await infracciones.actualizar(adminA, primera!.id, { accion: 'atender', nota: 'Llamé al conductor' });
      expect(r).toMatchObject({ id: primera!.id, estado: 'atendida', atendidaPor: 'admin-a', nota: 'Llamé al conductor' });
      expect(r.atendidaEn).toBeInstanceOf(Date);
      await expect(infracciones.actualizar(adminA, primera!.id, { accion: 'atender' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('descartar: desde atendida OK; desde descartada 409', async () => {
      const [primera] = (await infraccionesDe(sesionPc)).filter((i) => i.tipo === 'pc_omitido');
      const r = await infracciones.actualizar(adminA, primera!.id, { accion: 'descartar', nota: 'El geofence falló' });
      expect(r.estado).toBe('descartada');
      await expect(infracciones.actualizar(adminA, primera!.id, { accion: 'descartar' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('otro sindicato recibe 404 (RLS) en atender, descartar y sancionar', async () => {
      const [cualquiera] = await infraccionesDe(sesionDesvio);
      await expect(infracciones.actualizar(adminB, cualquiera!.id, { accion: 'atender' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        infracciones.sancionar(adminB, cualquiera!.id, {
          reglaId: reglaBId,
          sujetoTipo: 'conductor',
          sujetoId: conductorId,
          motivo: 'x',
          fechaHecho: new Date(),
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      const intacta = await infraccionesDe(sesionDesvio);
      expect(intacta.find((i) => i.id === cualquiera!.id)?.estado).toBe('abierta');
    });

    it('sancionar crea la sanción y marca la infracción sancionada en una transacción; repetir da 409 sin segunda sanción', async () => {
      const abierta = (await infraccionesDe(sesionDesvio)).find((i) => i.estado === 'abierta' && i.finTs !== null)!;
      const r = await infracciones.sancionar(adminA, abierta.id, {
        reglaId: reglaAId,
        sujetoTipo: 'conductor',
        sujetoId: conductorId,
        motivo: 'Desvío de ruta',
        fechaHecho: new Date(),
        evidenciaRef: `infraccion:${abierta.id}`,
      });
      expect(r.estado).toBe('sancionada');
      expect(r.sancionId).toBeTruthy();
      const sancion = await sanciones.obtener(adminA, r.sancionId!);
      expect(sancion).toMatchObject({ reglaId: reglaAId, sujetoId: conductorId, estado: 'pendiente', sindicatoId: sindicatoA });
      await expect(
        infracciones.sancionar(adminA, abierta.id, {
          reglaId: reglaAId,
          sujetoTipo: 'conductor',
          sujetoId: conductorId,
          motivo: 'otra vez',
          fechaHecho: new Date(),
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      const total = await withTenantContext(ADMIN, (tx) => tx.sancion.count({ where: { sindicatoId: sindicatoA } }));
      expect(total).toBe(1);
    });

    it('si la sanción falla (regla de otro sindicato) la infracción NO queda sancionada (rollback)', async () => {
      const objetivo = (await infraccionesDe(sesionRecorridos)).find((i) => i.tipo === 'desvio_ruta' && i.estado === 'abierta')!;
      await expect(
        infracciones.sancionar(adminA, objetivo.id, {
          reglaId: reglaBId,
          sujetoTipo: 'conductor',
          sujetoId: conductorId,
          motivo: 'x',
          fechaHecho: new Date(),
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      const despues = (await infraccionesDe(sesionRecorridos)).find((i) => i.id === objetivo.id)!;
      expect(despues.estado).toBe('abierta');
      expect(despues.sancionId).toBeNull();
      expect(despues.atendidaPor).toBeNull();
    });

    const sancionDe = (extra: Partial<SancionarInfraccion> = {}): SancionarInfraccion => ({
      reglaId: reglaAId,
      sujetoTipo: 'conductor',
      sujetoId: conductorId,
      motivo: 'm',
      fechaHecho: new Date(),
      ...extra,
    });

    it('pc_omitido es solo alerta: sancionar da 409 y no crea sanción ni cambia la infracción', async () => {
      const pcAbierta = (await infraccionesDe(sesionPc)).find((i) => i.tipo === 'pc_omitido' && i.estado === 'abierta')!;
      const antes = await withTenantContext(ADMIN, (tx) => tx.sancion.count({ where: { sindicatoId: sindicatoA } }));
      await expect(infracciones.sancionar(adminA, pcAbierta.id, sancionDe())).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(await withTenantContext(ADMIN, (tx) => tx.sancion.count({ where: { sindicatoId: sindicatoA } }))).toBe(antes);
      const despues = (await infraccionesDe(sesionPc)).find((i) => i.id === pcAbierta.id)!;
      expect(despues).toMatchObject({ estado: 'abierta', sancionId: null });
    });

    it('el sujeto debe ser el conductor o el vehículo de la infracción (400); socio no se admite', async () => {
      const objetivo = (await infraccionesDe(sesionRecorridos)).find((i) => i.tipo === 'desvio_ruta' && i.estado === 'abierta')!;
      const llamar = (extra: Partial<SancionarInfraccion>) =>
        infracciones.sancionar(adminA, objetivo.id, sancionDe(extra));
      await expect(llamar({ sujetoId: randomUUID() })).rejects.toBeInstanceOf(BadRequestException);
      // Cruzado: tipo conductor con el id del vehículo, y viceversa.
      await expect(llamar({ sujetoTipo: 'conductor', sujetoId: vehiculoId })).rejects.toBeInstanceOf(BadRequestException);
      await expect(llamar({ sujetoTipo: 'vehiculo', sujetoId: conductorId })).rejects.toBeInstanceOf(BadRequestException);
      await expect(llamar({ sujetoTipo: 'socio', sujetoId: conductorId })).rejects.toBeInstanceOf(BadRequestException);
      expect((await infraccionesDe(sesionRecorridos)).find((i) => i.id === objetivo.id)?.estado).toBe('abierta');
    });

    it('sancionar desde atendida conserva la PRIMERA atención y completa evidenciaRef por defecto', async () => {
      const objetivo = (await infraccionesDe(sesionRecorridos)).find((i) => i.tipo === 'desvio_ruta' && i.estado === 'abierta')!;
      const atendida = await infracciones.actualizar(adminA, objetivo.id, { accion: 'atender' });
      const r = await infracciones.sancionar(adminA2, objetivo.id, sancionDe({ sujetoTipo: 'vehiculo', sujetoId: vehiculoId }));
      expect(r.estado).toBe('sancionada');
      expect(r.atendidaPor).toBe('admin-a');
      expect(r.atendidaEn?.toISOString()).toBe(atendida.atendidaEn?.toISOString());
      const sancion = await sanciones.obtener(adminA, r.sancionId!);
      expect(sancion.evidenciaRef).toBe(`infraccion:${objetivo.id} sesion:${sesionRecorridos}`);
    });

    it('descartar desde atendida NO pisa quién/cuándo la atendió primero', async () => {
      const pcs = (await infraccionesDe(sesionPc)).filter((i) => i.tipo === 'pc_omitido' && i.estado === 'abierta');
      const objetivo = pcs[0]!;
      const atendida = await infracciones.actualizar(adminA, objetivo.id, { accion: 'atender' });
      const r = await infracciones.actualizar(adminA2, objetivo.id, { accion: 'descartar', nota: 'falso positivo' });
      expect(r.estado).toBe('descartada');
      expect(r.atendidaPor).toBe('admin-a');
      expect(r.atendidaEn?.toISOString()).toBe(atendida.atendidaEn?.toISOString());
    });
  });

  describe('mapa en vivo', () => {
    it('obtenerPosiciones agrega nivel máximo y cantidad de abiertas, y trae vehiculoId/conductorId', async () => {
      const posiciones = await enVivo.obtenerPosiciones(adminA);
      const desvio = posiciones.find((p) => p.id === sesionDesvio)!;
      // Abiertas en la sesión de desvío: la gravísima (activa) — la grave quedó sancionada.
      expect(desvio).toMatchObject({ vehiculoId: vehiculoDesvioId, conductorId, infraccionNivel: 'gravisima', infraccionesAbiertas: 1 });
      const pcSesion = posiciones.find((p) => p.id === sesionPc);
      // La sesión de PC no tiene gps: puede no tener fix pero sigue listada por estar activa.
      expect(pcSesion).toMatchObject({ vehiculoId: vehiculoPcId, conductorId, infraccionNivel: 'leve', infraccionesAbiertas: 2 });
      const sinInfracciones = posiciones.find((p) => p.id === sesionSinInicio)!;
      expect(sinInfracciones).toMatchObject({ infraccionNivel: null, infraccionesAbiertas: 0 });
    });

    it('listarInfraccionesSesion devuelve las abiertas primero y respeta el tenant', async () => {
      const lista = await enVivo.listarInfraccionesSesion(adminA, sesionPc);
      const estados = lista.map((i) => i.estado);
      const primeraNoAbierta = estados.findIndex((e) => e !== 'abierta');
      if (primeraNoAbierta >= 0) {
        expect(estados.slice(primeraNoAbierta).every((e) => e !== 'abierta')).toBe(true);
      }
      expect(lista.length).toBeGreaterThanOrEqual(4);
      await expect(enVivo.listarInfraccionesSesion(adminB, sesionPc)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('el orden (abiertas primero) se aplica en SQL ANTES del tope: una abierta antigua no queda fuera por 200 cerradas recientes', async () => {
      const base = {
        sindicatoId: sindicatoA,
        sesionId: sesionPrecision,
        vehiculoId,
        conductorId,
        lineaId,
        rutaId,
        tipo: 'desvio_ruta',
        gravedad: 'leve',
        lat: 0,
        lng: 0,
        detalle: {},
      };
      await withTenantContext(ADMIN, async (tx) => {
        await tx.infraccion.createMany({
          data: [
            { ...base, estado: 'abierta', inicioTs: new Date(BASE - 3_600_000), dedupeKey: `orden:${sesionPrecision}:vieja` },
            ...Array.from({ length: 200 }, (_, i) => ({
              ...base,
              estado: 'descartada',
              inicioTs: new Date(BASE + i * 1000),
              dedupeKey: `orden:${sesionPrecision}:${i}`,
            })),
          ],
        });
      });
      const lista = await enVivo.listarInfraccionesSesion(adminA, sesionPrecision);
      expect(lista).toHaveLength(200);
      expect(lista[0]).toMatchObject({ estado: 'abierta', inicioTs: new Date(BASE - 3_600_000) });
      // El resto, por inicioTs descendente.
      const resto = lista.slice(1).map((i) => i.inicioTs.getTime());
      expect(resto).toEqual([...resto].sort((x, y) => y - x));
    });
  });

  describe('RLS de las tablas nuevas', () => {
    it('otro sindicato no ve infracciones ni sesion_desvio_estado, ni puede escribirlas', async () => {
      await withTenantContext({ rol: 'admin_sindicato', sindicatoId: sindicatoB }, async (tx) => {
        expect(await tx.infraccion.findMany({ where: { sindicatoId: sindicatoA } })).toHaveLength(0);
        const estados = await tx.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM sesion_desvio_estado WHERE "sindicatoId" = ${sindicatoA}`;
        expect(estados[0]?.n).toBe(0);
        const upd = await tx.infraccion.updateMany({ where: { sindicatoId: sindicatoA }, data: { nota: 'hack' } });
        expect(upd.count).toBe(0);
      });
      await withTenantContext({ rol: 'admin_sindicato', sindicatoId: sindicatoA }, async (tx) => {
        expect((await tx.infraccion.findMany({ where: { sindicatoId: sindicatoA } })).length).toBeGreaterThan(0);
      });
    });

    it('un tenant no puede insertar una infracción con el sindicatoId de otro (WITH CHECK)', async () => {
      await expect(
        withTenantContext({ rol: 'admin_sindicato', sindicatoId: sindicatoB }, (tx) =>
          tx.infraccion.create({
            data: {
              sindicatoId: sindicatoA,
              sesionId: sesionDesvio,
              vehiculoId,
              conductorId,
              lineaId,
              rutaId,
              tipo: 'desvio_ruta',
              gravedad: 'leve',
              inicioTs: new Date(BASE),
              lat: 0,
              lng: 0,
              detalle: {},
              dedupeKey: `rls:${randomUUID()}`,
            },
          }),
        ),
      ).rejects.toThrow();
    });
  });
});

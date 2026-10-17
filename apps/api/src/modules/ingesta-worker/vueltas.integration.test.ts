import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { prisma, withTenantContext } from '@quivo/db';
import { Client } from 'pg';
import { fechaActualBolivia, type EventoSync } from '@quivo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { ControlPointsService } from '../control-points/control-points.service.js';
import { InfraccionesService } from '../infracciones/infracciones.service.js';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';
import { EnVivoService } from '../reportes/en-vivo.service.js';
import { SancionesService } from '../reglas/sanciones.service.js';
import { RutasService } from '../rutas/rutas.service.js';
import { VariantesService } from '../rutas/variantes.service.js';
import { vueltaContable, vueltaNoVacia } from '../vueltas/vuelta-no-vacia.js';
import { VueltasService } from '../vueltas/vueltas.service.js';
import { IngestaWorkerService } from './ingesta-worker.service.js';

/**
 * docs/plan-molinos-designacion.md, F1 — integración contra Postgres real: conteo de vueltas del
 * worker con lotes sintéticos, espera/salida de Molinos, alertas `molinos_omitido` y
 * `espera_corta`, designación (409/422/404), vuelta actual + acuse del chofer, LATERAL de
 * posiciones, resumen por línea, desvío con variante y RLS de `vueltas`.
 *
 * Geometría: la ruta base corre este-oeste sobre LAT_RUTA; Molinos está ~200 m al sur y el tramo
 * de la variante conecta la base con Molinos por ese lado. Todos los instantes salen de una base
 * fija relativa a "hace 3 h" (partición de `gps_points` existente, sin ts futuros) y se mandan
 * también como `tsFix`.
 */

const ADMIN = { rol: 'admin_quivo', sindicatoId: null } as const;
const LON_SR = -63.18;
const LON_HONDURAS = -63.175;
const LON_MOLINOS = -63.172;
const LAT_RUTA = -17.78;
// ~200 m al sur de la base (1° de latitud ≈ 111 km): Molinos y el tramo de la variante.
const LAT_SUR = LAT_RUTA - 0.0018;
const GEOM_BASE = { type: 'LineString', coordinates: [[LON_SR, LAT_RUTA], [-63.17, LAT_RUTA]] };
const GEOM_TRAMO = { type: 'LineString', coordinates: [[LON_MOLINOS, LAT_RUTA], [LON_MOLINOS, LAT_SUR]] };
const punto = (lon: number, lat: number) => JSON.stringify({ type: 'Point', coordinates: [lon, lat] });

const BASE = Date.now() - 3 * 60 * 60 * 1000;
/** Un instante del mismo día local (Bolivia) que la primera vuelta de cada sesión (`BASE`). */
const diaDeLasVueltas = new Date(BASE + 60_000);
const iso = (minutos: number, segundos = 0) => new Date(BASE + (minutos * 60 + segundos) * 1000).toISOString();

function evento(tipo: EventoSync['tipo'], ts: string, payload: Record<string, unknown>): EventoSync {
  return { eventId: randomUUID(), deviceId: 'device-vlt', ts, tipo, payload };
}
const gps = (sesionId: string, ts: string, lon: number, lat: number, accuracy = 5) =>
  evento('gps_point', ts, { sesionId, lat, lng: lon, accuracy, tsFix: ts });
const cumpl = (sesionId: string, puntoControlId: string, ts: string, lon: number, lat: number) =>
  evento('cumplimiento_punto_control', ts, { sesionId, puntoControlId, lat, lng: lon, tsFix: ts });
const inicio = (sesionId: string, ts: string) => evento('inicio_recorrido', ts, { sesionId });
const fin = (sesionId: string, ts: string) => evento('fin_recorrido', ts, { sesionId });

describe('vueltas y designación a Molinos (F1)', () => {
  const sindicatoA = randomUUID();
  const sindicatoB = randomUUID();
  const adminA: AuthenticatedUser = { userId: 'admin-a', rol: 'admin_sindicato', sindicatoId: sindicatoA };
  const adminB: AuthenticatedUser = { userId: 'admin-b', rol: 'admin_sindicato', sindicatoId: sindicatoB };
  const operadorA: AuthenticatedUser = { userId: 'operador-a', rol: 'operador', sindicatoId: sindicatoA };
  const vueltas = new VueltasService();
  const enVivo = new EnVivoService();
  const infracciones = new InfraccionesService(new SancionesService());

  let lineaId: string;
  let rutaId: string;
  let rutaSinRolesId: string;
  let rutaOtraId: string;
  let pcSr: string;
  let pcHonduras: string;
  let pcMolinos: string;
  let pcBifurcacion: string;
  let varianteId: string;
  let varianteDosId: string;
  let varianteSinEsperaId: string;
  let varianteOtraRutaId: string;
  let vehiculoId: string;
  let conductorId: string;
  let reglaId: string;
  const sesiones = {} as Record<
    | 'ciclo' | 'larga' | 'corta' | 'omitida' | 'fin' | 'desorden' | 'sinRoles' | 'desvio' | 'carrera'
    | 'vacia' | 'cierreVacia' | 'cierreDesig' | 'cierreSinTenant' | 'inactiva' | 'esperaTardia' | 'retro'
    | 'omitidaFin' | 'cierreTardio' | 'estacionado' | 'espNoDesig' | 'cursor'
    | 'tardioN1' | 'tardioVacia' | 'carreraDesig' | 'gpsDesorden' | 'cierreResidual'
    | 'desvioDesig' | 'yaFue' | 'omitidaLuego' | 'tardia' | 'cancelaDiferida' | 'esperaLuego' | 'desigYTardia',
    string
  >;

  function servicioSinCola(): { procesarLote(job: unknown): Promise<{ procesados: number; errores: number }> } {
    const servicio = Object.create(IngestaWorkerService.prototype) as Record<string, unknown>;
    servicio.logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
    servicio.ingestaQueueStats = { getWaitingCount: async () => 0 };
    return servicio as never;
  }
  const lote = (eventos: EventoSync[], sindicatoId = sindicatoA) =>
    servicioSinCola().procesarLote({ id: 'job-vlt', data: { sindicatoId, eventos } });

  const vueltasDe = (sesionId: string) =>
    withTenantContext(ADMIN, (tx) => tx.vuelta.findMany({ where: { sesionId }, orderBy: { numero: 'asc' } }));
  const infraccionesDe = (sesionId: string) =>
    withTenantContext(ADMIN, (tx) => tx.infraccion.findMany({ where: { sesionId }, orderBy: { inicioTs: 'asc' } }));
  const sesionMovil = (sesionId: string, sindicatoId = sindicatoA): SesionMovilAutenticada => ({
    sesionId,
    sindicatoId,
    asignacionId: 'n/a',
    vehiculoId,
    conductorId,
    deviceId: 'device-vlt',
  });
  const cerrarSesion = (sesionId: string) => {
    const fin = new Date();
    return withTenantContext(ADMIN, (tx) =>
      tx.sesionOperativa.update({ where: { id: sesionId }, data: { estado: 'cerrada', fin, revokedAt: fin } }),
    );
  };
  /** Un ciclo SR → Honduras en `minutos` (deja la vuelta con retorno pasado). */
  const hastaHonduras = (sesionId: string, desde: number) => [
    cumpl(sesionId, pcSr, iso(desde), LON_SR, LAT_RUTA),
    cumpl(sesionId, pcHonduras, iso(desde + 20), LON_HONDURAS, LAT_RUTA),
  ];

  beforeAll(async () => {
    await withTenantContext(ADMIN, async (tx) => {
      await tx.sindicato.create({ data: { id: sindicatoA, nombre: 'Vueltas A', estado: 'activo' } });
      await tx.sindicato.create({ data: { id: sindicatoB, nombre: 'Vueltas B', estado: 'activo' } });
      lineaId = (await tx.linea.create({ data: { sindicatoId: sindicatoA, codigo: 'VLT1', nombre: 'Línea Vueltas' } })).id;
      const crearRuta = async (sentido: string, desvioHabilitado: boolean) => {
        const id = randomUUID();
        await tx.$executeRaw`
          INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "desvioHabilitado", "createdAt", "updatedAt")
          VALUES (${id}, ${lineaId}, ${sentido},
                  ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(GEOM_BASE)}), 4326)::geography,
                  'activo', ${desvioHabilitado}, now(), now())`;
        return id;
      };
      rutaId = await crearRuta('circuito', true);
      rutaSinRolesId = await crearRuta('sin-roles', false);
      rutaOtraId = await crearRuta('otra', false);
      const crearPc = async (ruta: string, orden: number, lon: number, lat: number, radio: number, rol: string | null, esperaMin: number | null) => {
        const id = randomUUID();
        await tx.$executeRaw`
          INSERT INTO puntos_control (id, "rutaId", orden, coord, "radioToleranciaM", obligatorio, rol, "esperaMin", "createdAt", "updatedAt")
          VALUES (${id}, ${ruta}, ${orden}, ST_SetSRID(ST_GeomFromGeoJSON(${punto(lon, lat)}), 4326)::geography,
                  ${radio}, false, ${rol}, ${esperaMin}, now(), now())`;
        return id;
      };
      pcSr = await crearPc(rutaId, 0, LON_SR, LAT_RUTA, 100, 'terminal', null);
      pcHonduras = await crearPc(rutaId, 1, LON_HONDURAS, LAT_RUTA, 100, 'retorno', null);
      pcMolinos = await crearPc(rutaId, 2, LON_MOLINOS, LAT_SUR, 50, 'espera', 30);
      // Bifurcación: PC común después del retorno, junto al inicio del tramo de la variante.
      pcBifurcacion = await crearPc(rutaId, 3, LON_MOLINOS, LAT_RUTA, 50, null, null);
      // Ruta sin ningún rol: no cuenta vueltas.
      await crearPc(rutaSinRolesId, 0, LON_SR, LAT_RUTA, 100, null, null);
      const crearVariante = async (ruta: string, nombre: string, puntoEspera: string | null, conGeometria: boolean) => {
        const id = randomUUID();
        await tx.variante.create({ data: { id, rutaId: ruta, nombre, puntoEsperaId: puntoEspera } });
        if (conGeometria) {
          await tx.$executeRaw`
            UPDATE variantes SET geometria = ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(GEOM_TRAMO)}), 4326)::geography WHERE id = ${id}`;
        }
        return id;
      };
      varianteId = await crearVariante(rutaId, 'Vía Molinos', pcMolinos, true);
      varianteDosId = await crearVariante(rutaId, 'Vía Molinos 2', pcMolinos, true);
      varianteSinEsperaId = await crearVariante(rutaId, 'Sin punto de espera', null, false);
      varianteOtraRutaId = await crearVariante(rutaOtraId, 'Otra ruta', null, false);

      vehiculoId = (
        await tx.vehiculo.create({
          data: { sindicatoId: sindicatoA, placa: `VL${randomUUID().slice(0, 5).toUpperCase()}`, tipo: 'bus', marca: 'x', modelo: 'x', color: 'x', capacidad: 10, estado: 'activo' },
        })
      ).id;
      conductorId = (
        await tx.conductor.create({
          data: { sindicatoId: sindicatoA, nombre: 'Conductor Vueltas', documentoIdentidad: `VLT-${randomUUID()}`, licenciaConducir: 'L1' },
        })
      ).id;
      const rotacion = await tx.rotacion.create({ data: { sindicatoId: sindicatoA, periodo: '2026-10', estado: 'publicada' } });
      const asignacion = async (ruta: string, horario: string, orden: number) =>
        (
          await tx.asignacion.create({
            data: {
              rotacionId: rotacion.id, vehiculoId, conductorId, rutaId: ruta,
              fecha: fechaActualBolivia(new Date()), horario, orden,
              venceAt: new Date(Date.now() + 3_600_000), estado: 'vigente',
            },
          })
        ).id;
      const asigCirc = await asignacion(rutaId, 'manana', 1);
      const asigSinRoles = await asignacion(rutaSinRolesId, 'tarde', 2);
      // Cada sesión usa SU vehículo (salvo `ciclo`): el tope "ya fue a Molinos hoy" es por vehículo y
      // día, y las sesiones que llegan a Molinos no deben bloquear a las demás.
      const crearSesion = async (asignacionId: string, propio = true) =>
        (
          await tx.sesionOperativa.create({
            data: {
              sindicatoId: sindicatoA, asignacionId, conductorId,
              vehiculoId: propio
                ? (
                    await tx.vehiculo.create({
                      data: { sindicatoId: sindicatoA, placa: `VL${randomUUID().slice(0, 5).toUpperCase()}`, tipo: 'bus', marca: 'x', modelo: 'x', color: 'x', capacidad: 10, estado: 'activo' },
                    })
                  ).id
                : vehiculoId, deviceId: 'device-vlt',
              accessTokenHash: randomUUID(), refreshTokenHash: randomUUID(),
              accessExpiresAt: new Date(Date.now() + 3_600_000), refreshExpiresAt: new Date(Date.now() + 3_600_000),
            },
          })
        ).id;
      for (const k of [
        'ciclo', 'larga', 'corta', 'omitida', 'fin', 'desorden', 'desvio', 'carrera',
        'vacia', 'cierreVacia', 'cierreDesig', 'cierreSinTenant', 'inactiva', 'esperaTardia', 'retro', 'omitidaFin',
        'cierreTardio', 'estacionado', 'espNoDesig', 'cursor',
        'tardioN1', 'tardioVacia', 'carreraDesig', 'gpsDesorden', 'cierreResidual',
        'desvioDesig', 'yaFue', 'omitidaLuego', 'tardia', 'cancelaDiferida', 'esperaLuego', 'desigYTardia',
      ] as const) {
        sesiones[k] = await crearSesion(asigCirc, k !== 'ciclo');
      }
      sesiones.sinRoles = await crearSesion(asigSinRoles, false);
      reglaId = (
        await tx.regla.create({ data: { sindicatoId: sindicatoA, nombre: 'Sanción genérica', tipo: 'operativo', gravedad: 'grave', aplicaA: 'conductor' } })
      ).id;
    });
  });

  afterAll(async () => {
    await withTenantContext(ADMIN, async (tx) => {
      const ids = { in: [sindicatoA, sindicatoB] };
      await tx.sancion.deleteMany({ where: { sindicatoId: ids } });
      await tx.infraccion.deleteMany({ where: { sindicatoId: ids } });
      await tx.vuelta.deleteMany({ where: { sindicatoId: ids } });
      await tx.$executeRaw`DELETE FROM sesion_desvio_estado WHERE "sindicatoId" IN (${sindicatoA}, ${sindicatoB})`;
      await tx.$executeRaw`DELETE FROM gps_sesion_resumen WHERE "sindicatoId" IN (${sindicatoA}, ${sindicatoB})`;
      await tx.$executeRaw`DELETE FROM gps_points WHERE "sindicatoId" IN (${sindicatoA}, ${sindicatoB})`;
      await tx.syncError.deleteMany({ where: { sindicatoId: ids } });
      await tx.cumplimientoPc.deleteMany({ where: { sindicatoId: ids } });
      await tx.eventoOperativo.deleteMany({ where: { sindicatoId: ids } });
      await tx.sesionOperativa.deleteMany({ where: { sindicatoId: ids } });
      await tx.asignacion.deleteMany({ where: { rutaId: { in: [rutaId, rutaSinRolesId, rutaOtraId] } } });
      await tx.rotacion.deleteMany({ where: { sindicatoId: ids } });
      await tx.vehiculo.deleteMany({ where: { sindicatoId: ids } });
      await tx.conductor.deleteMany({ where: { sindicatoId: ids } });
      await tx.variante.deleteMany({ where: { rutaId: { in: [rutaId, rutaSinRolesId, rutaOtraId] } } });
      await tx.$executeRaw`DELETE FROM puntos_control WHERE "rutaId" IN (${rutaId}, ${rutaSinRolesId}, ${rutaOtraId})`;
      await tx.$executeRaw`DELETE FROM rutas WHERE id IN (${rutaId}, ${rutaSinRolesId}, ${rutaOtraId})`;
      await tx.linea.deleteMany({ where: { sindicatoId: ids } });
      await tx.regla.deleteMany({ where: { sindicatoId: ids } });
      await tx.sindicato.deleteMany({ where: { id: ids } });
    });
    await prisma.$disconnect();
  });

  describe('conteo de vueltas en el worker', () => {
    it('SR → Honduras → SR cierra la vuelta 1 y deja la 2 en curso (varios lotes, fecha local de Bolivia)', async () => {
      const s = sesiones.ciclo;
      expect(await lote([inicio(s, iso(0)), cumpl(s, pcSr, iso(0, 10), LON_SR, LAT_RUTA)])).toEqual({ procesados: 2, errores: 0 });
      let filas = await vueltasDe(s);
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({ numero: 1, estado: 'en_curso', vehiculoId, conductorId, lineaId, rutaId });
      // El `inicio_recorrido` (reloj del sistema) y el SR (GNSS) del mismo arranque no duplican.
      expect(filas[0]!.inicioTs.toISOString()).toBe(iso(0));
      expect(filas[0]!.fecha.getTime()).toBe(fechaActualBolivia(filas[0]!.inicioTs).getTime());

      await lote([cumpl(s, pcHonduras, iso(20), LON_HONDURAS, LAT_RUTA)]);
      filas = await vueltasDe(s);
      expect(filas[0]!.pasoRetornoTs?.toISOString()).toBe(iso(20));

      await lote([cumpl(s, pcSr, iso(45), LON_SR, LAT_RUTA)]);
      filas = await vueltasDe(s);
      expect(filas.map((f) => [f.numero, f.estado])).toEqual([[1, 'completa'], [2, 'en_curso']]);
      expect(filas[0]!.finTs?.toISOString()).toBe(iso(45));
      expect(filas[1]!.inicioTs.toISOString()).toBe(iso(45));
    });

    it('reenviar el mismo lote (idempotencia del outbox) no abre ni cierra nada más', async () => {
      const s = sesiones.ciclo;
      const reenvio = [cumpl(s, pcSr, iso(45), LON_SR, LAT_RUTA), cumpl(s, pcHonduras, iso(20), LON_HONDURAS, LAT_RUTA)];
      await lote(reenvio);
      await lote(reenvio);
      expect((await vueltasDe(s)).map((f) => [f.numero, f.estado])).toEqual([[1, 'completa'], [2, 'en_curso']]);
    });

    it('SR → SR sin Honduras no cuenta vuelta; un cumplimiento tardío (anterior a la vuelta) no mueve la máquina', async () => {
      const s = sesiones.desorden;
      await lote([cumpl(s, pcSr, iso(10), LON_SR, LAT_RUTA), cumpl(s, pcSr, iso(40), LON_SR, LAT_RUTA)]);
      expect((await vueltasDe(s)).map((f) => f.estado)).toEqual(['en_curso']);
      // Honduras fechado ANTES del inicio de la vuelta llega tarde: se ignora.
      await lote([cumpl(s, pcHonduras, iso(5), LON_HONDURAS, LAT_RUTA)]);
      expect((await vueltasDe(s))[0]!.pasoRetornoTs).toBeNull();
      // Dentro de un lote el orden de llegada da igual: se ordena por ts.
      await lote([
        cumpl(s, pcSr, iso(90), LON_SR, LAT_RUTA),
        cumpl(s, pcHonduras, iso(60), LON_HONDURAS, LAT_RUTA),
      ]);
      expect((await vueltasDe(s)).map((f) => [f.numero, f.estado])).toEqual([[1, 'completa'], [2, 'en_curso']]);
    });

    it('fin_recorrido deja la vuelta en curso abierta_al_cierre', async () => {
      const s = sesiones.fin;
      await lote([...hastaHonduras(s, 0)]);
      await lote([fin(s, iso(30))]);
      const [v] = await vueltasDe(s);
      expect(v).toMatchObject({ numero: 1, estado: 'abierta_al_cierre' });
      expect(v!.finTs?.toISOString()).toBe(iso(30));
      // El GPS que sigue pasando por la terminal con el recorrido terminado no abre vueltas.
      await lote([cumpl(s, pcSr, iso(40), LON_SR, LAT_RUTA)]);
      expect(await vueltasDe(s)).toHaveLength(1);
    });

    it('una ruta sin PC terminal no cuenta vueltas', async () => {
      const s = sesiones.sinRoles;
      await lote([inicio(s, iso(0)), gps(s, iso(1), LON_SR, LAT_RUTA)]);
      expect(await vueltasDe(s)).toHaveLength(0);
    });

    it('una sesión de otro sindicato (sesionId ajeno en el payload) no crea vueltas', async () => {
      await lote([inicio(sesiones.ciclo, iso(500))], sindicatoB);
      expect((await vueltasDe(sesiones.ciclo)).filter((v) => v.sindicatoId === sindicatoB)).toHaveLength(0);
    });

    it('existe a lo sumo UNA vuelta en curso por sesión (índice parcial único) y (sesionId, numero) es único', async () => {
      const [v1] = await vueltasDe(sesiones.ciclo);
      await expect(
        withTenantContext(ADMIN, (tx) =>
          tx.vuelta.create({
            data: { sindicatoId: sindicatoA, sesionId: sesiones.ciclo, vehiculoId, conductorId, lineaId, rutaId, fecha: v1!.fecha, numero: 99, inicioTs: new Date(BASE), estado: 'en_curso' },
          }),
        ),
      ).rejects.toThrow();
      await expect(
        withTenantContext(ADMIN, (tx) =>
          tx.vuelta.create({
            data: { sindicatoId: sindicatoA, sesionId: sesiones.ciclo, vehiculoId, conductorId, lineaId, rutaId, fecha: v1!.fecha, numero: 1, inicioTs: new Date(BASE), estado: 'completa' },
          }),
        ),
      ).rejects.toThrow();
    });
  });

  describe('designación (PUT /reportes/en-vivo/:sesionId/vuelta-actual/designacion)', () => {
    it('sin vuelta en curso responde 409', async () => {
      await expect(vueltas.designar(adminA, sesiones.larga, varianteId)).rejects.toBeInstanceOf(ConflictException);
      await expect(vueltas.designar(adminA, sesiones.sinRoles, varianteId)).rejects.toBeInstanceOf(ConflictException);
    });

    it('valida la variante: ruta ajena y sin punto de espera → 422; sesión de otro tenant → 404', async () => {
      await lote([inicio(sesiones.larga, iso(0)), cumpl(sesiones.larga, pcSr, iso(0, 5), LON_SR, LAT_RUTA)]);
      await expect(vueltas.designar(adminA, sesiones.larga, varianteOtraRutaId)).rejects.toBeInstanceOf(UnprocessableEntityException);
      await expect(vueltas.designar(adminA, sesiones.larga, varianteSinEsperaId)).rejects.toBeInstanceOf(UnprocessableEntityException);
      await expect(vueltas.designar(adminA, sesiones.larga, randomUUID())).rejects.toBeInstanceOf(UnprocessableEntityException);
      await expect(vueltas.designar(adminB, sesiones.larga, varianteId)).rejects.toBeInstanceOf(NotFoundException);
      await expect(vueltas.designar(adminA, randomUUID(), varianteId)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('el operador (control) designa y cancela; guarda quién/cuándo y limpia el acuse', async () => {
      const r = await vueltas.designar(operadorA, sesiones.larga, varianteId);
      expect(r).toMatchObject({ numero: 1, estado: 'en_curso', varianteId, varianteNombre: 'Vía Molinos', designadaPor: 'operador-a', acuseEn: null, sindicatoId: sindicatoA });
      expect(r.designadaEn).not.toBeNull();
      // Misma variante otra vez: no-op (no re-notifica al chofer).
      const igual = await vueltas.designar(adminA, sesiones.larga, varianteId);
      expect(igual.designadaEn).toBe(r.designadaEn);
      expect(igual.designadaPor).toBe('operador-a');
      // Cancelar con null.
      const cancelada = await vueltas.designar(adminA, sesiones.larga, null);
      expect(cancelada).toMatchObject({ varianteId: null, varianteNombre: null, designadaPor: 'admin-a', acuseEn: null });
      // Volver a designar.
      expect((await vueltas.designar(adminA, sesiones.larga, varianteId)).varianteId).toBe(varianteId);
    });
  });

  describe('vuelta actual y acuse del chofer', () => {
    it('GET devuelve la designación con tramo GeoJSON y punto de espera; sin vuelta → vueltaId null', async () => {
      const sinVuelta = await vueltas.obtenerActualMovil(sesionMovil(sesiones.sinRoles));
      expect(sinVuelta).toEqual({ vueltaId: null, numero: null, designacion: null, enEspera: null });

      const act = await vueltas.obtenerActualMovil(sesionMovil(sesiones.larga));
      const [v] = await vueltasDe(sesiones.larga);
      expect(act.vueltaId).toBe(v!.id);
      expect(act.numero).toBe(1);
      expect(act.enEspera).toBeNull();
      expect(act.designacion).toMatchObject({
        varianteId,
        nombre: 'Vía Molinos',
        designadaEn: v!.designadaEn!.toISOString(),
        acuseEn: null,
        puntoEspera: { id: pcMolinos, esperaMin: 30 },
      });
      expect(act.designacion!.tramo?.type).toBe('LineString');
      expect(act.designacion!.tramo?.coordinates.length).toBe(2);
      expect(act.designacion!.puntoEspera.coord.coordinates[0]).toBeCloseTo(LON_MOLINOS, 5);
    });

    it('una sesión no ve la vuelta de otra, ni siquiera con un token de otro tenant', async () => {
      const otra = await vueltas.obtenerActualMovil(sesionMovil(sesiones.desorden));
      expect(otra.designacion).toBeNull();
      const ajena = await vueltas.obtenerActualMovil(sesionMovil(sesiones.larga, sindicatoB));
      expect(ajena.vueltaId).toBeNull();
    });

    it('el acuse con designadaEn viejo (la web cambió la designación) se ignora y devuelve el estado actual', async () => {
      const [v] = await vueltasDe(sesiones.larga);
      const designadaEn = v!.designadaEn!.toISOString();
      const rancio = await vueltas.acusar(sesionMovil(sesiones.larga), { vueltaId: v!.id, designadaEn: new Date(v!.designadaEn!.getTime() - 5000).toISOString() });
      expect(rancio.designacion?.acuseEn).toBeNull();
      // Acuse de una vuelta que no es de la sesión del token: ignorado.
      const ajeno = await vueltas.acusar(sesionMovil(sesiones.desorden), { vueltaId: v!.id, designadaEn });
      expect(ajeno.designacion).toBeNull();
      expect((await vueltasDe(sesiones.larga))[0]!.acuseEn).toBeNull();
      // Acuse de otro tenant: ignorado.
      await vueltas.acusar(sesionMovil(sesiones.larga, sindicatoB), { vueltaId: v!.id, designadaEn });
      expect((await vueltasDe(sesiones.larga))[0]!.acuseEn).toBeNull();
      // Acuse correcto, e idempotente (el segundo no mueve acuseEn).
      const ok = await vueltas.acusar(sesionMovil(sesiones.larga), { vueltaId: v!.id, designadaEn });
      expect(ok.designacion?.acuseEn).not.toBeNull();
      const primero = ok.designacion!.acuseEn;
      const repetido = await vueltas.acusar(sesionMovil(sesiones.larga), { vueltaId: v!.id, designadaEn });
      expect(repetido.designacion?.acuseEn).toBe(primero);
    });

    it('re-designar limpia el acuse y un acuse con la designadaEn anterior ya no aplica', async () => {
      const [antes] = await vueltasDe(sesiones.larga);
      await vueltas.designar(adminA, sesiones.larga, null);
      const nueva = await vueltas.designar(adminA, sesiones.larga, varianteId);
      expect(nueva.acuseEn).toBeNull();
      expect(nueva.designadaEn).not.toBe(antes!.designadaEn!.toISOString());
      const r = await vueltas.acusar(sesionMovil(sesiones.larga), { vueltaId: antes!.id, designadaEn: antes!.designadaEn!.toISOString() });
      expect(r.designacion?.acuseEn).toBeNull();
    });
  });

  describe('espera en Molinos', () => {
    it('vía Molinos con 35 min de espera: llegada, salida y SIN alerta; luego cierra en SR sin molinos_omitido', async () => {
      const s = sesiones.larga;
      await lote([
        cumpl(s, pcHonduras, iso(20), LON_HONDURAS, LAT_RUTA),
        cumpl(s, pcMolinos, iso(30), LON_MOLINOS, LAT_SUR),
        gps(s, iso(31), LON_MOLINOS, LAT_SUR),
      ]);
      let [v] = await vueltasDe(s);
      expect(v!.esperaLlegadaTs?.toISOString()).toBe(iso(30));
      expect(v!.esperaSalidaTs).toBeNull();
      // Con la unidad en espera el resumen de posiciones lo marca.
      const pos = (await enVivo.obtenerPosiciones(adminA)).find((p) => p.id === s)!;
      expect(pos.vuelta).toMatchObject({ numero: 1, varianteId, varianteNombre: 'Vía Molinos', enEspera: true, esperaDesdeTs: iso(30) });
      // Designar ahora es 409: ya llegó al punto de espera.
      await expect(vueltas.designar(adminA, s, null)).rejects.toBeInstanceOf(ConflictException);
      await expect(vueltas.designar(operadorA, s, varianteId)).rejects.toBeInstanceOf(ConflictException);
      expect((await vueltas.obtenerActualMovil(sesionMovil(s))).enEspera).toEqual({ desdeTs: iso(30) });

      // Sale a los 35 min: dos fixes consecutivos lejos (en lotes distintos: el estado se rederiva de gps_points).
      await lote([gps(s, iso(65), LON_SR, LAT_RUTA)]);
      expect((await vueltasDe(s))[0]!.esperaSalidaTs).toBeNull();
      await lote([gps(s, iso(65, 20), LON_SR, LAT_RUTA)]);
      [v] = await vueltasDe(s);
      expect(v!.esperaSalidaTs?.toISOString()).toBe(iso(65));
      expect((await infraccionesDe(s)).filter((i) => i.tipo === 'espera_corta')).toHaveLength(0);

      await lote([cumpl(s, pcSr, iso(80), LON_SR, LAT_RUTA)]);
      expect((await vueltasDe(s)).map((f) => [f.numero, f.estado])).toEqual([[1, 'completa'], [2, 'en_curso']]);
      expect(await infraccionesDe(s)).toHaveLength(0);
    });

    it('con 20 min de espera: espera_corta (leve) con detalle {esperaMin, requeridoMin}; es solo alerta (sancionar → 409)', async () => {
      const s = sesiones.corta;
      await lote([inicio(s, iso(0)), ...hastaHonduras(s, 0).slice(0, 1)]);
      await vueltas.designar(adminA, s, varianteId);
      await lote([
        cumpl(s, pcHonduras, iso(20), LON_HONDURAS, LAT_RUTA),
        cumpl(s, pcMolinos, iso(30), LON_MOLINOS, LAT_SUR),
        gps(s, iso(40), LON_MOLINOS, LAT_SUR),
        // Fix impreciso lejos (accuracy 80): no cuenta como salida.
        gps(s, iso(49), LON_SR, LAT_RUTA, 80),
        gps(s, iso(50), LON_SR, LAT_RUTA),
        gps(s, iso(50, 20), LON_SR, LAT_RUTA),
      ]);
      const [v] = await vueltasDe(s);
      expect(v!.esperaSalidaTs?.toISOString()).toBe(iso(50));
      const alertas = (await infraccionesDe(s)).filter((i) => i.tipo === 'espera_corta');
      expect(alertas).toHaveLength(1);
      expect(alertas[0]).toMatchObject({
        gravedad: 'leve', estado: 'abierta', dedupeKey: `espera_corta:${v!.id}`,
        detalle: { esperaMin: 20, requeridoMin: 30, vueltaId: v!.id },
      });
      // Reprocesar no duplica.
      await lote([gps(s, iso(50, 40), LON_SR, LAT_RUTA)]);
      expect((await infraccionesDe(s)).filter((i) => i.tipo === 'espera_corta')).toHaveLength(1);
      await expect(
        infracciones.sancionar(adminA, alertas[0]!.id, { reglaId, sujetoTipo: 'conductor', sujetoId: conductorId, motivo: 'x', fechaHecho: new Date() }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('designada que cierra en SR sin pasar por Molinos: molinos_omitido (grave), una sola vez, sancionable', async () => {
      const s = sesiones.omitida;
      await lote([inicio(s, iso(0)), cumpl(s, pcSr, iso(0, 5), LON_SR, LAT_RUTA)]);
      await vueltas.designar(adminA, s, varianteId);
      await lote([cumpl(s, pcHonduras, iso(20), LON_HONDURAS, LAT_RUTA), cumpl(s, pcSr, iso(45), LON_SR, LAT_RUTA)]);
      const [v1, v2] = await vueltasDe(s);
      expect(v1).toMatchObject({ estado: 'completa', varianteId });
      // La vuelta nueva NO hereda la designación (vive en la vuelta).
      expect(v2).toMatchObject({ numero: 2, estado: 'en_curso', varianteId: null });
      const omitidas = (await infraccionesDe(s)).filter((i) => i.tipo === 'molinos_omitido');
      expect(omitidas).toHaveLength(1);
      expect(omitidas[0]).toMatchObject({
        gravedad: 'grave', estado: 'abierta', dedupeKey: `molinos_omitido:${v1!.id}`,
        detalle: { vueltaId: v1!.id, numero: 1, varianteId },
      });
      await lote([cumpl(s, pcSr, iso(45), LON_SR, LAT_RUTA)]);
      expect((await infraccionesDe(s)).filter((i) => i.tipo === 'molinos_omitido')).toHaveLength(1);
      const sancionada = await infracciones.sancionar(adminA, omitidas[0]!.id, {
        reglaId, sujetoTipo: 'conductor', sujetoId: conductorId, motivo: 'Molinos omitido', fechaHecho: new Date(),
      });
      expect(sancionada.estado).toBe('sancionada');
    });

    it('la gravedad de las alertas nuevas sale de la Regla reservada del sindicato si existe', async () => {
      const regla = await withTenantContext(ADMIN, (tx) =>
        tx.regla.create({ data: { sindicatoId: sindicatoA, nombre: 'Espera corta', tipo: 'espera_corta', gravedad: 'gravisima', aplicaA: 'conductor' } }),
      );
      const s = sesiones.carrera;
      await lote([inicio(s, iso(0)), cumpl(s, pcSr, iso(0, 5), LON_SR, LAT_RUTA)]);
      await vueltas.designar(adminA, s, varianteId);
      await lote([
        cumpl(s, pcHonduras, iso(20), LON_HONDURAS, LAT_RUTA),
        cumpl(s, pcMolinos, iso(30), LON_MOLINOS, LAT_SUR),
        gps(s, iso(32), LON_SR, LAT_RUTA),
        gps(s, iso(32, 30), LON_SR, LAT_RUTA),
      ]);
      const [alerta] = (await infraccionesDe(s)).filter((i) => i.tipo === 'espera_corta');
      expect(alerta).toMatchObject({ gravedad: 'gravisima', reglaId: regla.id });
      await withTenantContext(ADMIN, (tx) => tx.regla.delete({ where: { id: regla.id } }).catch(() => undefined));
    });
  });

  describe('desvío con la vuelta designada', () => {
    const puntosSobreTramo = (s: string, desdeMin: number) =>
      [0, 20, 40, 60].map((seg) => gps(s, iso(desdeMin, seg), LON_MOLINOS, LAT_SUR));

    it('sin designación, subir por el tramo (200 m de la base) cuenta como desvío', async () => {
      const s = sesiones.desvio;
      await lote([inicio(s, iso(0)), cumpl(s, pcSr, iso(0, 5), LON_SR, LAT_RUTA), ...puntosSobreTramo(s, 10)]);
      expect((await infraccionesDe(s)).filter((i) => i.tipo === 'desvio_ruta')).toHaveLength(1);
    });

    it('con la vuelta designada a la variante, los mismos puntos sobre el tramo NO son desvío (LEAST base/tramo)', async () => {
      // Sesión (y vehículo) propios, designada antes de los puntos: un vehículo que ya llegó a
      // Molinos hoy no se puede volver a designar.
      const s = sesiones.desvioDesig;
      await lote([inicio(s, iso(0)), cumpl(s, pcSr, iso(0, 5), LON_SR, LAT_RUTA)]);
      expect((await vueltasDe(s)).at(-1)!.estado).toBe('en_curso');
      await vueltas.designar(adminA, s, varianteId);
      await lote(puntosSobreTramo(s, 10));
      expect((await infraccionesDe(s)).filter((i) => i.tipo === 'desvio_ruta')).toHaveLength(0);
    });
  });

  describe('mapa en vivo: LATERAL de posiciones y resumen Molinos', () => {
    it('molinosHoy es true solo para el vehículo que LLEGÓ a Molinos hoy (no por estar designado); vuelta null sin vuelta en curso', async () => {
      // "Hoy" = el día local de las vueltas del test (no el del reloj de la máquina: pasada la
      // medianoche de Bolivia, `BASE` —hace 3 h— cae en el día anterior).
      const posiciones = await enVivo.obtenerPosiciones(adminA, diaDeLasVueltas);
      const larga = posiciones.find((p) => p.id === sesiones.larga)!;
      // `larga` llegó a Molinos en su vuelta 1 (ver arriba); `retro` pasó por el PC de espera pero sin
      // estar designada: no llegó, no cuenta como "ya fue".
      expect(larga.molinosHoy).toBe(true);
      expect(posiciones.find((p) => p.id === sesiones.retro)!.molinosHoy).toBe(false);
      const sinRoles = posiciones.find((p) => p.id === sesiones.sinRoles)!;
      expect(sinRoles.vuelta).toBeNull();
      expect(sinRoles.infraccionesAtendidas).toBe(0);
    });

    it('infraccionNivel solo cuenta ABIERTAS; las atendidas dejan el ícono fijo en infraccionNivelAtendida (pendiente E #1)', async () => {
      const s = sesiones.corta;
      const abierta = (await infraccionesDe(s)).find((i) => i.tipo === 'espera_corta')!;
      const antes = (await enVivo.obtenerPosiciones(adminA)).find((p) => p.id === s)!;
      expect(antes).toMatchObject({ infraccionesAbiertas: 1, infraccionesAtendidas: 0, infraccionNivel: 'leve', infraccionNivelAtendida: null });

      await infracciones.actualizar(adminA, abierta.id, { accion: 'atender' });
      const atendida = (await enVivo.obtenerPosiciones(adminA)).find((p) => p.id === s)!;
      // Sin abiertas el marcador NO parpadea (infraccionNivel null: la web lo lee como "nivel de
      // las abiertas"), pero conserva el ícono fijo vía infraccionNivelAtendida.
      expect(atendida).toMatchObject({
        infraccionesAbiertas: 0,
        infraccionesAtendidas: 1,
        infraccionNivel: null,
        infraccionNivelAtendida: 'leve',
      });

      // Descartada o sancionada ya no cuentan.
      await infracciones.actualizar(adminA, abierta.id, { accion: 'descartar' });
      const descartada = (await enVivo.obtenerPosiciones(adminA)).find((p) => p.id === s)!;
      expect(descartada).toMatchObject({ infraccionesAbiertas: 0, infraccionesAtendidas: 0, infraccionNivel: null, infraccionNivelAtendida: null });
    });

    it('infraccionNivel = máximo de las abiertas; infraccionNivelAtendida = máximo de las atendidas', async () => {
      const s = sesiones.larga;
      const base = { sindicatoId: sindicatoA, sesionId: s, vehiculoId, conductorId, lineaId, rutaId, inicioTs: new Date(BASE), lat: 0, lng: 0, detalle: {} };
      await withTenantContext(ADMIN, async (tx) => {
        await tx.infraccion.create({ data: { ...base, tipo: 'desvio_ruta', gravedad: 'gravisima', estado: 'atendida', dedupeKey: `max:${randomUUID()}` } });
        await tx.infraccion.create({ data: { ...base, tipo: 'pc_omitido', gravedad: 'leve', estado: 'abierta', dedupeKey: `max:${randomUUID()}` } });
      });
      const p = (await enVivo.obtenerPosiciones(adminA)).find((x) => x.id === s)!;
      expect(p).toMatchObject({ infraccionesAbiertas: 1, infraccionesAtendidas: 1, infraccionNivel: 'leve', infraccionNivelAtendida: 'gravisima' });
    });

    it('resumen Molinos por línea: en espera, último envío y próximo sugerido', async () => {
      const ahora = diaDeLasVueltas;
      const r = await vueltas.resumenMolinos(adminA, ahora);
      const linea = r.lineas.find((l) => l.lineaId === lineaId)!;
      expect(linea.lineaNombre).toBe('Línea Vueltas');
      expect(linea.flotaActiva).toBeGreaterThan(0);
      expect(linea.ultimoEnvioTs).not.toBeNull();
      expect(linea.intervaloObjetivoMs).toBeGreaterThanOrEqual(60_000);
      const esperado = new Date(Date.parse(linea.ultimoEnvioTs!) + linea.intervaloObjetivoMs);
      expect(linea.proximoSugeridoEn).toBe(esperado.toISOString());
      // Otro tenant no ve la línea.
      expect((await vueltas.resumenMolinos(adminB, ahora)).lineas.find((l) => l.lineaId === lineaId)).toBeUndefined();
    });
  });

  describe('RLS de vueltas', () => {
    it('otro sindicato no ve ni modifica las vueltas, ni puede insertar con el sindicatoId de otro', async () => {
      await withTenantContext({ rol: 'admin_sindicato', sindicatoId: sindicatoB }, async (tx) => {
        expect(await tx.vuelta.findMany({ where: { sindicatoId: sindicatoA } })).toHaveLength(0);
        expect(await tx.vuelta.count()).toBe(0);
        const upd = await tx.vuelta.updateMany({ where: { sindicatoId: sindicatoA }, data: { acuseEn: new Date() } });
        expect(upd.count).toBe(0);
        expect((await tx.vuelta.deleteMany({ where: { sindicatoId: sindicatoA } })).count).toBe(0);
      });
      await withTenantContext({ rol: 'admin_sindicato', sindicatoId: sindicatoA }, async (tx) => {
        expect((await tx.vuelta.findMany({ where: { sindicatoId: sindicatoA } })).length).toBeGreaterThan(0);
      });
      await expect(
        withTenantContext({ rol: 'admin_sindicato', sindicatoId: sindicatoB }, (tx) =>
          tx.vuelta.create({
            data: { sindicatoId: sindicatoA, sesionId: sesiones.ciclo, vehiculoId, conductorId, lineaId, rutaId, fecha: new Date(), numero: 500, inicioTs: new Date(BASE), estado: 'completa' },
          }),
        ),
      ).rejects.toThrow();
    });
  });

  describe('rol/espera de puntos de control y tramo de variantes (solo admin)', () => {
    const puntos = new ControlPointsService();
    const variantes = new VariantesService();

    it('un operador no puede configurar rol/esperaMin de un PC (403) pero un admin sí; incoherencias → 400', async () => {
      await expect(puntos.actualizar(operadorA, pcSr, { rol: 'terminal' })).rejects.toBeInstanceOf(ForbiddenException);
      const ok = await puntos.actualizar(adminA, pcHonduras, { rol: 'retorno' });
      expect(ok.rol).toBe('retorno');
      await expect(puntos.actualizar(adminA, pcHonduras, { esperaMin: 10 })).rejects.toThrow(/esperaMin solo aplica/);
      await expect(puntos.actualizar(adminA, pcHonduras, { rol: 'espera' })).rejects.toThrow(/necesita esperaMin/);
      const espera = await puntos.actualizar(adminA, pcHonduras, { rol: 'espera', esperaMin: 15 });
      expect(espera).toMatchObject({ rol: 'espera', esperaMin: 15 });
      // Al sacar el rol espera, la espera se limpia sola.
      const vuelto = await puntos.actualizar(adminA, pcHonduras, { rol: 'retorno' });
      expect(vuelto).toMatchObject({ rol: 'retorno', esperaMin: null });
      // Editar otro campo no toca rol/espera.
      expect((await puntos.actualizar(operadorA, pcHonduras, { obligatorio: false })).rol).toBe('retorno');
    });

    it('un PC de espera puede quedar sobre el tramo de una variante activa aunque esté a >100 m de la ruta base', async () => {
      const coord: { type: 'Point'; coordinates: [number, number] } = { type: 'Point', coordinates: [LON_MOLINOS, LAT_SUR] };
      const creado = await puntos.crear(adminA, rutaId, {
        orden: 9, coord, radioToleranciaM: 50, obligatorio: false, estado: 'activo', rol: 'espera', esperaMin: 30,
      });
      expect(creado).toMatchObject({ rol: 'espera', esperaMin: 30 });
      // Lejos de la base Y de cualquier tramo: se rechaza.
      await expect(
        puntos.crear(adminA, rutaOtraId, {
          orden: 9, coord, radioToleranciaM: 50, obligatorio: false, estado: 'activo',
        }),
      ).rejects.toThrow(/más de 100m/);
      await withTenantContext(ADMIN, (tx) => tx.$executeRaw`DELETE FROM puntos_control WHERE id = ${creado.id}`);
    });

    it('cambiar la geometría base no rompe una parada que está sobre el tramo de una variante activa', async () => {
      const rutas = new RutasService();
      const crearParada = (ruta: string) =>
        withTenantContext(ADMIN, async (tx) => {
          const id = randomUUID();
          await tx.$executeRaw`
            INSERT INTO paradas (id, "rutaId", tipo, orden, nombre, coord, "createdAt", "updatedAt")
            VALUES (${id}, ${ruta}, 'destino', 50, 'Molinos', ST_SetSRID(ST_GeomFromGeoJSON(${punto(LON_MOLINOS, LAT_SUR)}), 4326)::geography, now(), now())`;
          return id;
        });
      const conTramo = await crearParada(rutaId);
      const sinTramo = await crearParada(rutaOtraId);
      const geometria = GEOM_BASE as never;
      await expect(rutas.actualizar(adminA, rutaId, { geometria })).resolves.toBeDefined();
      await expect(rutas.actualizar(adminA, rutaOtraId, { geometria })).rejects.toThrow(/deja la parada "Molinos"/);
      await withTenantContext(ADMIN, (tx) => tx.$executeRaw`DELETE FROM paradas WHERE id IN (${conTramo}, ${sinTramo})`);
    });

    it('el tramo y el punto de espera de una variante los edita solo un admin; el PC debe ser de la misma ruta y de rol espera', async () => {
      await expect(variantes.actualizar(operadorA, varianteId, { geometria: GEOM_TRAMO as never })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(variantes.actualizar(adminA, varianteId, { puntoEsperaId: pcSr })).rejects.toThrow(/rol "espera"/);
      const v = await variantes.actualizar(adminA, varianteSinEsperaId, {
        geometria: GEOM_TRAMO as never,
        puntoEsperaId: pcMolinos,
      });
      expect(v.puntoEsperaId).toBe(pcMolinos);
      expect(v.geometria?.coordinates).toHaveLength(2);
      const leida = await variantes.obtener(operadorA, varianteSinEsperaId);
      expect(leida.geometria?.type).toBe('LineString');
      const limpia = await variantes.actualizar(adminA, varianteSinEsperaId, { geometria: null, puntoEsperaId: null });
      expect(limpia.geometria).toBeNull();
      expect(limpia.puntoEsperaId).toBeNull();
    });
  });

  describe('vueltas vacías, sesión cerrada y esperas pendientes (fixes de revisión)', () => {
    it('terminal + fin_recorrido: no queda la vuelta N+1 vacía; el siguiente inicio reutiliza el número', async () => {
      const s = sesiones.vacia;
      await lote([...hastaHonduras(s, 0), cumpl(s, pcSr, iso(45), LON_SR, LAT_RUTA)]);
      expect((await vueltasDe(s)).map((f) => [f.numero, f.estado])).toEqual([[1, 'completa'], [2, 'en_curso']]);
      await lote([fin(s, iso(45, 30))]);
      expect((await vueltasDe(s)).map((f) => [f.numero, f.estado])).toEqual([[1, 'completa']]);
      // Numeración sin huecos: la siguiente vuelta del día es la 2.
      await lote([inicio(s, iso(170))]);
      expect((await vueltasDe(s)).map((f) => [f.numero, f.estado])).toEqual([[1, 'completa'], [2, 'en_curso']]);
    });

    it('el fin de recorrido sobre una vuelta designada NO la elimina y emite molinos_omitido con posición', async () => {
      const s = sesiones.omitidaFin;
      await lote([inicio(s, iso(0)), cumpl(s, pcSr, iso(0, 5), LON_SR, LAT_RUTA)]);
      await vueltas.designar(adminA, s, varianteId);
      await lote([fin(s, iso(30))]);
      expect((await vueltasDe(s)).map((f) => [f.numero, f.estado])).toEqual([[1, 'abierta_al_cierre']]);
      const omitidos = (await infraccionesDe(s)).filter((i) => i.tipo === 'molinos_omitido');
      expect(omitidos).toHaveLength(1);
      expect(Number.isFinite(omitidos[0]!.lat) && Number.isFinite(omitidos[0]!.lng)).toBe(true);
      await lote([fin(s, iso(30))]);
      expect((await infraccionesDe(s)).filter((i) => i.tipo === 'molinos_omitido')).toHaveLength(1);
    });

    it('trigger: al cerrar la sesión NUNCA borra: la vacía queda abierta_al_cierre (y no se cuenta) y la designada se conserva', async () => {
      const vacia = sesiones.cierreVacia;
      await lote([cumpl(vacia, pcSr, iso(0), LON_SR, LAT_RUTA)]);
      expect(await vueltasDe(vacia)).toHaveLength(1);
      await cerrarSesion(vacia);
      expect((await vueltasDe(vacia)).map((f) => [f.numero, f.estado])).toEqual([[1, 'abierta_al_cierre']]);

      const designada = sesiones.cierreDesig;
      await lote([cumpl(designada, pcSr, iso(0), LON_SR, LAT_RUTA)]);
      await vueltas.designar(adminA, designada, varianteId);
      await cerrarSesion(designada);
      expect((await vueltasDe(designada)).map((f) => [f.numero, f.estado, f.varianteId])).toEqual([
        [1, 'abierta_al_cierre', varianteId],
      ]);
    });

    it('residual: la abierta_al_cierre vacía que deja un logout sin lote tardío no entra en molinosHoy ni en el resumen', async () => {
      const s = sesiones.cierreResidual;
      await lote([cumpl(s, pcSr, iso(0), LON_SR, LAT_RUTA)]);
      await cerrarSesion(s);
      const filas = await vueltasDe(s);
      expect(filas.map((f) => f.estado)).toEqual(['abierta_al_cierre']);
      // La fila vacía no pasa el filtro `vueltaNoVacia` (el que usan los conteos y resúmenes).
      const [r] = await withTenantContext(ADMIN, (tx) =>
        tx.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM vueltas v WHERE v."sesionId" = ${s} AND ${vueltaNoVacia('v')}`,
      );
      expect(r!.n).toBe(0);
    });

    it('cierre tardío: la vuelta N+1 con retorno y terminal tardíos que el trigger cerró termina completa y no abre N+2', async () => {
      const s = sesiones.tardioN1;
      // Vuelta 1 completa, la 2 abierta por el terminal.
      await lote([...hastaHonduras(s, 0), cumpl(s, pcSr, iso(45), LON_SR, LAT_RUTA)]);
      expect((await vueltasDe(s)).map((f) => [f.numero, f.estado])).toEqual([[1, 'completa'], [2, 'en_curso']]);
      // Logout (trigger): la 2 queda abierta_al_cierre, VACÍA, y todavía no se borra.
      await cerrarSesion(s);
      expect((await vueltasDe(s)).map((f) => [f.numero, f.estado])).toEqual([[1, 'completa'], [2, 'abierta_al_cierre']]);
      // Llega el lote sincronizado antes del logout: retorno y terminal de la vuelta 2.
      await lote([cumpl(s, pcHonduras, iso(60), LON_HONDURAS, LAT_RUTA), cumpl(s, pcSr, iso(80), LON_SR, LAT_RUTA)]);
      const filas = await vueltasDe(s);
      expect(filas.map((f) => [f.numero, f.estado])).toEqual([[1, 'completa'], [2, 'completa']]);
      expect(filas[1]!.finTs?.toISOString()).toBe(iso(80));
    });

    it('cierre tardío: un lote tardío que no llena la vuelta vacía NO la elimina (queda abierta_al_cierre, fuera de los conteos)', async () => {
      const s = sesiones.tardioVacia;
      await lote([...hastaHonduras(s, 0), cumpl(s, pcSr, iso(45), LON_SR, LAT_RUTA)]);
      await cerrarSesion(s);
      expect((await vueltasDe(s)).map((f) => f.estado)).toEqual(['completa', 'abierta_al_cierre']);
      // Un evento tardío que no aporta nada a la vuelta 2 (otro terminal, sin retorno).
      await lote([cumpl(s, pcSr, iso(46), LON_SR, LAT_RUTA)]);
      expect((await vueltasDe(s)).map((f) => [f.numero, f.estado])).toEqual([[1, 'completa'], [2, 'abierta_al_cierre']]);
      const [r] = await withTenantContext(ADMIN, (tx) =>
        tx.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM vueltas v WHERE v."sesionId" = ${s} AND ${vueltaContable('v')}`,
      );
      expect(r!.n).toBe(1); // solo la vuelta 1
    });

    it('trigger: cerrar la sesión SIN contexto de tenant igual cierra su vuelta en curso (la RLS no la oculta)', async () => {
      const s = sesiones.cierreSinTenant;
      await lote([...hastaHonduras(s, 0)]);
      expect((await vueltasDe(s)).map((f) => f.estado)).toEqual(['en_curso']);
      // Conexión del dueño (superusuario): se desactiva la RLS de `sesiones_operativas` SOLO dentro
      // de esta transacción (DDL transaccional, se revierte) para que el UPDATE de la sesión pase
      // como `quivo_app` SIN `app.rol`/`app.sindicato_id`. Con la RLS de `vueltas` intacta, un
      // trigger que no fije el tenant no vería la fila y la dejaría `en_curso` en silencio.
      const cliente = new Client({ connectionString: process.env.DATABASE_URL });
      await cliente.connect();
      try {
        await cliente.query('BEGIN');
        await cliente.query('ALTER TABLE sesiones_operativas DISABLE ROW LEVEL SECURITY');
        await cliente.query('SET LOCAL ROLE quivo_app');
        const actual = await cliente.query(`SELECT current_setting('app.sindicato_id', true) AS previo`);
        const cierre = await cliente.query(
          `UPDATE sesiones_operativas SET estado = 'cerrada', fin = now() WHERE id = $1`,
          [s],
        );
        expect(cierre.rowCount).toBe(1);
        const despues = await cliente.query(
          `SELECT estado, current_setting('app.sindicato_id', true) AS tenant FROM vueltas WHERE "sesionId" = $1`,
          [s],
        );
        // Sin RLS visible no se puede leer `vueltas` como quivo_app: se vuelve al dueño para leer.
        await cliente.query('RESET ROLE');
        const filas = await cliente.query(`SELECT estado FROM vueltas WHERE "sesionId" = $1`, [s]);
        expect(filas.rows.map((r: { estado: string }) => r.estado)).toEqual(['abierta_al_cierre']);
        // El trigger restauró el valor previo del GUC (nada fijado antes → nada fijado después).
        expect(despues.rows.every((r: { tenant: string | null }) => !r.tenant)).toBe(true);
        expect(actual.rows[0]!.previo ?? '').toBe('');
      } finally {
        await cliente.query('ROLLBACK').catch(() => undefined);
        await cliente.end();
      }
      // Revertido: la sesión sigue activa y la vuelta en curso.
      expect((await vueltasDe(s)).map((f) => f.estado)).toEqual(['en_curso']);
    });

    it('el worker no abre ni muta vueltas de una sesión ya cerrada con eventos posteriores al cierre', async () => {
      const s = sesiones.inactiva;
      await lote([...hastaHonduras(s, 0)]);
      await cerrarSesion(s);
      const antes = await vueltasDe(s);
      expect(antes.map((f) => f.estado)).toEqual(['abierta_al_cierre']);
      // Una terminal POSTERIOR al cierre cerraría la vuelta y abriría otra si la sesión siguiera activa.
      const posterior = new Date(Date.now() + 5 * 60_000).toISOString();
      await lote([cumpl(s, pcSr, posterior, LON_SR, LAT_RUTA), inicio(s, posterior)]);
      const despues = await vueltasDe(s);
      expect(despues.map((f) => [f.numero, f.estado])).toEqual([[1, 'abierta_al_cierre']]);
      expect(despues[0]!.updatedAt.getTime()).toBe(antes[0]!.updatedAt.getTime());
    });

    it('la salida de una espera pendiente se evalúa aunque la vuelta ya cerró y los fixes lleguen en un lote posterior', async () => {
      const s = sesiones.esperaTardia;
      await lote([inicio(s, iso(0)), cumpl(s, pcSr, iso(0, 5), LON_SR, LAT_RUTA)]);
      await vueltas.designar(adminA, s, varianteId);
      await lote([
        cumpl(s, pcHonduras, iso(20), LON_HONDURAS, LAT_RUTA),
        cumpl(s, pcMolinos, iso(30), LON_MOLINOS, LAT_SUR),
        gps(s, iso(31), LON_MOLINOS, LAT_SUR),
      ]);
      await lote([cumpl(s, pcSr, iso(60), LON_SR, LAT_RUTA)]);
      let filas = await vueltasDe(s);
      expect(filas.map((f) => [f.numero, f.estado])).toEqual([[1, 'completa'], [2, 'en_curso']]);
      expect(filas[0]!.esperaSalidaTs).toBeNull();
      // Los fixes de la salida (20 min de espera) llegan después del cierre de la vuelta 1.
      await lote([gps(s, iso(50), LON_SR, LAT_RUTA), gps(s, iso(50, 20), LON_SR, LAT_RUTA)]);
      filas = await vueltasDe(s);
      expect(filas[0]!.esperaSalidaTs?.toISOString()).toBe(iso(50));
      expect((await infraccionesDe(s)).filter((i) => i.tipo === 'espera_corta')).toHaveLength(1);
    });

    it('cierre tardío: un terminal sincronizado antes del logout pero procesado después cierra la vuelta completa y no abre otra', async () => {
      const s = sesiones.cierreTardio;
      await lote([...hastaHonduras(s, 0)]);
      expect((await vueltasDe(s)).map((f) => f.estado)).toEqual(['en_curso']);
      // La sesión cierra AHORA (trigger: abierta_al_cierre con finTs = fin de la sesión).
      await cerrarSesion(s);
      expect((await vueltasDe(s)).map((f) => f.estado)).toEqual(['abierta_al_cierre']);
      // Llega tarde el terminal fechado antes del cierre (iso 45 << ahora) y otro posterior al cierre.
      const despuesDelCierre = new Date(Date.now() + 5 * 60_000).toISOString();
      await lote([cumpl(s, pcSr, iso(45), LON_SR, LAT_RUTA), cumpl(s, pcSr, despuesDelCierre, LON_SR, LAT_RUTA), inicio(s, iso(60))]);
      const filas = await vueltasDe(s);
      expect(filas.map((f) => [f.numero, f.estado])).toEqual([[1, 'completa']]);
      expect(filas[0]!.finTs?.toISOString()).toBe(iso(45));
    });

    it('sin vuelta previa y con el recorrido terminado, el terminal del bus estacionado no reabre una vuelta', async () => {
      const s = sesiones.estacionado;
      await lote([inicio(s, iso(0)), cumpl(s, pcSr, iso(0, 5), LON_SR, LAT_RUTA)]);
      await lote([fin(s, iso(2))]);
      expect(await vueltasDe(s)).toHaveLength(0); // la vuelta vacía se eliminó
      await lote([cumpl(s, pcSr, iso(30), LON_SR, LAT_RUTA)]);
      expect(await vueltasDe(s)).toHaveLength(0);
      // Un inicio_recorrido nuevo sí abre.
      await lote([inicio(s, iso(40))]);
      expect((await vueltasDe(s)).map((f) => [f.numero, f.estado])).toEqual([[1, 'en_curso']]);
    });

    it('el PC de espera en una vuelta NO designada cuenta como progreso: el fin la deja abierta_al_cierre, no la elimina', async () => {
      const s = sesiones.espNoDesig;
      await lote([inicio(s, iso(0)), cumpl(s, pcSr, iso(0, 5), LON_SR, LAT_RUTA)]);
      await lote([cumpl(s, pcMolinos, iso(30), LON_MOLINOS, LAT_SUR)]);
      const [v] = await vueltasDe(s);
      expect(v!.esperaLlegadaTs).toBeNull();
      expect(v!.ultimoPcTs?.toISOString()).toBe(iso(30));
      await lote([fin(s, iso(40))]);
      expect((await vueltasDe(s)).map((f) => [f.numero, f.estado])).toEqual([[1, 'abierta_al_cierre']]);
    });

    it('el cursor de la espera avanza con los fixes evaluados y el siguiente lote reanuda desde él (sin depender del lote)', async () => {
      const s = sesiones.cursor;
      await lote([inicio(s, iso(0)), cumpl(s, pcSr, iso(0, 5), LON_SR, LAT_RUTA)]);
      await vueltas.designar(adminA, s, varianteId);
      await lote([
        cumpl(s, pcHonduras, iso(20), LON_HONDURAS, LAT_RUTA),
        cumpl(s, pcMolinos, iso(30), LON_MOLINOS, LAT_SUR),
        gps(s, iso(31), LON_MOLINOS, LAT_SUR),
        gps(s, iso(32), LON_MOLINOS, LAT_SUR),
      ]);
      let [v] = await vueltasDe(s);
      expect(v!.esperaSalidaTs).toBeNull();
      expect(v!.esperaRevisadaHastaTs?.toISOString()).toBe(iso(32));
      // Un solo fix fuera de radio llega en un lote; el segundo (la racha) en otro: el primero de la
      // racha cae en la ventana del cursor (-2 min), no en el contenido del lote.
      await lote([gps(s, iso(50), LON_SR, LAT_RUTA)]);
      await lote([gps(s, iso(50, 20), LON_SR, LAT_RUTA)]);
      [v] = await vueltasDe(s);
      expect(v!.esperaSalidaTs?.toISOString()).toBe(iso(50));
      expect((await infraccionesDe(s)).filter((i) => i.tipo === 'espera_corta')).toHaveLength(1);
    });

    it('designar: espera el advisory de la sesión que tiene el worker (cierra N, abre N+1) y designa la N+1', async () => {
      const s = sesiones.carreraDesig;
      await lote([cumpl(s, pcSr, iso(0), LON_SR, LAT_RUTA)]);
      const [n1] = await vueltasDe(s);
      // Otra transacción (el worker) tiene el advisory de la sesión, cierra la 1 y abre la 2 al terminar.
      const cliente = new Client({ connectionString: process.env.DATABASE_URL });
      await cliente.connect();
      try {
        await cliente.query('BEGIN');
        await cliente.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`vueltas:${s}`]);
        await cliente.query(`UPDATE vueltas SET estado = 'completa', "finTs" = now() WHERE id = $1`, [n1!.id]);
        let resuelta = false;
        const designando = vueltas.designar(adminA, s, varianteId).finally(() => {
          resuelta = true;
        });
        await new Promise((r) => setTimeout(r, 400));
        expect(resuelta).toBe(false); // bloqueada en el advisory, sin 409 ni designación a la vuelta 1
        await cliente.query(
          `INSERT INTO vueltas (id, "sindicatoId", "sesionId", "vehiculoId", "conductorId", "lineaId", "rutaId",
             fecha, numero, "inicioTs", estado, "updatedAt")
           SELECT $1, "sindicatoId", "sesionId", "vehiculoId", "conductorId", "lineaId", "rutaId",
             fecha, 2, now(), 'en_curso', now() FROM vueltas WHERE id = $2`,
          [randomUUID(), n1!.id],
        );
        await cliente.query('COMMIT');
        const resumen = await designando;
        expect(resumen.numero).toBe(2);
        expect(resumen.varianteId).toBe(varianteId);
      } finally {
        await cliente.query('ROLLBACK').catch(() => undefined);
        await cliente.end();
      }
      expect((await vueltasDe(s)).map((f) => [f.numero, f.estado, f.varianteId])).toEqual([
        [1, 'completa', null],
        [2, 'en_curso', varianteId],
      ]);
    });

    it('espera: fixes de un lote MÁS VIEJO confirmado después de uno más nuevo igual detectan la salida (ventana con el mínimo GPS)', async () => {
      const s = sesiones.gpsDesorden;
      await lote([inicio(s, iso(0)), cumpl(s, pcSr, iso(0, 5), LON_SR, LAT_RUTA)]);
      await vueltas.designar(adminA, s, varianteId);
      await lote([
        cumpl(s, pcHonduras, iso(20), LON_HONDURAS, LAT_RUTA),
        cumpl(s, pcMolinos, iso(30), LON_MOLINOS, LAT_SUR),
      ]);
      // Primero el lote NUEVO (un fix de vuelta dentro del radio, 20 min después)...
      await lote([gps(s, iso(50), LON_MOLINOS, LAT_SUR)]);
      let [v] = await vueltasDe(s);
      expect(v!.esperaSalidaTs).toBeNull();
      expect(v!.esperaRevisadaHastaTs?.toISOString()).toBe(iso(50));
      // ...y después el VIEJO (los dos fixes de la salida, a los 5 min): el cursor ya pasó de ellos.
      await lote([gps(s, iso(35), LON_SR, LAT_RUTA), gps(s, iso(35, 20), LON_SR, LAT_RUTA)]);
      [v] = await vueltasDe(s);
      expect(v!.esperaSalidaTs?.toISOString()).toBe(iso(35));
      expect((await infraccionesDe(s)).filter((i) => i.tipo === 'espera_corta')).toHaveLength(1);
    });

    it('designar: el punto de espera inactivo → 422; si ya pasó por el punto de espera en la vuelta → 409', async () => {
      const s = sesiones.retro;
      await lote([...hastaHonduras(s, 0), cumpl(s, pcMolinos, iso(30), LON_MOLINOS, LAT_SUR)]);
      const marcar = (estado: string) =>
        withTenantContext(ADMIN, (tx) => tx.$executeRaw`UPDATE puntos_control SET estado = ${estado} WHERE id = ${pcMolinos}`);
      await marcar('inactivo');
      try {
        await expect(vueltas.designar(adminA, s, varianteId)).rejects.toBeInstanceOf(UnprocessableEntityException);
        await expect(vueltas.designar(adminA, s, varianteId)).rejects.toThrow(/inactivo/);
        await expect(new VariantesService().actualizar(adminA, varianteSinEsperaId, { puntoEsperaId: pcMolinos })).rejects.toThrow(
          /inactivo/,
        );
      } finally {
        await marcar('activo');
      }
      // Pasó por Molinos (iso 30) después del inicio de la vuelta (iso 0): designar ya no corresponde.
      await expect(vueltas.designar(adminA, s, varianteId)).rejects.toBeInstanceOf(ConflictException);
      await expect(vueltas.designar(adminA, s, varianteId)).rejects.toThrow(/ya pasó por el punto de espera/);
      expect((await vueltasDe(s))[0]!.varianteId).toBeNull();
      // Cancelar (sin variante) sigue permitido.
      await expect(vueltas.designar(adminA, s, null)).resolves.toBeDefined();
    });
  });

  describe('designación en cualquier momento: tope por día y diferida', () => {
    it('ya llegó a Molinos en la vuelta 1: designar en la vuelta 2 → 409 "Ya fue a Molinos hoy."; molinosHoy y sinMolinosHoy cuentan llegadas', async () => {
      const s = sesiones.yaFue;
      await lote([inicio(s, iso(0)), cumpl(s, pcSr, iso(0, 5), LON_SR, LAT_RUTA)]);
      const antes = (await vueltas.resumenMolinos(adminA, diaDeLasVueltas)).lineas.find((l) => l.lineaId === lineaId)!;
      await vueltas.designar(adminA, s, varianteId);
      // Designada pero sin llegar: sigue sin contar como "ya fue".
      expect((await vueltas.resumenMolinos(adminA, diaDeLasVueltas)).lineas.find((l) => l.lineaId === lineaId)!.sinMolinosHoy).toBe(
        antes.sinMolinosHoy,
      );
      expect((await enVivo.obtenerPosiciones(adminA, diaDeLasVueltas)).find((p) => p.id === s)!.molinosHoy).toBe(false);
      await lote([
        cumpl(s, pcHonduras, iso(20), LON_HONDURAS, LAT_RUTA),
        cumpl(s, pcMolinos, iso(30), LON_MOLINOS, LAT_SUR),
        cumpl(s, pcSr, iso(45), LON_SR, LAT_RUTA),
      ]);
      expect((await vueltasDe(s)).map((f) => [f.numero, f.estado])).toEqual([[1, 'completa'], [2, 'en_curso']]);
      const despues = (await vueltas.resumenMolinos(adminA, diaDeLasVueltas)).lineas.find((l) => l.lineaId === lineaId)!;
      expect(despues.sinMolinosHoy).toBe(antes.sinMolinosHoy - 1);
      expect((await enVivo.obtenerPosiciones(adminA, diaDeLasVueltas)).find((p) => p.id === s)!.molinosHoy).toBe(true);
      await expect(vueltas.designar(adminA, s, varianteId)).rejects.toBeInstanceOf(ConflictException);
      await expect(vueltas.designar(adminA, s, varianteId)).rejects.toThrow('Ya fue a Molinos hoy.');
      expect((await vueltasDe(s))[1]!.varianteId).toBeNull();
      // Cancelar sigue permitido.
      await expect(vueltas.designar(adminA, s, null)).resolves.toMatchObject({ aplica: 'vuelta_actual' });
    });

    it('designada y omitida en la vuelta 1 (no llegó): en la vuelta 2 se puede designar', async () => {
      const s = sesiones.omitidaLuego;
      await lote([inicio(s, iso(0)), cumpl(s, pcSr, iso(0, 5), LON_SR, LAT_RUTA)]);
      await vueltas.designar(adminA, s, varianteId);
      await lote([cumpl(s, pcHonduras, iso(20), LON_HONDURAS, LAT_RUTA), cumpl(s, pcSr, iso(45), LON_SR, LAT_RUTA)]);
      expect((await infraccionesDe(s)).filter((i) => i.tipo === 'molinos_omitido')).toHaveLength(1);
      expect((await vueltasDe(s)).map((f) => [f.numero, f.estado])).toEqual([[1, 'completa'], [2, 'en_curso']]);
      const r = await vueltas.designar(adminA, s, varianteId);
      expect(r).toMatchObject({ numero: 2, varianteId, aplica: 'vuelta_actual' });
    });

    it('tras cumplir la bifurcación en el regreso: aplica a la próxima vuelta; la actual cierra sin molinos_omitido y la nueva abre designada sin acuse', async () => {
      const s = sesiones.tardia;
      // La bifurcación pasada en la IDA (antes del retorno) no vuelve tardía la designación.
      await lote([
        inicio(s, iso(0)),
        cumpl(s, pcSr, iso(0, 5), LON_SR, LAT_RUTA),
        cumpl(s, pcBifurcacion, iso(5), LON_MOLINOS, LAT_RUTA),
        cumpl(s, pcHonduras, iso(20), LON_HONDURAS, LAT_RUTA),
      ]);
      const enTiempo = await vueltas.designar(operadorA, s, varianteId);
      expect(enTiempo).toMatchObject({ numero: 1, varianteId, aplica: 'vuelta_actual' });
      await vueltas.designar(operadorA, s, null);
      // En el regreso, después de la bifurcación: diferida.
      await lote([cumpl(s, pcBifurcacion, iso(25), LON_MOLINOS, LAT_RUTA)]);
      const r = await vueltas.designar(operadorA, s, varianteId);
      expect(r).toMatchObject({ numero: 1, varianteId: null, aplica: 'proxima_vuelta' });
      const [v1] = await vueltasDe(s);
      expect(v1).toMatchObject({ varianteId: null, molinosProximaVarianteId: varianteId, molinosProximaPor: 'operador-a' });
      expect(v1!.molinosProximaEn).not.toBeNull();
      const pos = (await enVivo.obtenerPosiciones(adminA, diaDeLasVueltas)).find((p) => p.id === s)!;
      expect(pos.vuelta).toMatchObject({ varianteId: null, molinosProxima: true });

      await lote([cumpl(s, pcSr, iso(45), LON_SR, LAT_RUTA)]);
      const filas = await vueltasDe(s);
      expect(filas.map((f) => [f.numero, f.estado, f.varianteId])).toEqual([[1, 'completa', null], [2, 'en_curso', varianteId]]);
      expect(filas[1]).toMatchObject({ designadaPor: 'operador-a', acuseEn: null });
      expect(filas[1]!.designadaEn?.toISOString()).toBe(v1!.molinosProximaEn!.toISOString());
      // Consumida: la vuelta origen ya no la conserva (no resucita si N+1 se cancela y se reabre).
      expect(filas[0]).toMatchObject({ molinosProximaVarianteId: null, molinosProximaPor: null, molinosProximaEn: null });
      expect((await infraccionesDe(s)).filter((i) => i.tipo === 'molinos_omitido')).toHaveLength(0);
      // La app del chofer la ve como cualquier designación.
      expect((await vueltas.obtenerActualMovil(sesionMovil(s))).designacion).toMatchObject({ varianteId, acuseEn: null });
    });

    it('cancelar (null) limpia la designación diferida y la vuelta siguiente abre sin designar', async () => {
      const s = sesiones.cancelaDiferida;
      await lote([...hastaHonduras(s, 0), cumpl(s, pcBifurcacion, iso(25), LON_MOLINOS, LAT_RUTA)]);
      expect((await vueltas.designar(adminA, s, varianteId)).aplica).toBe('proxima_vuelta');
      const cancelada = await vueltas.designar(adminA, s, null);
      expect(cancelada.aplica).toBe('vuelta_actual');
      expect((await vueltasDe(s))[0]).toMatchObject({ molinosProximaVarianteId: null, molinosProximaPor: null, molinosProximaEn: null });
      await lote([cumpl(s, pcSr, iso(45), LON_SR, LAT_RUTA)]);
      expect((await vueltasDe(s)).map((f) => [f.numero, f.varianteId])).toEqual([[1, null], [2, null]]);
    });
  });

  describe('diferida: casos límite', () => {
    it('pasó por el PC de espera sin designar y luego la bifurcación en el regreso: designar → proxima_vuelta (no 409)', async () => {
      const s = sesiones.esperaLuego;
      await lote([
        ...hastaHonduras(s, 0),
        cumpl(s, pcMolinos, iso(22), LON_MOLINOS, LAT_SUR),
        cumpl(s, pcBifurcacion, iso(25), LON_MOLINOS, LAT_RUTA),
      ]);
      await expect(vueltas.designar(adminA, s, varianteId)).resolves.toMatchObject({ aplica: 'proxima_vuelta' });
    });

    it('vuelta actual ya designada y pasada la bifurcación: otra variante NO se difiere (se aplica a la actual)', async () => {
      const s = sesiones.desigYTardia;
      await lote([...hastaHonduras(s, 0)]);
      await vueltas.designar(adminA, s, varianteId);
      await lote([cumpl(s, pcBifurcacion, iso(25), LON_MOLINOS, LAT_RUTA)]);
      const r = await vueltas.designar(adminA, s, varianteDosId);
      expect(r).toMatchObject({ varianteId: varianteDosId, aplica: 'vuelta_actual' });
      expect((await vueltasDe(s))[0]).toMatchObject({ molinosProximaVarianteId: null });
    });
  });

  describe('cierre de la sesión de login', () => {
    it('al cerrarse la sesión la vuelta en curso queda abierta_al_cierre (trigger; cubre logout y revocaciones)', async () => {
      const s = sesiones.desorden;
      // La vuelta 2 (abierta por la terminal) todavía está vacía: con un PC encima ya no lo es.
      await lote([cumpl(s, pcHonduras, iso(100), LON_HONDURAS, LAT_RUTA)]);
      expect((await vueltasDe(s)).at(-1)!.estado).toBe('en_curso');
      const fin = new Date();
      await withTenantContext(ADMIN, (tx) =>
        tx.sesionOperativa.update({ where: { id: s }, data: { estado: 'cerrada', fin, revokedAt: fin } }),
      );
      const ultima = (await vueltasDe(s)).at(-1)!;
      expect(ultima.estado).toBe('abierta_al_cierre');
      expect(ultima.finTs?.toISOString()).toBe(fin.toISOString());
      // Las ya completas no se tocan.
      expect((await vueltasDe(s))[0]!.estado).toBe('completa');
    });
  });
});

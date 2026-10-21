import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from './client.js';
import type { Prisma } from '@prisma/client';
import { withTenantContext } from './tenant-context.js';

type TenantTx = Prisma.TransactionClient;

// Extiende `rls.integration.test.ts` a las tablas de la fila de salida (migración
// `20261020120000_fila_salida`). Archivo aparte por el tope de líneas; mismo rol `quivo_app`.
// 10:00 en Bolivia (UTC-4) del 20/10/2026: `fecha` de la regla debe ser ese día.
const CREADA_EN = new Date('2026-10-20T14:00:00Z');
const GEOMETRIA = '{"type":"LineString","coordinates":[[-66.15,-17.38],[-66.14,-17.39]]}';

interface Ids {
  grupoId: string;
  vehiculoId: string;
  puntoId: string;
  reglaId: string;
  filaId: string;
  sesionId: string;
  /** Vehículo sin grupo ni fila: para probar referencias cross-tenant sin chocar con los únicos. */
  libreId: string;
}

const vehiculoData = (sindicatoId: string, placa: string) => ({
  sindicatoId,
  placa,
  tipo: 'bus',
  marca: 'x',
  modelo: 'x',
  color: 'x',
  capacidad: 10,
  estado: 'activo',
});

async function crearTenant(tx: TenantTx, sindicatoId: string, sufijo: string): Promise<Ids> {
  await tx.sindicato.create({
    data: { id: sindicatoId, nombre: `Fila ${sufijo}`, estado: 'activo' },
  });
  const linea = await tx.linea.create({
    data: { sindicatoId, codigo: `FS${sufijo}`, nombre: `Línea ${sufijo}` },
  });
  const rutaId = randomUUID();
  await tx.$executeRaw`
    INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
    VALUES (${rutaId}, ${linea.id}, 'ida', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA}), 4326)::geography, 'activo', now(), now())
  `;
  const puntoId = randomUUID();
  await tx.$executeRaw`
    INSERT INTO puntos_control (id, "rutaId", orden, coord, "radioToleranciaM", obligatorio, rol, "frecuenciaSalidaMin", estado, "createdAt", "updatedAt")
    VALUES (${puntoId}, ${rutaId}, 0, ST_SetSRID(ST_MakePoint(-66.15, -17.38), 4326)::geography, 150, true, 'terminal', 6, 'activo', now(), now())
  `;
  const vehiculo = await tx.vehiculo.create({ data: vehiculoData(sindicatoId, `FS${sufijo}01`) });
  const libre = await tx.vehiculo.create({ data: vehiculoData(sindicatoId, `FS${sufijo}02`) });
  const conductor = await tx.conductor.create({
    data: {
      sindicatoId,
      nombre: `Conductor ${sufijo}`,
      documentoIdentidad: `FS-${sufijo}`,
      licenciaConducir: `FSL-${sufijo}`,
      estado: 'activo',
    },
  });
  const rotacion = await tx.rotacion.create({
    data: { sindicatoId, periodo: `FS-${sufijo}`, estado: 'borrador' },
  });
  const asignacion = await tx.asignacion.create({
    data: {
      rotacionId: rotacion.id,
      vehiculoId: vehiculo.id,
      conductorId: conductor.id,
      rutaId,
      fecha: new Date('2026-10-20'),
      horario: 'manana',
      orden: 1,
      venceAt: new Date('2026-10-21'),
    },
  });
  const sesion = await tx.sesionOperativa.create({
    data: {
      sindicatoId,
      asignacionId: asignacion.id,
      vehiculoId: vehiculo.id,
      conductorId: conductor.id,
      deviceId: `dev-${sufijo}`,
      accessTokenHash: randomUUID(),
      refreshTokenHash: randomUUID(),
      accessExpiresAt: new Date('2026-10-21'),
      refreshExpiresAt: new Date('2026-10-22'),
    },
  });
  const grupo = await tx.grupoVehiculo.create({ data: { sindicatoId, nombre: `Grupo ${sufijo}` } });
  await tx.grupoVehiculoMiembro.create({
    data: { grupoId: grupo.id, vehiculoId: vehiculo.id, sindicatoId },
  });
  const regla = await tx.frecuenciaRegla.create({
    data: {
      sindicatoId,
      puntoControlId: puntoId,
      fecha: new Date('2026-10-20'),
      creadaEn: CREADA_EN,
      alcance: 'grupo',
      grupoId: grupo.id,
      minutos: 10,
      creadaPor: 'rls-test',
    },
  });
  const ahora = new Date();
  const fila = await tx.filaSalida.create({
    data: {
      sindicatoId,
      puntoControlId: puntoId,
      fecha: new Date('2026-10-20'),
      sesionId: sesion.id,
      vehiculoId: vehiculo.id,
      llegadaTs: ahora,
      ordenTs: ahora,
    },
  });
  return {
    grupoId: grupo.id,
    vehiculoId: vehiculo.id,
    puntoId,
    reglaId: regla.id,
    filaId: fila.id,
    sesionId: sesion.id,
    libreId: libre.id,
  };
}

describe('RLS fila de salida', () => {
  const sindicatoAId = randomUUID();
  const sindicatoBId = randomUUID();
  let a: Ids;
  let b: Ids;
  const comoA = <T>(fn: (tx: TenantTx) => Promise<T>) =>
    withTenantContext({ rol: 'admin_sindicato', sindicatoId: sindicatoAId }, fn);

  beforeAll(async () => {
    const [{ rolsuper = true, rolbypassrls = true } = {}] = await prisma.$queryRaw<
      { rolsuper: boolean; rolbypassrls: boolean }[]
    >`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    if (rolsuper || rolbypassrls) {
      throw new Error(
        'Conectá con el rol "quivo_app" (sin BYPASSRLS): con otro rol esta suite no prueba RLS.',
      );
    }
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      a = await crearTenant(tx, sindicatoAId, 'A');
      b = await crearTenant(tx, sindicatoBId, 'B');
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      const ids = { in: [sindicatoAId, sindicatoBId] };
      await tx.filaSalida.deleteMany({ where: { sindicatoId: ids } });
      await tx.frecuenciaRegla.deleteMany({ where: { sindicatoId: ids } });
      await tx.grupoVehiculoMiembro.deleteMany({ where: { sindicatoId: ids } });
      await tx.grupoVehiculo.deleteMany({ where: { sindicatoId: ids } });
      await tx.sesionOperativa.deleteMany({ where: { sindicatoId: ids } });
      await tx.rotacion.deleteMany({ where: { sindicatoId: ids } }); // cascada a asignaciones
      await tx.$executeRaw`DELETE FROM puntos_control WHERE id IN (${a.puntoId}, ${b.puntoId})`;
      await tx.linea.deleteMany({ where: { sindicatoId: ids } }); // cascada a rutas
      await tx.conductor.deleteMany({ where: { sindicatoId: ids } });
      await tx.vehiculo.deleteMany({ where: { sindicatoId: ids } });
      await tx.sindicato.deleteMany({ where: { id: ids } });
    });
    await prisma.$disconnect();
  });

  it('A no ve grupos, miembros, reglas ni filas de B', async () => {
    const r = await comoA(async (tx) => ({
      grupos: await tx.grupoVehiculo.findMany({ where: { sindicatoId: sindicatoBId } }),
      miembros: await tx.grupoVehiculoMiembro.findMany({ where: { sindicatoId: sindicatoBId } }),
      reglas: await tx.frecuenciaRegla.findMany({ where: { sindicatoId: sindicatoBId } }),
      filas: await tx.filaSalida.findMany({ where: { sindicatoId: sindicatoBId } }),
    }));
    expect(r.grupos).toHaveLength(0);
    expect(r.miembros).toHaveLength(0);
    expect(r.reglas).toHaveLength(0);
    expect(r.filas).toHaveLength(0);
  });

  it('A sí ve sus propias filas de las cuatro tablas', async () => {
    const r = await comoA(async (tx) => ({
      grupos: await tx.grupoVehiculo.count(),
      miembros: await tx.grupoVehiculoMiembro.count(),
      reglas: await tx.frecuenciaRegla.count(),
      filas: await tx.filaSalida.count(),
    }));
    expect(r).toEqual({ grupos: 1, miembros: 1, reglas: 1, filas: 1 });
  });

  it('A no puede modificar (UPDATE) regla ni fila de B', async () => {
    const r = await comoA(async (tx) => ({
      regla: await tx.frecuenciaRegla.updateMany({
        where: { id: b.reglaId },
        data: { minutos: 1 },
      }),
      fila: await tx.filaSalida.updateMany({ where: { id: b.filaId }, data: { anticipada: true } }),
      grupo: await tx.grupoVehiculo.updateMany({
        where: { id: b.grupoId },
        data: { nombre: 'hack' },
      }),
    }));
    expect(r.regla.count).toBe(0);
    expect(r.fila.count).toBe(0);
    expect(r.grupo.count).toBe(0);
  });

  it('A no puede crear (INSERT) un grupo ni una regla a nombre de B', async () => {
    await expect(
      comoA((tx) =>
        tx.grupoVehiculo.create({ data: { sindicatoId: sindicatoBId, nombre: 'hack' } }),
      ),
    ).rejects.toThrow();
    await expect(
      comoA((tx) =>
        tx.frecuenciaRegla.create({
          data: {
            sindicatoId: sindicatoBId,
            puntoControlId: b.puntoId,
            fecha: new Date('2026-10-20'),
            creadaEn: CREADA_EN,
            alcance: 'todos',
            minutos: 5,
            creadaPor: 'hack',
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it('admin_quivo ve las filas de ambos sindicatos', async () => {
    const filas = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.filaSalida.findMany({ where: { id: { in: [a.filaId, b.filaId] } } }),
    );
    expect(filas).toHaveLength(2);
  });

  it('el único parcial impide dos filas en_fila del mismo trufi', async () => {
    await expect(
      comoA((tx) =>
        tx.filaSalida.create({
          data: {
            sindicatoId: sindicatoAId,
            puntoControlId: a.puntoId,
            fecha: new Date('2026-10-20'),
            sesionId: a.sesionId,
            vehiculoId: a.vehiculoId,
            llegadaTs: new Date(),
            ordenTs: new Date(),
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  describe('referencias cross-tenant (FK compuestas con sindicatoId)', () => {
    const fk = { code: 'P2003' };
    const filaData = (vehiculoId: string, sesionId: string) => ({
      sindicatoId: sindicatoAId,
      puntoControlId: a.puntoId,
      fecha: new Date('2026-10-20'),
      sesionId,
      vehiculoId,
      llegadaTs: new Date(),
      ordenTs: new Date(),
    });
    const reglaData = (extra: { grupoId?: string; vehiculoId?: string }) => ({
      sindicatoId: sindicatoAId,
      puntoControlId: a.puntoId,
      fecha: new Date('2026-10-20'),
      creadaEn: CREADA_EN,
      alcance: extra.grupoId ? 'grupo' : 'vehiculo',
      minutos: 5,
      creadaPor: 'rls-test',
      ...extra,
    });

    it('A no puede meter un vehículo de B en un grupo, ni un vehículo suyo en un grupo de B', async () => {
      await expect(
        comoA((tx) =>
          tx.grupoVehiculoMiembro.create({
            data: { grupoId: a.grupoId, vehiculoId: b.libreId, sindicatoId: sindicatoAId },
          }),
        ),
      ).rejects.toMatchObject(fk);
      await expect(
        comoA((tx) =>
          tx.grupoVehiculoMiembro.create({
            data: { grupoId: b.grupoId, vehiculoId: a.libreId, sindicatoId: sindicatoAId },
          }),
        ),
      ).rejects.toMatchObject(fk);
    });

    it('A no puede crear una fila con vehículo o sesión de B', async () => {
      await expect(
        comoA((tx) => tx.filaSalida.create({ data: filaData(b.libreId, a.sesionId) })),
      ).rejects.toMatchObject(fk);
      await expect(
        comoA((tx) => tx.filaSalida.create({ data: filaData(a.libreId, b.sesionId) })),
      ).rejects.toMatchObject(fk);
    });

    it('A no puede crear una regla que apunte a un grupo o vehículo de B', async () => {
      await expect(
        comoA((tx) => tx.frecuenciaRegla.create({ data: reglaData({ grupoId: b.grupoId }) })),
      ).rejects.toMatchObject(fk);
      await expect(
        comoA((tx) => tx.frecuenciaRegla.create({ data: reglaData({ vehiculoId: b.vehiculoId }) })),
      ).rejects.toMatchObject(fk);
    });
  });

  it('CHECK: `fecha` de la regla debe ser el día Bolivia de `creadaEn`', async () => {
    const data = (fecha: string, creadaEn: string) => ({
      sindicatoId: sindicatoAId,
      puntoControlId: a.puntoId,
      fecha: new Date(fecha),
      creadaEn: new Date(creadaEn),
      alcance: 'todos',
      minutos: 5,
      creadaPor: 'rls-test',
    });
    await expect(
      comoA((tx) => tx.frecuenciaRegla.create({ data: data('2026-10-21', '2026-10-20T14:00:00Z') })),
    ).rejects.toThrow(/frecuencia_reglas_fecha_check|check constraint/i);
    // 02:00Z del 21 = 22:00 del 20 en Bolivia: sigue siendo el día 20.
    await expect(
      comoA((tx) => tx.frecuenciaRegla.create({ data: data('2026-10-20', '2026-10-21T02:00:00Z') })),
    ).resolves.toBeDefined();
  });
});

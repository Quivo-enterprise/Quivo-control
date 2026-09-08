import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from './client.js';
import { withTenantContext } from './tenant-context.js';

/**
 * Prueba de integración de la unicidad de placa (docs/plan-unicidad-placa.md,
 * migración `20260908151800_unicidad_placa_generada`). Corre contra Postgres real, no un
 * mock: la garantía que se prueba acá vive en la BASE (columna GENERATED ALWAYS + índice
 * único parcial + CHECK), no en código de aplicación — un mock no la ejercitaría.
 */
describe('Vehiculo — unicidad de placa (columna generada + índice único parcial)', () => {
  const sindicatoAId = randomUUID();
  const sindicatoBId = randomUUID();
  const vehiculoIds: string[] = [];

  beforeAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({
        data: { id: sindicatoAId, nombre: 'Placa Unicidad Test A', estado: 'activo' },
      });
      await tx.sindicato.create({
        data: { id: sindicatoBId, nombre: 'Placa Unicidad Test B', estado: 'activo' },
      });
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.vehiculo.deleteMany({ where: { id: { in: vehiculoIds } } });
      await tx.sindicato.deleteMany({ where: { id: { in: [sindicatoAId, sindicatoBId] } } });
    });
    await prisma.$disconnect();
  });

  function datosVehiculo(overrides: {
    sindicatoId: string;
    placa: string;
    estado?: string;
  }): Prisma.VehiculoUncheckedCreateInput {
    return {
      sindicatoId: overrides.sindicatoId,
      placa: overrides.placa,
      tipo: 'bus_urbano',
      marca: 'x',
      modelo: 'x',
      color: 'x',
      capacidad: 10,
      estado: overrides.estado ?? 'activo',
    };
  }

  it('rechaza (P2002) la misma placa en dos sindicatos distintos mientras ambos estén vigentes', async () => {
    const a = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.vehiculo.create({ data: datosVehiculo({ sindicatoId: sindicatoAId, placa: 'PLA001' }) }),
    );
    vehiculoIds.push(a.id);
    expect(a.placaNormalizada).toBe('PLA001');

    await expect(
      withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
        tx.vehiculo.create({
          data: datosVehiculo({ sindicatoId: sindicatoBId, placa: 'PLA-001' }),
        }),
      ),
    ).rejects.toMatchObject({ code: 'P2002' } satisfies Partial<Prisma.PrismaClientKnownRequestError>);
  });

  it('permite migración de sindicato: A da de baja (inactivo) su vehículo, B registra la misma placa', async () => {
    const a = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.vehiculo.create({ data: datosVehiculo({ sindicatoId: sindicatoAId, placa: 'PLA002' }) }),
    );
    vehiculoIds.push(a.id);

    // Mientras A esté vigente, B no puede — mismo caso que el test anterior, confirmado acá
    // para dejar explícito el "antes" del escenario de migración.
    await expect(
      withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
        tx.vehiculo.create({ data: datosVehiculo({ sindicatoId: sindicatoBId, placa: 'PLA002' }) }),
      ),
    ).rejects.toMatchObject({ code: 'P2002' } satisfies Partial<Prisma.PrismaClientKnownRequestError>);

    // A se da de baja: el predicado `estado <> 'inactivo'` del índice único parcial deja de
    // cubrir su fila, así que deja de "ocupar" la placa.
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.vehiculo.update({ where: { id: a.id }, data: { estado: 'inactivo' } }),
    );

    const b = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.vehiculo.create({ data: datosVehiculo({ sindicatoId: sindicatoBId, placa: 'PLA002' }) }),
    );
    vehiculoIds.push(b.id);
    expect(b.placaNormalizada).toBe('PLA002');
  });

  it('permite reingreso al MISMO sindicato tras dar de baja (F1: NO hay @@unique([sindicatoId, placaNormalizada]))', async () => {
    // Este test reemplaza uno que afirmaba lo contrario ("rechaza P2002 reingreso al MISMO
    // sindicato por @@unique([sindicatoId, placaNormalizada])") — F1 (docs/plan-unicidad-
    // placa.md) confirmó que ESE índice compuesto era el bug: un unique TOTAL (sin predicado
    // parcial) por sindicato bloqueaba para siempre el ciclo baja/alta de una placa dentro
    // del mismo sindicato, justo el camino de recuperación que el diseño quiere permitir. El
    // índice único parcial global (`vehiculos_placa_norm_vigente_key`, `WHERE estado <>
    // 'inactivo'`) sigue siendo la única fuente de unicidad — y no le importa el sindicato.
    const a = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.vehiculo.create({ data: datosVehiculo({ sindicatoId: sindicatoAId, placa: 'PLA003' }) }),
    );
    vehiculoIds.push(a.id);
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.vehiculo.update({ where: { id: a.id }, data: { estado: 'inactivo' } }),
    );

    // A propósito NO cambia de sindicato acá (a diferencia del test de migración de arriba):
    // el mismo sindicato reingresando la misma placa, con la fila anterior ya `inactivo`, NO
    // debe chocar con nada — es una fila nueva, distinta de `a`.
    const b = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.vehiculo.create({ data: datosVehiculo({ sindicatoId: sindicatoAId, placa: 'PLA003' }) }),
    );
    vehiculoIds.push(b.id);
    expect(b.id).not.toBe(a.id);
    expect(b.placaNormalizada).toBe('PLA003');
    expect(b.estado).toBe('activo');
  });

  it('rechaza (P2039) cualquier intento de escribir "placaNormalizada" a mano — el camino está cerrado, no da P2002', async () => {
    // Corregido por el spike del plan: escribir la columna generada NO dispara la
    // violación del índice único (P2002) — Postgres ni siquiera llega a evaluarlo, rechaza
    // el INSERT en la etapa de "column reference" con SQLSTATE 428C9 ("cannot insert a
    // non-DEFAULT value into column ... is a generated column"), que Prisma mapea a P2039.
    // Esto vale incluso si el valor forzado violaría el CHECK (`^[A-Z0-9]{3,20}$`): el
    // rechazo por columna generada ocurre ANTES de que el CHECK se evalúe, así que nunca se
    // observa un error de CHECK por esta vía — el camino está cerrado de raíz, no filtrado.
    //
    // `placaNormalizada` SIGUE siendo un campo opcional en `VehiculoUncheckedCreateInput`
    // (Prisma no infiere "de sólo lectura" de `@default(dbgenerated(...))` — no hay error de
    // TypeScript acá, a propósito: TypeScript no es la barrera, Postgres sí lo es).
    await expect(
      withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
        tx.vehiculo.create({
          data: {
            ...datosVehiculo({ sindicatoId: sindicatoAId, placa: 'PLA004' }),
            placaNormalizada: '1',
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'P2039' } satisfies Partial<Prisma.PrismaClientKnownRequestError>);
  });

  it('guardia: el índice único parcial "vehiculos_placa_norm_vigente_key" existe en pg_indexes', async () => {
    // Contra el riesgo documentado en el plan: un `prisma migrate dev` futuro podría emitir
    // un DROP INDEX de este índice por no estar representado 1:1 en el datamodel de Prisma
    // (los índices parciales sólo se expresan vía `@unique(..., where: raw(...))` sobre EL
    // CAMPO, no como un `@@index` aparte) — si algún día desaparece, este test lo detecta.
    const filas = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.$queryRaw<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes
        WHERE tablename = 'vehiculos' AND indexname = 'vehiculos_placa_norm_vigente_key'
      `,
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]!.indexdef).toContain('UNIQUE');
    expect(filas[0]!.indexdef).toContain("WHERE (estado <> 'inactivo'::text)");
  });
});

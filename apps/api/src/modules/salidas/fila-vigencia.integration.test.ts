import { randomUUID } from 'node:crypto';
import { prisma, withTenantContext } from '@quivo/db';
import { fechaActualBolivia } from '@quivo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { FilaService } from './fila.service.js';
import { ADMIN, borrarMundo, crearMundo, insertarActividadResumen, type MundoSalidas } from './salidas.fixtures.js';

const DIA = 24 * 3_600_000;

/** La fila solo cuenta sesiones vigentes (`sesionesVisiblesSql`): un zombi de ayer no ocupa lugar. */
describe('fila de salida: vigencia de la sesión', () => {
  let m: MundoSalidas;
  const fila = new FilaService();
  const admin: AuthenticatedUser = { userId: 'test-admin', rol: 'admin_quivo', sindicatoId: null };

  beforeAll(async () => {
    m = await crearMundo(3);
    const ahora = Date.now();
    // 3 días atrás: fuera de la jornada de hoy y de la gracia a cualquier hora del día (el servicio usa el reloj real).
    const ayer = new Date(ahora - 3 * DIA);
    const fixReciente = new Date(ahora - 30 * 60_000);
    await withTenantContext(ADMIN, async (tx) => {
      // a[0]: zombi (arrancó ayer, sin actividad). a[1]: turno de anoche con actividad reciente.
      // a[2]: arrancó hoy (inicio = now por defecto).
      for (const i of [0, 1]) {
        await tx.sesionOperativa.update({ where: { id: m.a[i]!.sesion.sesionId }, data: { inicio: ayer } });
      }
      const jornada = fechaActualBolivia(fixReciente).toISOString().slice(0, 10);
      await insertarActividadResumen(tx, { sesionId: m.a[1]!.sesion.sesionId, sindicatoId: m.sindicatoA, jornada, ultimoFixTs: fixReciente });
      // Orden de llegada: el zombi llegó primero (sería la posición 1 si contara).
      for (const [i, min] of [[0, 90], [1, 60], [2, 30]] as const) {
        const llegada = new Date(ahora - min * 60_000);
        await tx.$executeRaw`
          INSERT INTO fila_salida (id, "sindicatoId", "puntoControlId", fecha, "sesionId", "vehiculoId", "llegadaTs", "ordenTs", estado, anticipada)
          VALUES (${randomUUID()}, ${m.sindicatoA}, ${m.pcTerminalA}, ${fechaActualBolivia(new Date(ahora)).toISOString().slice(0, 10)}::date,
                  ${m.a[i]!.sesion.sesionId}, ${m.a[i]!.vehiculoId}, ${llegada}, ${llegada}, 'en_fila', false)`;
      }
    });
  });
  afterAll(async () => {
    await withTenantContext(ADMIN, (tx) =>
      tx.$executeRaw`DELETE FROM gps_sesion_resumen WHERE "sindicatoId" = ${m.sindicatoA}`,
    );
    await borrarMundo(m);
    await prisma.$disconnect();
  });

  it('el panel no lista al zombi, no ocupa la posición 1 y el turno de anoche vigente sí entra', async () => {
    const panel = await fila.estadoPanel(admin, m.pcTerminalA);
    const placas = panel.items.map((f) => f.placa);
    expect(placas).not.toContain(m.a[0]!.placa);
    expect(placas).toEqual([m.a[1]!.placa, m.a[2]!.placa]);
    expect(panel.items.map((f) => f.posicion)).toEqual([1, 2]);
  });

  it('la app móvil de un vigente ve total y posición sin contar al zombi', async () => {
    const e = await fila.estadoMovil(m.a[2]!.sesion);
    expect(e).toMatchObject({ posicion: 2, total: 2 });
  });
});

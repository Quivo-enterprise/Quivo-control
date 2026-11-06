import { randomUUID } from 'node:crypto';
import { prisma, withTenantContext } from '@quivo/db';
import { fechaActualBolivia } from '@quivo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { FilaService } from './fila.service.js';
import { ADMIN, borrarMundo, crearMundo, type MundoSalidas } from './salidas.fixtures.js';

/** El panel de la fila trae el conductor de la sesión de cada fila, sin depender de posiciones en vivo. */
describe('fila de salida: conductorNombre', () => {
  let m: MundoSalidas;
  const fila = new FilaService();
  const actor = (sindicatoId: string): AuthenticatedUser => ({ userId: 'test-sind', rol: 'admin_sindicato', sindicatoId });

  beforeAll(async () => {
    m = await crearMundo(1);
    const ahora = new Date();
    // Sesión de hoy sin actividad GPS (sin posición en vivo): solo existe la fila.
    await withTenantContext(ADMIN, (tx) => tx.$executeRaw`
      INSERT INTO fila_salida (id, "sindicatoId", "puntoControlId", fecha, "sesionId", "vehiculoId", "llegadaTs", "ordenTs", estado, anticipada)
      VALUES (${randomUUID()}, ${m.sindicatoA}, ${m.pcTerminalA}, ${fechaActualBolivia(ahora).toISOString().slice(0, 10)}::date,
              ${m.a[0]!.sesion.sesionId}, ${m.a[0]!.vehiculoId}, ${ahora}, ${ahora}, 'en_fila', false)`);
  });
  afterAll(async () => {
    await borrarMundo(m);
    await prisma.$disconnect();
  });

  it('trae el nombre del conductor de la sesión aunque no haya posición en vivo', async () => {
    const panel = await fila.estadoPanel(actor(m.sindicatoA), m.pcTerminalA);
    expect(panel.items).toHaveLength(1);
    expect(panel.items[0]).toMatchObject({ vehiculoId: m.a[0]!.vehiculoId, conductorNombre: 'Conductor Fila' });
  });

  it('otro sindicato no ve la terminal ni sus conductores', async () => {
    await expect(fila.estadoPanel(actor(m.sindicatoB), m.pcTerminalA)).rejects.toThrow();
  });
});

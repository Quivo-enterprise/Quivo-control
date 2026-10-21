import { prisma, withTenantContext } from '@quivo/db';
import { fechaActualBolivia } from '@quivo/shared';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MARGEN_RELOJ_BACKSTOP_MS, aplicarBackstopFila } from '../ingesta-worker/fila-backstop.js';
import { ADMIN, borrarMundo, crearMundo, type MundoSalidas } from './salidas.fixtures.js';

/** Backstop: terminales, margen de reloj y `anticipada` al instante del evento. */
describe('fila de salida: backstop (terminales, reloj, anticipada)', () => {
  let m: MundoSalidas;
  const ahora = new Date();
  const hace = (s: number) => new Date(ahora.getTime() - s * 1000);
  const dia = () => fechaActualBolivia(ahora);
  const filaDe = (i: number) =>
    withTenantContext(ADMIN, (tx) => tx.filaSalida.findFirst({ where: { vehiculoId: m.a[i]!.vehiculoId } }));
  const enFila = (i: number, llegadaTs: Date) =>
    withTenantContext(ADMIN, (tx) =>
      tx.filaSalida.create({
        data: {
          sindicatoId: m.sindicatoA, puntoControlId: m.pcTerminalA, fecha: dia(),
          sesionId: m.a[i]!.sesion.sesionId, vehiculoId: m.a[i]!.vehiculoId, llegadaTs, ordenTs: llegadaTs,
        },
      }),
    );
  const salioYa = (i: number, salidaTs: Date) =>
    withTenantContext(ADMIN, (tx) =>
      tx.filaSalida.create({
        data: {
          sindicatoId: m.sindicatoA, puntoControlId: m.pcTerminalA, fecha: dia(), sesionId: m.a[i]!.sesion.sesionId,
          vehiculoId: m.a[i]!.vehiculoId, llegadaTs: hace(3000), ordenTs: hace(3000), estado: 'salio', salidaTs, salidaOrigen: 'panel',
        },
      }),
    );
  const backstop = (i: number, terminalesIds: string[], cumplimientos: { ts: Date; puntoControlId: string }[]) =>
    withTenantContext(ADMIN, (tx) =>
      aplicarBackstopFila(tx, {
        sindicatoId: m.sindicatoA, sesionId: m.a[i]!.sesion.sesionId, terminalesIds: new Set(terminalesIds),
        cumplimientos, fines: [], ahora,
      }),
    );

  beforeAll(async () => {
    m = await crearMundo(5);
  });
  afterAll(async () => {
    await withTenantContext(ADMIN, (tx) => tx.$executeRaw`UPDATE puntos_control SET "frecuenciaSalidaMin" = NULL WHERE id = ${m.pcTerminalA}`);
    await borrarMundo(m);
    await prisma.$disconnect();
  });

  it('el cumplimiento de CUALQUIER terminal de la ruta (incluida otra distinta de la de la fila) no es salida', async () => {
    const otraTerminal = randomUUID();
    await enFila(0, hace(600));
    await backstop(0, [m.pcTerminalA, otraTerminal], [{ ts: hace(100), puntoControlId: otraTerminal }]);
    expect(await filaDe(0)).toMatchObject({ estado: 'en_fila' });
    // Aunque el conjunto de terminales no trajera la de la fila, su propio PC nunca cuenta.
    await backstop(0, [otraTerminal], [{ ts: hace(100), puntoControlId: m.pcTerminalA }]);
    expect(await filaDe(0)).toMatchObject({ estado: 'en_fila' });
    await backstop(0, [m.pcTerminalA, otraTerminal], [{ ts: hace(100), puntoControlId: m.pcRetornoA }]);
    expect(await filaDe(0)).toMatchObject({ estado: 'salio', salidaOrigen: 'deteccion' });
  });

  it('margen de reloj: un evento a menos de 60 s de la llegada no cuenta; a 60 s exactos sí', async () => {
    const llegada = hace(900);
    await enFila(1, llegada);
    const en = (offsetMs: number) => [{ ts: new Date(llegada.getTime() + offsetMs), puntoControlId: m.pcRetornoA }];
    await backstop(1, [m.pcTerminalA], en(MARGEN_RELOJ_BACKSTOP_MS - 1));
    expect(await filaDe(1)).toMatchObject({ estado: 'en_fila' });
    await backstop(1, [m.pcTerminalA], en(MARGEN_RELOJ_BACKSTOP_MS));
    expect(await filaDe(1)).toMatchObject({ estado: 'salio' });
  });

  it('anticipada se evalúa con la última salida AL instante del evento: un despacho posterior no la vuelve anticipada', async () => {
    await withTenantContext(ADMIN, (tx) => tx.$executeRaw`UPDATE puntos_control SET "frecuenciaSalidaMin" = 5 WHERE id = ${m.pcTerminalA}`);
    await salioYa(3, hace(1000)); // última salida real antes del evento; ETA del siguiente = hace(700)
    await salioYa(4, hace(100)); // despacho POSTERIOR al evento
    await enFila(2, hace(1200));
    await backstop(2, [m.pcTerminalA], [{ ts: hace(300), puntoControlId: m.pcRetornoA }]);
    expect(await filaDe(2)).toMatchObject({ estado: 'salio', anticipada: false });
  });
});

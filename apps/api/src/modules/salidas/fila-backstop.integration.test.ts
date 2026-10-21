import { randomUUID } from 'node:crypto';
import { prisma, withTenantContext } from '@quivo/db';
import { fechaActualBolivia, type EventoSync } from '@quivo/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuthMovilService } from '../auth-movil/auth-movil.service.js';
import { hashTokenOpaco } from '../auth-movil/token-opaco.js';
import { aplicarBackstopFila } from '../ingesta-worker/fila-backstop.js';
import { IngestaWorkerService } from '../ingesta-worker/ingesta-worker.service.js';
import { ADMIN, LAT, LON, borrarMundo, crearMundo, type MundoSalidas } from './salidas.fixtures.js';

/**
 * Backstop de la fila en el worker de ingesta (cumplimiento de un PC que no es la terminal ⇒
 * `salio`/`deteccion`; `fin_recorrido` ⇒ `retirado`) y retiro de la fila al cerrar sesión.
 */
describe('fila de salida: backstop del worker y logout', () => {
  let m: MundoSalidas;
  const ahora = Date.now();
  const hace = (segundos: number) => new Date(ahora - segundos * 1000);

  function servicioSinCola(): { procesarLote(job: unknown): Promise<{ procesados: number; errores: number }> } {
    const servicio = Object.create(IngestaWorkerService.prototype) as Record<string, unknown>;
    servicio.logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
    servicio.ingestaQueueStats = { getWaitingCount: async () => 0 };
    return servicio as never;
  }
  const lote = (eventos: EventoSync[]) =>
    servicioSinCola().procesarLote({ id: 'job-fila', attemptsMade: 0, data: { sindicatoId: m.sindicatoA, eventos } });
  const evento = (tipo: EventoSync['tipo'], ts: Date, payload: Record<string, unknown>): EventoSync => ({
    eventId: randomUUID(), deviceId: 'device-fila', ts: ts.toISOString(), tipo, payload,
  });
  const cumple = (i: number, pc: string, ts: Date) =>
    evento('cumplimiento_punto_control', ts, {
      sesionId: m.a[i]!.sesion.sesionId, puntoControlId: pc, lat: LAT, lng: pc === m.pcTerminalA ? LON : -63.175, tsFix: ts.toISOString(),
    });
  const filaDe = (i: number) =>
    withTenantContext(ADMIN, (tx) => tx.filaSalida.findFirst({ where: { vehiculoId: m.a[i]!.vehiculoId }, orderBy: { createdAt: 'desc' } }));
  const enFila = (i: number, llegadaTs: Date) =>
    withTenantContext(ADMIN, (tx) =>
      tx.filaSalida.create({
        data: {
          sindicatoId: m.sindicatoA, puntoControlId: m.pcTerminalA, fecha: fechaActualBolivia(new Date()),
          sesionId: m.a[i]!.sesion.sesionId, vehiculoId: m.a[i]!.vehiculoId, llegadaTs, ordenTs: llegadaTs,
        },
      }),
    );

  beforeAll(async () => {
    m = await crearMundo(5);
  });

  afterAll(async () => {
    await withTenantContext(ADMIN, async (tx) => {
      const ids = { in: [m.sindicatoA, m.sindicatoB] };
      await tx.vuelta.deleteMany({ where: { sindicatoId: ids } });
      await tx.cumplimientoPc.deleteMany({ where: { sindicatoId: ids } });
      await tx.eventoOperativo.deleteMany({ where: { sindicatoId: ids } });
      await tx.infraccion.deleteMany({ where: { sindicatoId: ids } });
    });
    await borrarMundo(m);
    await prisma.$disconnect();
  });

  it('un cumplimiento de un PC que no es la terminal marca la salida por detección (anticipada según el turno)', async () => {
    await enFila(0, hace(600));
    await enFila(1, hace(540));
    // El 2.º de la fila cumple el retorno: salió sin ser el 1.º ⇒ anticipada.
    expect(await lote([cumple(1, m.pcRetornoA, hace(60))])).toEqual({ procesados: 1, errores: 0 });
    expect(await filaDe(1)).toMatchObject({ estado: 'salio', salidaOrigen: 'deteccion', anticipada: true });
    expect((await filaDe(1))!.salidaTs!.getTime()).toBe(hace(60).getTime());
    // Pasar por la terminal no la saca de la fila; el retorno posterior sí (ya es el 1.º y en turno).
    await lote([cumple(0, m.pcTerminalA, hace(50))]);
    expect(await filaDe(0)).toMatchObject({ estado: 'en_fila', salidaTs: null });
    await lote([cumple(0, m.pcRetornoA, hace(30))]);
    expect(await filaDe(0)).toMatchObject({ estado: 'salio', salidaOrigen: 'deteccion', anticipada: false });
  });

  it('fin_recorrido retira al trufi de la fila', async () => {
    await enFila(2, hace(300));
    await lote([evento('fin_recorrido', hace(20), { sesionId: m.a[2]!.sesion.sesionId })]);
    expect(await filaDe(2)).toMatchObject({ estado: 'retirado', salidaTs: null, salidaOrigen: null });
  });

  it('un evento anterior a la llegada a la fila (lote offline viejo) no la toca', async () => {
    await enFila(3, hace(60));
    await lote([cumple(3, m.pcRetornoA, hace(600))]);
    expect(await filaDe(3)).toMatchObject({ estado: 'en_fila' });
  });

  it('una falla del backstop se loguea y no rompe: el SAVEPOINT se revierte y la transacción sigue viva', async () => {
    const sqls: string[] = [];
    const tx = {
      $executeRaw: vi.fn(async (partes: TemplateStringsArray) => void sqls.push(partes.join('?'))),
      $queryRaw: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    await expect(
      aplicarBackstopFila(tx as never, {
        sindicatoId: m.sindicatoA, sesionId: m.a[4]!.sesion.sesionId, terminalId: m.pcTerminalA,
        cumplimientos: [{ ts: hace(5), puntoControlId: m.pcRetornoA }], fines: [], ahora: new Date(),
      }),
    ).resolves.toBeUndefined();
    expect(sqls).toEqual(['SAVEPOINT fila_backstop', 'ROLLBACK TO SAVEPOINT fila_backstop']);
  });

  it('logout móvil: la fila abierta del vehículo pasa a retirado', async () => {
    const refreshToken = `refresh-fila-${randomUUID()}`;
    await withTenantContext(ADMIN, (tx) =>
      tx.sesionOperativa.update({ where: { id: m.a[4]!.sesion.sesionId }, data: { refreshTokenHash: hashTokenOpaco(refreshToken) } }),
    );
    await enFila(4, hace(30));
    await new AuthMovilService().logout({ refreshToken });
    expect(await filaDe(4)).toMatchObject({ estado: 'retirado' });
    const sesion = await withTenantContext(ADMIN, (tx) => tx.sesionOperativa.findUnique({ where: { id: m.a[4]!.sesion.sesionId } }));
    expect(sesion).toMatchObject({ estado: 'cerrada' });
  });
});

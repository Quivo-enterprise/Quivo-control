import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoSync } from '@quivo/shared';

const withTenantContext = vi.fn();
vi.mock('@quivo/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@quivo/db')>()),
  withTenantContext: (...args: unknown[]) => withTenantContext(...args),
}));

import { IngestaWorkerService } from './ingesta-worker.service.js';

const SESION_A = '018e6e6a-0000-7000-8000-00000000000a';
const SESION_B = '018e6e6a-0000-7000-8000-00000000000b';
const gps = (n: number, sesionId = SESION_A): EventoSync => ({
  eventId: `018e6e6a-0000-7000-8000-00000000010${n}`,
  deviceId: 'device-test',
  ts: new Date().toISOString(),
  tipo: 'gps_point',
  payload: { sesionId, lat: -17.78, lng: -63.18 },
});
const cumplimiento: EventoSync = {
  eventId: '018e6e6a-0000-7000-8000-000000000201',
  deviceId: 'device-test',
  ts: new Date().toISOString(),
  tipo: 'cumplimiento_punto_control',
  payload: { sesionId: SESION_A, puntoControlId: 'pc', lat: -17.78, lng: -63.18 },
};

// Forma real con `PrismaPg`: SQLSTATE en meta.driverAdapterError.cause.originalCode.
const prismaRaw = (originalCode: string) => ({
  code: 'P2010',
  meta: { driverAdapterError: { cause: { originalCode, kind: 'postgres', code: originalCode } } },
});

const warn = vi.fn();
const error = vi.fn();
const createMany = vi.fn();

let apagado = new AbortController();
let getWaitingCount = async (): Promise<number> => 0;

const moveToWait = vi.fn(async () => 0);

function procesarLote(eventos: EventoSync[]) {
  const servicio = Object.create(IngestaWorkerService.prototype) as Record<string, unknown>;
  servicio.logger = { log: () => undefined, warn, error, debug: () => undefined };
  servicio.ingestaQueueStats = { getWaitingCount: () => getWaitingCount() };
  servicio.apagado = apagado;
  return (
    servicio as never as { procesarLote(job: unknown, token?: string): Promise<unknown> }
  ).procesarLote({ id: 'job-test', data: { sindicatoId: 's', eventos }, moveToWait }, 'token-test');
}

/** Por defecto: detección/vueltas sin resultado y `sync_errors` real contra un tx falso. */
function porDefecto(ctx: { sindicatoId: string | null }, fn: (tx: unknown) => unknown) {
  if (ctx.sindicatoId === null) return fn({ syncError: { createMany } });
  return { abiertas: 0, cerradas: 0, infracciones: 0 };
}

describe('procesarLote — reintento en proceso ante errores transitorios', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    withTenantContext.mockReset();
    withTenantContext.mockImplementation(async (ctx, fn) => porDefecto(ctx, fn));
    warn.mockReset();
    error.mockReset();
    getWaitingCount = async () => 0;
    createMany.mockReset();
    moveToWait.mockClear();
    apagado = new AbortController();
  });
  afterEach(() => vi.useRealTimers());

  it('transitorio y luego éxito: el handler no resuelve hasta tener éxito (orden), sin sync_errors, con log', async () => {
    withTenantContext.mockRejectedValueOnce({ code: 'P1017' });
    let resuelto = false;
    const p = procesarLote([gps(1)]).then((r) => ((resuelto = true), r));

    await vi.advanceTimersByTimeAsync(4_999);
    expect(resuelto).toBe(false); // sigue esperando el backoff: la cola (concurrencia 1) no avanza
    expect(withTenantContext).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toMatchObject({ errores: 0, procesados: 1 });
    expect(createMany).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('job-test');
    expect(warn.mock.calls[0]![0]).toContain('P1017');
    expect(warn.mock.calls[0]![0]).toContain('5s');
  });

  it('transitorio permanente: relanza al agotar el presupuesto, con espera 5/10/20/40/60 s', async () => {
    withTenantContext.mockRejectedValue({ code: 'P1017' });
    const aserto = expect(procesarLote([gps(1)])).rejects.toMatchObject({ code: 'P1017' });
    await vi.advanceTimersByTimeAsync(31 * 60_000);
    await aserto;
    expect(createMany).not.toHaveBeenCalled();
    const esperas = warn.mock.calls.flatMap((c) => /se reintenta en (\d+)s/.exec(c[0] as string)?.[1] ?? []);
    expect(esperas.slice(0, 6)).toEqual(['5', '10', '20', '40', '60', '60']);
    expect(esperas.length).toBeLessThanOrEqual(33); // acotado por el presupuesto de 30 min
  });

  it('un error permanente NO se reintenta y va una sola vez a sync_errors', async () => {
    withTenantContext.mockRejectedValueOnce(new Error('dato corrupto'));
    await expect(procesarLote([gps(1)])).resolves.toMatchObject({ errores: 1 });
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany.mock.calls[0]![0].data).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('permanente en el intento 1 y transitorio después: sync_errors se escribe una sola vez', async () => {
    withTenantContext
      .mockRejectedValueOnce(new Error('dato corrupto')) // intento 1: gps → permanente
      .mockRejectedValueOnce({ code: 'P1017' }) // intento 1: cumplimiento → transitorio
      .mockRejectedValueOnce(new Error('dato corrupto')) // intento 2: gps → permanente
      .mockResolvedValueOnce({ tsFixDescartado: false, cumplido: false, ts: cumplimiento.ts }); // intento 2
    const p = procesarLote([gps(1), cumplimiento]);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(p).resolves.toMatchObject({ errores: 1, procesados: 1 });
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany.mock.calls[0]![0].data).toHaveLength(1);
  });

  it('transitorio en la detección de la 2ª sesión: el re-run vuelve a cubrir la detección de todas', async () => {
    // Intento 1: gps (1) + desvío A (1) + desvío B transitorio (1) = 3 llamadas.
    withTenantContext
      .mockImplementationOnce(async (ctx, fn) => porDefecto(ctx, fn))
      .mockImplementationOnce(async (ctx, fn) => porDefecto(ctx, fn))
      .mockRejectedValueOnce({ code: 'P1017' });
    const p = procesarLote([gps(1, SESION_A), gps(2, SESION_B)]);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(p).resolves.toMatchObject({ errores: 0 });
    // Intento 2: gps + desvío A + desvío B + vueltas A + vueltas B = 5.
    expect(withTenantContext).toHaveBeenCalledTimes(3 + 5);
  });

  it('presupuesto agotado: loguea en una línea estructurada los rechazos bufereados (sin payload) y relanza', async () => {
    withTenantContext
      .mockRejectedValueOnce(new Error('dato corrupto')) // gps → permanente (bufereado)
      .mockRejectedValue({ code: 'P1017' }); // cumplimiento → transitorio, siempre
    const aserto = expect(procesarLote([gps(1), cumplimiento])).rejects.toMatchObject({ code: 'P1017' });
    await vi.advanceTimersByTimeAsync(31 * 60_000);
    await aserto;
    expect(createMany).not.toHaveBeenCalled();
    const linea = error.mock.calls.map((c) => c[0] as string).find((m) => m.includes('presupuesto'));
    expect(linea).toContain('job-test');
    expect(linea).toContain(gps(1).eventId);
    expect(linea).toContain('gps_point');
    expect(linea).toContain('dato corrupto');
    expect(linea).not.toContain('lat');
  });

  it('contarPendientesCola fallando NO re-corre el lote ni duplica sync_errors', async () => {
    getWaitingCount = async () => {
      throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    };
    withTenantContext.mockRejectedValueOnce(new Error('dato corrupto'));
    await expect(procesarLote([gps(1)])).resolves.toMatchObject({ errores: 1 });
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('abortar durante el sueño relanza de inmediato un WaitingError (BullMQ no lo manda a failed)', async () => {
    withTenantContext.mockRejectedValue({ code: 'P1017' });
    const aserto = expect(procesarLote([gps(1)])).rejects.toMatchObject({ name: 'WaitingError' });
    await vi.advanceTimersByTimeAsync(1_000); // dentro del primer backoff de 5 s
    expect(withTenantContext).toHaveBeenCalledTimes(1);
    apagado.abort();
    await aserto;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(withTenantContext).toHaveBeenCalledTimes(1);
    expect(moveToWait).toHaveBeenCalledWith('token-test'); // vuelve al frente de `wait`, lock liberado
    const { WaitingError } = await import('bullmq');
    await expect(procesarLote([gps(1)])).rejects.toBeInstanceOf(WaitingError); // ya abortado: no duerme
  });

  it('P2028 expirada es transitoria: nunca se absorbe como rechazo, agota el presupuesto y relanza', async () => {
    const expirada = {
      code: 'P2028',
      message: 'Transaction already closed: A query cannot be executed on an expired transaction.',
    };
    withTenantContext.mockRejectedValue(expirada);
    const aserto = expect(procesarLote([gps(1)])).rejects.toMatchObject({ code: 'P2028' });
    await vi.advanceTimersByTimeAsync(31 * 60_000);
    await aserto;
    expect(createMany).not.toHaveBeenCalled();
  });

  it('error no transitorio fuera del bucle por evento: loguea los rechazos bufereados y relanza', async () => {
    withTenantContext.mockImplementation(async (ctx, fn) =>
      ctx.sindicatoId === null ? fn({ syncError: { createMany } }) : Promise.reject(new Error('dato corrupto')),
    );
    createMany.mockRejectedValue(prismaRaw('42501'));
    await expect(procesarLote([gps(1)])).rejects.toMatchObject({ code: 'P2010' });
    const linea = error.mock.calls.map((c) => c[0] as string).find((m) => m.includes('NO quedaron'));
    expect(linea).toContain(gps(1).eventId);
    expect(linea).toContain('error permanente');
    expect(linea).not.toContain('lat');
  });

  it('apagado durante el sueño NO loguea rechazos perdidos (el job vuelve a wait)', async () => {
    withTenantContext
      .mockRejectedValueOnce(new Error('dato corrupto'))
      .mockRejectedValue({ code: 'P1017' });
    const aserto = expect(procesarLote([gps(1), cumplimiento])).rejects.toMatchObject({ name: 'WaitingError' });
    await vi.advanceTimersByTimeAsync(1_000);
    apagado.abort();
    await aserto;
    expect(error.mock.calls.map((c) => c[0] as string).some((m) => m.includes('NO quedaron'))).toBe(false);
  });

  describe('registrarErroresSync', () => {
    it('una fila que Postgres rechaza no tira las demás: cae a insertar fila por fila', async () => {
      const create = vi.fn(async ({ data }: { data: { eventId: string } }) => {
        if (data.eventId === gps(1).eventId) throw prismaRaw('22P05');
      });
      withTenantContext
        .mockRejectedValueOnce(new Error('dato corrupto')) // gps(1) y gps(2) van en el mismo grupo gps
        .mockImplementation(async (ctx, fn) =>
          ctx.sindicatoId === null
            ? fn({ syncError: { createMany: createMany.mockRejectedValue(prismaRaw('22P05')), create } })
            : { abiertas: 0, cerradas: 0, infracciones: 0 },
        );
      await expect(procesarLote([gps(1), gps(2)])).resolves.toMatchObject({ errores: 2 });
      expect(createMany).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledTimes(2);
      const omitido = error.mock.calls.map((c) => c[0] as string).find((m) => m.includes('se omite'));
      expect(omitido).toContain(gps(1).eventId);
      expect(omitido).not.toContain('lat');
    });

    it('si el createMany falla por un transitorio, relanza (se re-corre el lote)', async () => {
      withTenantContext.mockImplementation(async (ctx, fn) =>
        ctx.sindicatoId === null ? porDefecto(ctx, fn) : Promise.reject(new Error('dato corrupto')),
      );
      createMany.mockRejectedValueOnce({ code: 'P1017' });
      const p = procesarLote([gps(1)]);
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(p).resolves.toMatchObject({ errores: 1 });
      expect(createMany).toHaveBeenCalledTimes(2);
    });

    it('permisos (42501) en el createMany: relanza, sin fallback fila por fila', async () => {
      const create = vi.fn();
      withTenantContext.mockImplementation(async (ctx, fn) =>
        ctx.sindicatoId === null
          ? fn({ syncError: { createMany: createMany.mockRejectedValue(prismaRaw('42501')), create } })
          : Promise.reject(new Error('dato corrupto')),
      );
      await expect(procesarLote([gps(1)])).rejects.toMatchObject({ code: 'P2010' });
      expect(create).not.toHaveBeenCalled();
    });

    it('en el fallback, un error que no es clase 22 en una fila relanza (no se descarta)', async () => {
      const create = vi.fn(async () => {
        throw prismaRaw('42501');
      });
      withTenantContext.mockImplementation(async (ctx, fn) =>
        ctx.sindicatoId === null
          ? fn({ syncError: { createMany: createMany.mockRejectedValue(prismaRaw('22021')), create } })
          : Promise.reject(new Error('dato corrupto')),
      );
      await expect(procesarLote([gps(1)])).rejects.toMatchObject({ code: 'P2010' });
      expect(create).toHaveBeenCalledTimes(1);
    });
  });
});

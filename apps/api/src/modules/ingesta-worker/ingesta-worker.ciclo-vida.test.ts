import { describe, expect, it, vi } from 'vitest';

const workers: Array<{ name: string; opts: Record<string, unknown>; close: () => Promise<void> }> = [];
vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<typeof import('bullmq')>()),
  Queue: class {
    close = async () => undefined;
    upsertJobScheduler = async () => undefined;
  },
  Worker: class {
    on = () => this;
    close = vi.fn(async () => undefined);
    constructor(
      public name: string,
      _fn: unknown,
      public opts: Record<string, unknown>,
    ) {
      workers.push(this);
    }
  },
}));
vi.mock('ioredis', () => ({ Redis: class { disconnect = () => undefined; } }));

import { IngestaWorkerService } from './ingesta-worker.service.js';

describe('IngestaWorkerService — Worker de ingesta', () => {
  it('se crea con concurrencia 1 y maxStalledCount 3; onModuleDestroy aborta antes de cerrar', async () => {
    const servicio = new IngestaWorkerService({ get: () => undefined } as never);
    const ingesta = workers.find((w) => w.name === 'ingesta-sync')!;
    expect(ingesta.opts).toMatchObject({ concurrency: 1, maxStalledCount: 3 });

    const apagado = (servicio as unknown as { apagado: AbortController }).apagado;
    let abortadoAlCerrar: boolean | undefined;
    ingesta.close = vi.fn(async () => {
      abortadoAlCerrar = apagado.signal.aborted;
    });
    await servicio.onModuleDestroy();
    expect(abortadoAlCerrar).toBe(true);
  });
});

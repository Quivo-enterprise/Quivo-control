import { beforeEach, describe, expect, it, vi } from 'vitest';

const add = vi.fn();
vi.mock('bullmq', () => ({ Queue: vi.fn(() => ({ add, close: vi.fn() })) }));
vi.mock('ioredis', () => ({ Redis: vi.fn(() => ({ disconnect: vi.fn() })) }));

import { OPCIONES_JOB_INGESTA, SyncQueueService } from './sync-queue.service.js';

describe('SyncQueueService', () => {
  beforeEach(() => add.mockReset());

  it('encola el lote con retención de jobs y reintentos con backoff exponencial', async () => {
    const servicio = new SyncQueueService({ get: () => undefined } as never);
    const job = { sindicatoId: 's', deviceId: 'd', eventos: [] };
    await servicio.encolarLote(job);

    expect(add).toHaveBeenCalledWith('lote', job, OPCIONES_JOB_INGESTA);
    expect(OPCIONES_JOB_INGESTA).toEqual({
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
    });
  });
});

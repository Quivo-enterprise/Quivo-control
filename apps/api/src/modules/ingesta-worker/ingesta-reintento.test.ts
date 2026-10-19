import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventoSync } from '@quivo/shared';

const syncErrorCreate = vi.fn();
const withTenantContext = vi.fn();
vi.mock('@quivo/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@quivo/db')>()),
  withTenantContext: (...args: unknown[]) => withTenantContext(...args),
}));

import { IngestaWorkerService } from './ingesta-worker.service.js';

const gps: EventoSync = {
  eventId: '018e6e6a-0000-7000-8000-000000000001',
  deviceId: 'device-test',
  ts: new Date().toISOString(),
  tipo: 'gps_point',
  payload: { sesionId: '018e6e6a-0000-7000-8000-000000000002', lat: -17.78, lng: -63.18 },
};

function procesarLote() {
  const servicio = Object.create(IngestaWorkerService.prototype) as Record<string, unknown>;
  servicio.logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
  servicio.ingestaQueueStats = { getWaitingCount: async () => 0 };
  return (servicio as never as { procesarLote(job: unknown): Promise<unknown> }).procesarLote({
    id: 'job-test',
    attemptsMade: 0,
    data: { sindicatoId: 's', eventos: [gps] },
  });
}

describe('procesarLote — errores transitorios de la DB', () => {
  beforeEach(() => {
    syncErrorCreate.mockReset();
    withTenantContext.mockReset();
  });

  it('un error transitorio en el insert hace fallar el job (BullMQ reintenta) y NO va a sync_errors', async () => {
    withTenantContext.mockRejectedValue({ code: 'P1017' });
    await expect(procesarLote()).rejects.toMatchObject({ code: 'P1017' });
    expect(syncErrorCreate).not.toHaveBeenCalled();
    expect(withTenantContext).toHaveBeenCalledTimes(1); // ni siquiera intentó registrar el error
  });

  it('un error permanente sigue yendo a sync_errors y el job termina', async () => {
    withTenantContext
      .mockRejectedValueOnce(new Error('dato corrupto'))
      .mockImplementation(async (_ctx: unknown, fn: (tx: unknown) => unknown) =>
        fn({ syncError: { create: syncErrorCreate } }),
      );
    await expect(procesarLote()).resolves.toMatchObject({ errores: 1 });
    expect(syncErrorCreate).toHaveBeenCalledTimes(1);
  });
});

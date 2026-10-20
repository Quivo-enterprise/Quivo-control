import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller.js';
import type { HealthService } from './health.service.js';

// El service ahora importa el cliente Prisma compartido, que exige RUNTIME_DATABASE_URL/JWT_SECRET
// al cargarse: el controller se prueba con un service falso, no necesita la base.
vi.mock('@quivo/db', () => ({ prisma: {} }));

function fakeService(result: {
  status: 'ok' | 'degraded';
  db: 'up' | 'down';
  redis: 'up' | 'down';
}) {
  return { check: vi.fn().mockResolvedValue(result) } as unknown as HealthService;
}

describe('HealthController', () => {
  it('devuelve el resultado cuando db y redis están up', async () => {
    const controller = new HealthController(fakeService({ status: 'ok', db: 'up', redis: 'up' }));
    await expect(controller.check()).resolves.toEqual({ status: 'ok', db: 'up', redis: 'up' });
  });

  it('lanza ServiceUnavailableException si algo está down', async () => {
    const controller = new HealthController(
      fakeService({ status: 'degraded', db: 'down', redis: 'up' }),
    );
    await expect(controller.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  // QUI-354: liveness/readiness separados.
  it('live() no toca el service y siempre responde ok', () => {
    const controller = new HealthController(fakeService({ status: 'ok', db: 'up', redis: 'up' }));
    expect(controller.live()).toEqual({ status: 'ok' });
  });

  it('ready() devuelve el resultado cuando db y redis están up', async () => {
    const controller = new HealthController(fakeService({ status: 'ok', db: 'up', redis: 'up' }));
    await expect(controller.ready()).resolves.toEqual({ status: 'ok', db: 'up', redis: 'up' });
  });

  it('ready() lanza ServiceUnavailableException si algo está down', async () => {
    const controller = new HealthController(
      fakeService({ status: 'degraded', db: 'up', redis: 'down' }),
    );
    await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

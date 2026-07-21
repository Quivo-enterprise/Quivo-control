import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller.js';
import type { HealthService } from './health.service.js';

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
});

import { Reflector } from '@nestjs/core';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { describe, expect, it } from 'vitest';
import {
  FOTO_VEHICULO_THROTTLE,
  FotoVehiculoThrottlerGuard,
} from './foto-vehiculo-throttler.guard.js';

function tracker(req: unknown): Promise<string> {
  const guard = new FotoVehiculoThrottlerGuard({} as ThrottlerStorage, new Reflector());
  return (
    guard as unknown as { getTracker: (r: unknown) => Promise<string> }
  ).getTracker(req);
}

describe('FotoVehiculoThrottlerGuard', () => {
  it('usa el deviceId estable, no la sesión', async () => {
    expect(
      await tracker({ ip: '1.1.1.1', sesionMovil: { sesionId: 's1', deviceId: 'dev-1' } }),
    ).toBe('dev-1');
    // Otra sesión del mismo dispositivo comparte cupo.
    expect(
      await tracker({ ip: '1.1.1.1', sesionMovil: { sesionId: 's2', deviceId: 'dev-1' } }),
    ).toBe('dev-1');
  });

  it('cae a la IP sin sesión', async () => {
    expect(await tracker({ ip: '2.2.2.2' })).toBe('2.2.2.2');
  });

  it('define 10/hora como única fuente', () => {
    expect(FOTO_VEHICULO_THROTTLE).toEqual({ name: 'foto', ttl: 3_600_000, limit: 10 });
  });
});

import { describe, expect, it } from 'vitest';
import { RolSchema, SindicatoSchema, EventoSyncSchema } from './index.js';

describe('@quivo/shared contract', () => {
  it('acepta un rol válido y rechaza uno inválido', () => {
    expect(RolSchema.safeParse('conductor').success).toBe(true);
    expect(RolSchema.safeParse('rol_inexistente').success).toBe(false);
  });

  it('valida una entidad sindicato completa', () => {
    const result = SindicatoSchema.safeParse({
      id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      nombre: 'Sindicato de Transporte Central',
      estado: 'activo',
    });
    expect(result.success).toBe(true);
  });

  it('exige UUIDv7 en el event_id de sync (idempotencia RF-72)', () => {
    const uuidV4 = '3fa85f64-5717-4562-b3fc-2c963f66afa6'; // versión 4, no 7
    const uuidV7 = '018e6e6a-0000-7000-8000-000000000000';

    expect(
      EventoSyncSchema.safeParse({
        eventId: uuidV4,
        deviceId: 'device-1',
        ts: new Date().toISOString(),
        tipo: 'gps_point',
        payload: {},
      }).success,
    ).toBe(false);

    expect(
      EventoSyncSchema.safeParse({
        eventId: uuidV7,
        deviceId: 'device-1',
        ts: new Date().toISOString(),
        tipo: 'gps_point',
        payload: { lat: -17.78, lng: -63.18 },
      }).success,
    ).toBe(true);
  });
});

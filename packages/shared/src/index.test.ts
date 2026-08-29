import { describe, expect, it } from 'vitest';
import {
  RolSchema,
  SindicatoSchema,
  EventoSyncSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  PublicMobilityCitySchema,
  JourneySearchRequestSchema,
} from './index.js';

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

  it('exige email y password en el login, y rechaza un sindicatoId que no sea UUID', () => {
    expect(LoginRequestSchema.safeParse({ email: 'no-es-un-email', password: 'x' }).success).toBe(
      false,
    );
    expect(
      LoginRequestSchema.safeParse({ email: 'admin@quivo.local', password: 'Quivo123!' }).success,
    ).toBe(true);

    expect(
      LoginResponseSchema.safeParse({
        accessToken: 'jwt.token.aqui',
        refreshToken: 'refresh-token-opaco',
        user: {
          id: 'user-1',
          email: 'admin@quivo.local',
          rol: 'admin_quivo',
          sindicatoId: null,
        },
      }).success,
    ).toBe(true);

    expect(
      LoginResponseSchema.safeParse({
        accessToken: 'jwt.token.aqui',
        refreshToken: 'refresh-token-opaco',
        user: {
          id: 'user-2',
          email: 'admin@sindicato.local',
          rol: 'admin_sindicato',
          sindicatoId: 'no-es-un-uuid',
        },
      }).success,
    ).toBe(false);
  });

  it('valida cobertura de ciudad y mantiene compatible la búsqueda sin cityId', () => {
    expect(PublicMobilityCitySchema.safeParse({
      id: 'la-paz-el-alto',
      name: 'La Paz / El Alto',
      departmentCode: 'BO-L',
      departmentName: 'La Paz',
      countryCode: 'BO',
      timezone: 'America/La_Paz',
      coverageStatus: 'community',
      sourceType: 'community+municipal',
      sourceName: 'OSM/Overpass + catálogo municipal',
      sourceLicense: 'ODbL / referencias municipales',
      sourceUpdatedAt: null,
      availableModes: ['road', 'cable'],
      auxiliaryServices: ['schedule-dependent'],
    }).success).toBe(true);
    expect(JourneySearchRequestSchema.safeParse({
      origin: { type: 'Point', coordinates: [-68.15, -16.5] },
      destination: { type: 'Point', coordinates: [-68.14, -16.51] },
    }).success).toBe(true);
    expect(JourneySearchRequestSchema.safeParse({
      cityId: 'La Paz',
      origin: { type: 'Point', coordinates: [-68.15, -16.5] },
      destination: { type: 'Point', coordinates: [-68.14, -16.51] },
    }).success).toBe(false);
  });
});

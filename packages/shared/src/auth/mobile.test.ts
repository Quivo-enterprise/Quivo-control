import { describe, expect, it } from 'vitest';
import {
  AuthConductorMovilRequestSchema,
  AuthVehiculoMovilRequestSchema,
  PinMovilSchema,
} from './mobile.js';

describe('contratos de autenticación móvil', () => {
  it('acepta placa, PIN y deviceId válidos', () => {
    expect(
      AuthVehiculoMovilRequestSchema.parse({
        placa: '1234-ABC',
        pin: '246810',
        deviceId: 'android:test-001',
      }),
    ).toEqual({ placa: '1234-ABC', pin: '246810', deviceId: 'android:test-001' });
  });

  it('rechaza PINes débiles o no numéricos', () => {
    expect(PinMovilSchema.safeParse('12345').success).toBe(false);
    expect(PinMovilSchema.safeParse('abcdef').success).toBe(false);
  });

  it('permite confirmar una asignación sin reenviar credenciales del conductor', () => {
    expect(
      AuthConductorMovilRequestSchema.safeParse({
        challengeToken: 'mobile_ch_abcdefghijklmnopqrstuvwxyz1234567890',
        deviceId: 'android:test-001',
        asignacionId: '550e8400-e29b-41d4-a716-446655440000',
      }).success,
    ).toBe(true);
  });
});

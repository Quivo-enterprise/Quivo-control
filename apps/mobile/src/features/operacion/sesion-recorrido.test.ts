import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));

import { debeReemitirInicio } from './sesion-recorrido';

describe('debeReemitirInicio', () => {
  it('no re-emite si nunca se guardó sesión', () => {
    expect(debeReemitirInicio(null, 's2')).toBe(false);
  });
  it('no re-emite con la misma sesión (app reabierta)', () => {
    expect(debeReemitirInicio('s1', 's1')).toBe(false);
  });
  it('re-emite con otra sesión (re-login)', () => {
    expect(debeReemitirInicio('s1', 's2')).toBe(true);
  });
});

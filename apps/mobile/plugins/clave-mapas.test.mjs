import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { evaluarClaveMapas } = createRequire(import.meta.url)('./clave-mapas.cjs');

describe('evaluarClaveMapas', () => {
  it('con key siempre es ok', () => {
    expect(
      evaluarClaveMapas({
        GOOGLE_MAPS_ANDROID_API_KEY: 'k',
        EAS_BUILD: 'true',
        EAS_BUILD_PROFILE: 'production',
      }),
    ).toBe('ok');
  });

  it('sin key en un build de EAS de producción falla', () => {
    expect(evaluarClaveMapas({ EAS_BUILD: 'true', EAS_BUILD_PROFILE: 'production' })).toBe('fallar');
  });

  it('sin key en un build de EAS sin perfil conocido falla (no se asume desarrollo)', () => {
    expect(evaluarClaveMapas({ EAS_BUILD: 'true' })).toBe('fallar');
  });

  it('sin key en el perfil development solo advierte', () => {
    expect(evaluarClaveMapas({ EAS_BUILD: 'true', EAS_BUILD_PROFILE: 'development' })).toBe('advertir');
  });

  it('sin key en una corrida local solo advierte', () => {
    expect(evaluarClaveMapas({})).toBe('advertir');
  });

  it('una key vacía cuenta como ausente', () => {
    expect(evaluarClaveMapas({ GOOGLE_MAPS_ANDROID_API_KEY: '', EAS_BUILD: 'true' })).toBe('fallar');
  });
});

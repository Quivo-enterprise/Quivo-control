import { describe, expect, it } from 'vitest';
import { dataUriDemasiadoGrande, TOPE_DATA_URI_BYTES } from './foto-perfil-limite';

describe('dataUriDemasiadoGrande', () => {
  it('acepta un data URI por debajo del tope', () => {
    const dataUri = `data:image/jpeg;base64,${'a'.repeat(TOPE_DATA_URI_BYTES - 100)}`;
    expect(dataUriDemasiadoGrande(dataUri)).toBe(false);
  });

  it('rechaza un data URI por encima del tope', () => {
    const dataUri = `data:image/jpeg;base64,${'a'.repeat(TOPE_DATA_URI_BYTES + 100)}`;
    expect(dataUriDemasiadoGrande(dataUri)).toBe(true);
  });

  it('el límite es exacto (justo en el tope no se rechaza, uno más sí)', () => {
    const exacto = 'a'.repeat(TOPE_DATA_URI_BYTES);
    const unoDemas = 'a'.repeat(TOPE_DATA_URI_BYTES + 1);
    expect(dataUriDemasiadoGrande(exacto)).toBe(false);
    expect(dataUriDemasiadoGrande(unoDemas)).toBe(true);
  });
});

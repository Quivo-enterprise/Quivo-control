import { describe, expect, it } from 'vitest';
import { etiquetaLinea } from './use-linea-options';

describe('etiquetaLinea', () => {
  it('código "1" con nombre "Línea 16" conserva el código', () => {
    expect(etiquetaLinea({ codigo: '1', nombre: 'Línea 16', nombreCorto: null })).toBe('1 - Línea 16');
  });
  it('código "16" con nombre "Línea 16" muestra solo el nombre', () => {
    expect(etiquetaLinea({ codigo: '16', nombre: 'Línea 16', nombreCorto: null })).toBe('Línea 16');
  });
  it('usa nombreCorto cuando existe', () => {
    expect(etiquetaLinea({ codigo: '16', nombre: 'Trufi larga', nombreCorto: 'Línea 16' })).toBe('Línea 16');
  });
});

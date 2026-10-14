import { describe, expect, it } from 'vitest';
import { estadoBotonActualizar, etiquetaVersion, puedeReiniciarAhora } from './actualizaciones-core';

describe('etiquetaVersion', () => {
  it('muestra "integrada" con el bundle embebido', () => {
    expect(etiquetaVersion('0.1.0', '00000000-0000-0000-0000-000000000000', true)).toBe('0.1.0 · integrada');
  });
  it('muestra 8 caracteres del updateId con OTA', () => {
    expect(etiquetaVersion('0.1.0', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', false)).toBe('0.1.0 · a1b2c3d4');
  });
  it('cae a "integrada" si no hay updateId y tolera versión vacía', () => {
    expect(etiquetaVersion(null, null, false)).toBe('— · integrada');
  });
});

describe('estadoBotonActualizar', () => {
  it('deshabilitado en desarrollo o sin updates', () => {
    expect(estadoBotonActualizar({ isDev: true, updatesHabilitado: true })).toEqual({
      habilitado: false,
      motivo: 'No disponible en desarrollo',
    });
    expect(estadoBotonActualizar({ isDev: false, updatesHabilitado: false }).habilitado).toBe(false);
  });
  it('habilitado en release con updates', () => {
    expect(estadoBotonActualizar({ isDev: false, updatesHabilitado: true })).toEqual({ habilitado: true });
  });
});

describe('puedeReiniciarAhora', () => {
  it('no con recorrido activo', () => {
    expect(puedeReiniciarAhora(true)).toBe(false);
    expect(puedeReiniciarAhora(false)).toBe(true);
  });
});

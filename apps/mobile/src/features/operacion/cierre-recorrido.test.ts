import { describe, expect, it, vi } from 'vitest';
import { cerrarRecorridoLocal } from './cierre-recorrido';

describe('cerrarRecorridoLocal', () => {
  it('espera iniciar, borra el registro ANTES de detener el nativo y de apagar tracking', async () => {
    const orden: string[] = [];
    await cerrarRecorridoLocal({
      esperarIniciar: async () => void orden.push('esperar-iniciar'),
      borrarRegistro: async () => void orden.push('borrar-registro'),
      detenerNativo: async () => void orden.push('detener-nativo'),
      apagarTracking: () => void orden.push('set-tracking-false'),
      reportar: () => undefined,
    });
    expect(orden).toEqual(['esperar-iniciar', 'borrar-registro', 'detener-nativo', 'set-tracking-false']);
  });

  it('si borrar el registro falla, se reporta y el cierre continúa', async () => {
    const reportar = vi.fn();
    const apagarTracking = vi.fn();
    const error = new Error('sqlite');
    await cerrarRecorridoLocal({
      esperarIniciar: async () => undefined,
      borrarRegistro: async () => {
        throw error;
      },
      detenerNativo: async () => undefined,
      apagarTracking,
      reportar,
    });
    expect(reportar).toHaveBeenCalledWith(error);
    expect(apagarTracking).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { cerrarRecorridoLocal, TOPE_BORRADO_REGISTRO_MS } from './cierre-recorrido';

describe('cerrarRecorridoLocal', () => {
  it('espera iniciar, borra el registro ANTES de detener el nativo y de apagar tracking', async () => {
    const orden: string[] = [];
    await cerrarRecorridoLocal({
      esperarIniciar: async () => void orden.push('esperar-iniciar'),
      suspenderRegistro: () => {
        orden.push('suspender');
        return () => void orden.push('restaurar');
      },
      borrarRegistro: async () => void orden.push('borrar-registro'),
      detenerNativo: async () => void orden.push('detener-nativo'),
      apagarTracking: () => void orden.push('set-tracking-false'),
      reportar: () => undefined,
    });
    expect(orden).toEqual(['esperar-iniciar', 'suspender', 'borrar-registro', 'detener-nativo', 'set-tracking-false']);
  });

  it('si borrar el registro falla, se reporta y el cierre continúa', async () => {
    const reportar = vi.fn();
    const apagarTracking = vi.fn();
    const error = new Error('sqlite');
    await cerrarRecorridoLocal({
      esperarIniciar: async () => undefined,
      suspenderRegistro: () => () => undefined,
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

  it('si stop() falla: desarma el reintento antes de borrar, restaura el registro, no apaga tracking y propaga', async () => {
    const orden: string[] = [];
    const apagarTracking = vi.fn();
    const error = new Error('stop nativo');
    await expect(
      cerrarRecorridoLocal({
        esperarIniciar: async () => undefined,
        suspenderRegistro: () => {
          orden.push('suspender');
          return () => void orden.push('restaurar');
        },
        borrarRegistro: async () => void orden.push('borrar-registro'),
        detenerNativo: async () => {
          orden.push('detener-nativo');
          throw error;
        },
        apagarTracking,
        reportar: () => undefined,
      }),
    ).rejects.toBe(error);
    expect(orden).toEqual(['suspender', 'borrar-registro', 'detener-nativo', 'restaurar']);
    expect(apagarTracking).not.toHaveBeenCalled();
  });

  it('si stop() resuelve no restaura el registro', async () => {
    const restaurar = vi.fn();
    await cerrarRecorridoLocal({
      esperarIniciar: async () => undefined,
      suspenderRegistro: () => restaurar,
      borrarRegistro: async () => undefined,
      detenerNativo: async () => undefined,
      apagarTracking: () => undefined,
      reportar: () => undefined,
    });
    expect(restaurar).not.toHaveBeenCalled();
  });

  it('si borrar el registro nunca resuelve: tras el tope reporta y detiene el nativo y apaga tracking igual', async () => {
    vi.useFakeTimers();
    try {
      const reportar = vi.fn();
      const detenerNativo = vi.fn(async () => undefined);
      const apagarTracking = vi.fn();
      const cierre = cerrarRecorridoLocal({
        esperarIniciar: async () => undefined,
        suspenderRegistro: () => () => undefined,
        borrarRegistro: () => new Promise<void>(() => undefined),
        detenerNativo,
        apagarTracking,
        reportar,
      });
      await vi.advanceTimersByTimeAsync(TOPE_BORRADO_REGISTRO_MS);
      await cierre;
      expect(reportar).toHaveBeenCalledTimes(1);
      expect(reportar.mock.calls[0]?.[0]).toBeInstanceOf(Error);
      expect(detenerNativo).toHaveBeenCalledTimes(1);
      expect(apagarTracking).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

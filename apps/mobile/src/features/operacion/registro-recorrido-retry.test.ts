import { describe, expect, it, vi } from 'vitest';
import {
  asegurarRegistroRecorrido,
  crearEstadoRegistroRecorrido,
  reiniciarEstadoRegistroRecorrido,
} from './registro-recorrido-retry';

describe('asegurarRegistroRecorrido', () => {
  it('sin iniciar() (eventId null): no escribe', async () => {
    const asegurarRecorridoActual = vi.fn(async () => {});
    await asegurarRegistroRecorrido(crearEstadoRegistroRecorrido(), { asegurarRecorridoActual }, 's');
    expect(asegurarRecorridoActual).not.toHaveBeenCalled();
  });

  it('reintenta tras un fallo con el mismo eventId y deja de escribir al lograrlo', async () => {
    const estado = crearEstadoRegistroRecorrido();
    reiniciarEstadoRegistroRecorrido(estado, 'rec-1');
    const asegurarRecorridoActual = vi
      .fn<(s: string, r: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('disk'))
      .mockResolvedValue(undefined);
    await expect(asegurarRegistroRecorrido(estado, { asegurarRecorridoActual }, 's')).rejects.toThrow('disk');
    expect(estado.registrado).toBe(false);
    await asegurarRegistroRecorrido(estado, { asegurarRecorridoActual }, 's');
    expect(estado.registrado).toBe(true);
    await asegurarRegistroRecorrido(estado, { asegurarRecorridoActual }, 's');
    expect(asegurarRecorridoActual).toHaveBeenCalledTimes(2);
    expect(asegurarRecorridoActual).toHaveBeenLastCalledWith('s', 'rec-1');
  });

  it('reiniciar resetea registrado con el id nuevo', () => {
    const estado = { eventId: 'viejo', registrado: true };
    reiniciarEstadoRegistroRecorrido(estado, 'nuevo');
    expect(estado).toEqual({ eventId: 'nuevo', registrado: false });
  });
});

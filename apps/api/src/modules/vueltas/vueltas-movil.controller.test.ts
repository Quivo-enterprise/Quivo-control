import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';
import { VueltasMovilController } from './vueltas-movil.controller.js';

describe('GET /mobile/vuelta-actual: la fila es opcional', () => {
  it('si el estado de la fila falla responde igual SIN el campo fila (no null) y loguea un warn', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const vueltas = { obtenerActualMovil: async () => ({ vuelta: { numero: 3 } }) };
    const fila = { estadoMovil: async () => { throw new Error('boom'); } };
    const controller = new VueltasMovilController(vueltas as never, fila as never);
    const r = await controller.obtener({ sesionId: 's1' } as SesionMovilAutenticada);
    expect(r.fila).toBeUndefined();
    expect(r).toMatchObject({ vuelta: { numero: 3 } });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

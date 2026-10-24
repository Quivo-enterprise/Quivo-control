import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PuntoControlPaquete } from '@quivo/shared';
import { ESTADO_LOCAL_INICIAL } from '../vuelta-actual/vuelta-actual-core';

const mocks = vi.hoisted(() => ({
  leer: vi.fn(),
  llegada: vi.fn(),
  salida: vi.fn(),
  rearmar: vi.fn(),
  pausa: vi.fn(),
}));

vi.mock('@sentry/react-native', () => ({ captureException: vi.fn() }));
vi.mock('../../db/vuelta-actual-local', () => ({ leerEstadoVueltaLocal: mocks.leer }));
vi.mock('../vuelta-actual/vuelta-actual-oportunista', () => ({ rearmarFilaLocal: mocks.rearmar }));
vi.mock('../operacion/pausa-recorrido', () => ({ leerPausa: mocks.pausa }));
vi.mock('./fila-salida-acciones', () => ({
  registrarLlegada: mocks.llegada,
  registrarSalida: mocks.salida,
}));

import { MAX_EDAD_FIX_MS, procesarFixFila, ultimoFixFila } from './fila-salida-deteccion';
import { reiniciarDeteccionFila } from './fila-salida-estado';

const TERMINAL = {
  rol: 'terminal',
  coord: { type: 'Point', coordinates: [-66.15, -17.38] },
  radioToleranciaM: 50,
};
const ctx = {
  sesionId: 's1',
  puntosControl: [TERMINAL] as unknown as PuntoControlPaquete[],
  obtenerAccessToken: async () => 'tok',
};
const fixEnTerminal = { lat: -17.38, lng: -66.15, accuracy: 10, ts: '2026-10-20T11:00:00.000Z' };

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.leer.mockResolvedValue(ESTADO_LOCAL_INICIAL);
  mocks.llegada.mockResolvedValue({ ok: true });
  mocks.pausa.mockResolvedValue(null);
  reiniciarDeteccionFila();
});
afterEach(() => vi.useRealTimers());

describe('procesarFixFila', () => {
  it('en pausa no registra la llegada', async () => {
    mocks.pausa.mockResolvedValue('2026-10-20T11:00:00.000Z');
    await procesarFixFila(fixEnTerminal, ctx);
    expect(mocks.pausa).toHaveBeenCalledWith('s1');
    expect(mocks.llegada).not.toHaveBeenCalled();
  });

  it('avisa alDetectarLlegada al detectar la entrada, antes del POST, y no en pausa', async () => {
    const orden: string[] = [];
    const alDetectarLlegada = vi.fn(() => orden.push('cb'));
    mocks.llegada.mockImplementation(async () => {
      orden.push('post');
      return { ok: false, mensaje: 'x' };
    });
    await procesarFixFila(fixEnTerminal, { ...ctx, alDetectarLlegada });
    expect(alDetectarLlegada).toHaveBeenCalledTimes(1);
    expect(orden).toEqual(['cb', 'post']);

    reiniciarDeteccionFila();
    alDetectarLlegada.mockClear();
    mocks.pausa.mockResolvedValue('2026-10-20T11:00:00.000Z');
    await procesarFixFila(fixEnTerminal, { ...ctx, alDetectarLlegada });
    expect(alDetectarLlegada).not.toHaveBeenCalled();
  });

  it('dos llamadas concurrentes producen un solo POST de llegada (candado enCurso)', async () => {
    await Promise.all([procesarFixFila(fixEnTerminal, ctx), procesarFixFila(fixEnTerminal, ctx)]);
    expect(mocks.llegada).toHaveBeenCalledTimes(1);
  });

  it('el candado se libera al terminar (aunque el anti-rebote frene el siguiente POST)', async () => {
    await procesarFixFila(fixEnTerminal, ctx);
    await procesarFixFila(fixEnTerminal, ctx);
    expect(mocks.leer).toHaveBeenCalledTimes(2);
    expect(mocks.llegada).toHaveBeenCalledTimes(1);
  });
});

describe('ultimoFixFila', () => {
  it('descarta un fix recibido hace más de 60 s', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T11:00:00.000Z'));
    await procesarFixFila(fixEnTerminal, ctx);
    expect(ultimoFixFila()).toEqual(fixEnTerminal);
    vi.setSystemTime(Date.now() + MAX_EDAD_FIX_MS + 1);
    expect(ultimoFixFila()).toBeNull();
  });

  it('reiniciarDeteccionFila olvida el fix', async () => {
    await procesarFixFila(fixEnTerminal, ctx);
    reiniciarDeteccionFila();
    expect(ultimoFixFila()).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EstadoFilaSalida } from '@quivo/shared';
import { ESTADO_LOCAL_INICIAL, type EstadoLocalVuelta } from '../vuelta-actual/vuelta-actual-core';
import { idAvisoFila } from './fila-salida-core';

const mocks = vi.hoisted(() => ({ programar: vi.fn(), cancelar: vi.fn() }));
vi.mock('../operacion/anuncio-punto-control', () => ({
  programarAvisoEnCanal: mocks.programar,
  cancelarAvisoProgramado: mocks.cancelar,
}));

import { cancelarAvisoFilaDe, sincronizarAvisoFila } from './fila-salida-aviso';

const SERVIDOR = Date.parse('2026-10-20T11:00:00.000Z');
const fila = (parcial: Partial<EstadoFilaSalida> = {}): EstadoFilaSalida => ({
  posicion: 1,
  total: 4,
  delantePlaca: 'ABC',
  etaTs: new Date(SERVIDOR + 300_000).toISOString(),
  esperaMs: 300_000,
  habilitado: false,
  demorado: false,
  servidorTs: new Date(SERVIDOR).toISOString(),
  ...parcial,
});
const estado = (
  f: EstadoFilaSalida | null,
  desfaseFilaMs: number | undefined = 0,
): EstadoLocalVuelta => ({
  ...ESTADO_LOCAL_INICIAL,
  ultimo: {
    vueltaId: null,
    numero: null,
    designacion: null,
    enEspera: null,
    fila: f,
  } as EstadoLocalVuelta['ultimo'],
  actualizadoEn: SERVIDOR,
  ...(f && desfaseFilaMs !== undefined ? { desfaseFilaMs } : {}),
});

beforeEach(() => {
  mocks.programar.mockReset().mockResolvedValue(true);
  mocks.cancelar.mockReset().mockResolvedValue(undefined);
});

describe('sincronizarAvisoFila', () => {
  it('programa a eta - 60 s corregido por el desfase del reloj', async () => {
    // el teléfono va 90 s atrasado: desfase +90 s
    await sincronizarAvisoFila(estado(null), estado(fila(), 90_000), SERVIDOR - 90_000);
    expect(mocks.programar).toHaveBeenCalledTimes(1);
    const arg = mocks.programar.mock.calls[0]![0] as { identifier: string; fechaMs: number };
    expect(arg.identifier).toBe(idAvisoFila(fila().etaTs));
    expect(arg.fechaMs).toBe(SERVIDOR + 300_000 - 90_000 - 60_000);
  });

  it('cancela el aviso del etaTs anterior cuando cambia y programa el nuevo', async () => {
    const nueva = fila({ etaTs: new Date(SERVIDOR + 400_000).toISOString() });
    await sincronizarAvisoFila(estado(fila()), estado(nueva), SERVIDOR);
    expect(mocks.cancelar).toHaveBeenCalledWith(idAvisoFila(fila().etaTs));
    expect(mocks.programar.mock.calls[0]![0]).toMatchObject({
      identifier: idAvisoFila(nueva.etaTs),
    });
  });

  it('no programa al que no es el primero y cancela la que hubiera', async () => {
    await sincronizarAvisoFila(estado(fila()), estado(fila({ posicion: 2 })), SERVIDOR);
    expect(mocks.programar).not.toHaveBeenCalled();
    expect(mocks.cancelar).toHaveBeenCalledWith(idAvisoFila(fila().etaTs));
  });

  it('cancela al salir de la fila y al habilitarse, y no programa', async () => {
    await sincronizarAvisoFila(estado(fila()), estado(null), SERVIDOR);
    expect(mocks.cancelar).toHaveBeenCalledWith(idAvisoFila(fila().etaTs));
    mocks.cancelar.mockClear();
    await sincronizarAvisoFila(estado(fila()), estado(fila({ habilitado: true })), SERVIDOR);
    expect(mocks.cancelar).toHaveBeenCalledWith(idAvisoFila(fila().etaTs));
    expect(mocks.programar).not.toHaveBeenCalled();
  });

  it('no programa si el aviso ya pasó o es inminente (lo cubre el de foreground)', async () => {
    await sincronizarAvisoFila(estado(null), estado(fila()), SERVIDOR + 250_000);
    expect(mocks.programar).not.toHaveBeenCalled();
  });

  it('nunca rechaza', async () => {
    mocks.programar.mockRejectedValue(new Error('x'));
    await expect(
      sincronizarAvisoFila(estado(null), estado(fila()), SERVIDOR),
    ).resolves.toBeUndefined();
  });

  it('cancelarAvisoFilaDe cancela la del estado vigente', async () => {
    await cancelarAvisoFilaDe(estado(fila()));
    expect(mocks.cancelar).toHaveBeenCalledWith(idAvisoFila(fila().etaTs));
    mocks.cancelar.mockClear();
    await cancelarAvisoFilaDe(estado(null));
    expect(mocks.cancelar).not.toHaveBeenCalled();
  });
});

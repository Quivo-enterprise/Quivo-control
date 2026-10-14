import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  filas: new Map<string, string>(),
  falla: false,
  transacciones: 0,
}));

vi.mock('./paquete-dia', () => ({
  abrirPaqueteDiaDb: async () => {
    if (m.falla) throw new Error('sqlite muerto');
    return {
      withTransactionAsync: async (fn: () => Promise<void>) => {
        m.transacciones += 1;
        await fn();
      },
      getFirstAsync: async (_sql: string, [sesion]: [string]) => {
        const id = m.filas.get(sesion);
        return id === undefined ? null : { recorrido_id: id };
      },
      runAsync: async (sql: string, params: string[]) => {
        if (sql.startsWith('INSERT OR REPLACE')) m.filas.set(params[0]!, params[1]!);
        else if (sql.startsWith('INSERT OR IGNORE')) {
          if (!m.filas.has(params[0]!)) m.filas.set(params[0]!, params[1]!);
        } else if (sql.includes('sesion_id <>')) {
          for (const k of [...m.filas.keys()]) if (k !== params[0]) m.filas.delete(k);
        } else if (sql.startsWith('DELETE')) m.filas.delete(params[0]!);
        return { changes: 1 };
      },
    };
  },
}));

import {
  finalizarRecorridoActual,
  registrarRecorridoActual,
  leerRecorridoActual,
} from './recorrido-actual';

beforeEach(() => {
  m.filas.clear();
  m.falla = false;
  m.transacciones = 0;
});

describe('recorrido_actual', () => {
  it('sin fila: ok con recorridoId null; un error de lectura es {ok:false}, no "sin recorrido"', async () => {
    expect(await leerRecorridoActual('s')).toEqual({ ok: true, recorridoId: null });
    m.falla = true;
    expect(await leerRecorridoActual('s')).toEqual({ ok: false });
  });

  it('iniciar escribe el id, reemplaza el anterior y limpia otras sesiones', async () => {
    m.filas.set('otra', 'x');
    await registrarRecorridoActual('s', 'rec-1', true);
    await registrarRecorridoActual('s', 'rec-2', true);
    expect(await leerRecorridoActual('s')).toEqual({ ok: true, recorridoId: 'rec-2' });
    expect(m.filas.has('otra')).toBe(false);
    expect(m.transacciones).toBe(2);
  });

  it('re-enganche: sin fila crea una con id nuevo; con fila no la pisa', async () => {
    await registrarRecorridoActual('s', 'rec-nuevo', false);
    expect(await leerRecorridoActual('s')).toEqual({ ok: true, recorridoId: 'rec-nuevo' });
    await registrarRecorridoActual('s', 'rec-otro', false);
    expect(await leerRecorridoActual('s')).toEqual({ ok: true, recorridoId: 'rec-nuevo' });
  });

  it('finalizar borra el registro', async () => {
    await registrarRecorridoActual('s', 'rec-1', true);
    await finalizarRecorridoActual('s');
    expect(await leerRecorridoActual('s')).toEqual({ ok: true, recorridoId: null });
  });
});

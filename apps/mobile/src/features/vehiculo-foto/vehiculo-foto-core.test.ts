import { describe, expect, it, vi } from 'vitest';
import {
  backoffMs,
  bytesDecodificados,
  debeMostrarAviso,
  debeReiniciarPorSesion,
  estadoFotoVehiculo,
  esReintentable,
  excedeTopeFoto,
  mensajeErrorSubida,
  pendientePerteneceASesion,
  recorteCuadradoCentrado,
  subidaYaAplicada,
  subirConReintentos,
  type ErrorSubida,
  type EstadoFotoVehiculo,
} from './vehiculo-foto-core';

const clasificar = (e: unknown): ErrorSubida => e as ErrorSubida;

describe('tamaño', () => {
  it('calcula bytes decodificados con padding', () => {
    expect(bytesDecodificados('')).toBe(0);
    expect(bytesDecodificados('TWFu')).toBe(3);
    expect(bytesDecodificados('TWE=')).toBe(2);
    expect(bytesDecodificados('TQ==')).toBe(1);
  });
  it('rechaza más de 2 MB decodificados', () => {
    expect(excedeTopeFoto('A'.repeat(2_000_000))).toBe(false);
    expect(excedeTopeFoto('A'.repeat(2_900_000))).toBe(true);
  });
});

describe('mensajes y reintentabilidad', () => {
  it('traduce 400/401/409/429 a español', () => {
    expect(mensajeErrorSubida({ red: false, status: 409 })).toMatch(/recorrido o vehículo activo/);
    expect(mensajeErrorSubida({ red: false, status: 400 })).toBe(
      'La foto no es válida. Toma otra foto.',
    );
    expect(mensajeErrorSubida({ red: false, status: 401 })).toBe(
      'Tu sesión expiró. Vuelve a ingresar para enviar la foto.',
    );
    expect(mensajeErrorSubida({ red: false, status: 429 })).toMatch(/una hora/);
    expect(mensajeErrorSubida({ red: true })).toBe('Se enviará al reconectar.');
  });
  it('solo reintenta red y 5xx', () => {
    expect(esReintentable({ red: true })).toBe(true);
    expect(esReintentable({ red: false, status: 503 })).toBe(true);
    for (const status of [400, 401, 409, 413, 429]) {
      expect(esReintentable({ red: false, status })).toBe(false);
    }
  });
  it('backoff exponencial', () => {
    expect([1, 2, 3].map(backoffMs)).toEqual([1000, 2000, 4000]);
  });
});

describe('subirConReintentos', () => {
  it('devuelve ok al primer intento sin dormir', async () => {
    const dormir = vi.fn(async () => undefined);
    const r = await subirConReintentos({ intentar: async () => 'x', clasificar, dormir });
    expect(r).toEqual({ tipo: 'ok', valor: 'x' });
    expect(dormir).not.toHaveBeenCalled();
  });
  it('reintenta la red con backoff y termina ok', async () => {
    const dormir = vi.fn(async (_ms: number) => undefined);
    const intentar = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ red: true })
      .mockRejectedValueOnce({ red: false, status: 502 })
      .mockResolvedValue('ok');
    const r = await subirConReintentos({ intentar, clasificar, dormir });
    expect(r).toEqual({ tipo: 'ok', valor: 'ok' });
    expect(dormir.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });
  it('sin red tras 3 intentos queda pendiente', async () => {
    const intentar = vi.fn(async () => {
      throw { red: true };
    });
    const r = await subirConReintentos({ intentar, clasificar, dormir: async () => undefined });
    expect(intentar).toHaveBeenCalledTimes(3);
    expect(r).toEqual({ tipo: 'pendiente', mensaje: 'Se enviará al reconectar.' });
  });
  it('no reintenta 400, 409 ni 429', async () => {
    for (const status of [400, 429, 409]) {
      const intentar = vi.fn(async () => {
        throw { red: false, status };
      });
      const r = await subirConReintentos({ intentar, clasificar, dormir: async () => undefined });
      expect(intentar).toHaveBeenCalledTimes(1);
      expect(r.tipo).toBe('error');
    }
  });
  it('5xx agotado es error, no pendiente', async () => {
    const r = await subirConReintentos({
      intentar: async () => {
        throw { red: false, status: 500 };
      },
      clasificar,
      dormir: async () => undefined,
    });
    expect(r.tipo).toBe('error');
  });
  it('respeta cancelado', async () => {
    const intentar = vi.fn(async () => {
      throw { red: true };
    });
    await subirConReintentos({
      intentar,
      clasificar,
      dormir: async () => undefined,
      cancelado: () => true,
    });
    expect(intentar).toHaveBeenCalledTimes(1);
  });
});

describe('verificación de subida ya aplicada', () => {
  const inicio = Date.parse('2026-10-14T13:00:00Z');
  it('retry: si el servidor ya tiene una foto posterior al inicio, no reenvía', async () => {
    const intentar = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ red: true })
      .mockResolvedValue('segundo');
    const r = await subirConReintentos({
      intentar,
      clasificar,
      dormir: async () => undefined,
      yaExistente: async () => 'ya-estaba',
    });
    expect(r).toEqual({ tipo: 'ok', valor: 'ya-estaba' });
    expect(intentar).toHaveBeenCalledTimes(1);
  });
  it('no verifica antes del primer intento salvo que se pida', async () => {
    const yaExistente = vi.fn(async () => null);
    await subirConReintentos({
      intentar: async () => 'x',
      clasificar,
      dormir: async () => undefined,
      yaExistente,
    });
    expect(yaExistente).not.toHaveBeenCalled();
    await subirConReintentos({
      intentar: async () => 'x',
      clasificar,
      dormir: async () => undefined,
      yaExistente,
      verificarPrimero: true,
    });
    expect(yaExistente).toHaveBeenCalledTimes(1);
  });
  it('un fallo al verificar no impide reintentar', async () => {
    const intentar = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ red: true })
      .mockResolvedValue('ok');
    const r = await subirConReintentos({
      intentar,
      clasificar,
      dormir: async () => undefined,
      yaExistente: async () => {
        throw new Error('sin red');
      },
    });
    expect(r).toEqual({ tipo: 'ok', valor: 'ok' });
  });
  it('429 no se reintenta ni se verifica', async () => {
    const yaExistente = vi.fn(async () => null);
    const intentar = vi.fn(async () => {
      throw { red: false, status: 429 };
    });
    const r = await subirConReintentos({
      intentar,
      clasificar,
      dormir: async () => undefined,
      yaExistente,
    });
    expect(r.tipo).toBe('error');
    expect(intentar).toHaveBeenCalledTimes(1);
    expect(yaExistente).not.toHaveBeenCalled();
  });
  it('subidaYaAplicada compara con el inicio menos el margen de reloj', () => {
    expect(subidaYaAplicada({ fotoActualizadaEn: '2026-10-14T13:00:30Z', inicioMs: inicio })).toBe(true);
    // 1 min antes del inicio: dentro del margen de 2 min
    expect(subidaYaAplicada({ fotoActualizadaEn: '2026-10-14T12:59:00Z', inicioMs: inicio })).toBe(true);
    expect(subidaYaAplicada({ fotoActualizadaEn: '2026-10-14T12:50:00Z', inicioMs: inicio })).toBe(false);
    expect(subidaYaAplicada({ fotoActualizadaEn: 'basura', inicioMs: inicio })).toBe(false);
  });
  it('si el servidor aún devuelve la foto previa, no hubo reemplazo', () => {
    const previa = '2026-10-14T12:59:00Z';
    expect(
      subidaYaAplicada({ fotoActualizadaEn: previa, inicioMs: inicio, previaEn: previa }),
    ).toBe(false);
  });
});

describe('sesión de la foto pendiente', () => {
  it('solo se envía en la sesión que la capturó', () => {
    expect(pendientePerteneceASesion('s1', 's1')).toBe(true);
    expect(pendientePerteneceASesion('s1', 's2')).toBe(false);
    expect(pendientePerteneceASesion(null, 's1')).toBe(false);
  });
  it('reinicia el estado solo si lo dueña es otra sesión', () => {
    expect(debeReiniciarPorSesion(null, 's1')).toBe(false);
    expect(debeReiniciarPorSesion('s1', 's1')).toBe(false);
    expect(debeReiniciarPorSesion('s1', 's2')).toBe(true);
  });
});

describe('recorte cuadrado', () => {
  it('centra sobre el lado menor (horizontal y vertical)', () => {
    expect(recorteCuadradoCentrado(4000, 3000)).toEqual({ originX: 500, originY: 0, width: 3000, height: 3000 });
    expect(recorteCuadradoCentrado(3000, 4001)).toEqual({ originX: 0, originY: 500, width: 3000, height: 3000 });
    expect(recorteCuadradoCentrado(1000, 1000)).toEqual({ originX: 0, originY: 0, width: 1000, height: 1000 });
  });
  it('sin dimensiones válidas no recorta', () => {
    expect(recorteCuadradoCentrado(0, 100)).toBeNull();
    expect(recorteCuadradoCentrado(Number.NaN, 100)).toBeNull();
  });
});

describe('estadoFotoVehiculo', () => {
  it('distingue sin foto de error', () => {
    expect(estadoFotoVehiculo({ cargando: true, error: false, datos: undefined })).toBe('cargando');
    expect(estadoFotoVehiculo({ cargando: false, error: true, datos: undefined })).toBe('desconocido');
    expect(estadoFotoVehiculo({ cargando: false, error: false, datos: undefined })).toBe('desconocido');
    expect(estadoFotoVehiculo({ cargando: false, error: false, datos: null })).toBe('sin_foto');
    expect(estadoFotoVehiculo({ cargando: false, error: false, datos: { a: 1 } })).toBe('con_foto');
  });
});

describe('debeMostrarAviso', () => {
  const base = {
    estadoFoto: 'sin_foto' as EstadoFotoVehiculo,
    descartadoDia: null,
    tracking: false,
    ahora: new Date('2026-10-14T15:00:00Z'),
  };
  it('muestra sin foto antes de iniciar', () => expect(debeMostrarAviso(base)).toBe(true));
  it('oculta con foto, cargando, error de consulta o recorrido activo', () => {
    expect(debeMostrarAviso({ ...base, estadoFoto: 'con_foto' })).toBe(false);
    expect(debeMostrarAviso({ ...base, estadoFoto: 'cargando' })).toBe(false);
    expect(debeMostrarAviso({ ...base, estadoFoto: 'desconocido' })).toBe(false);
    expect(debeMostrarAviso({ ...base, tracking: true })).toBe(false);
  });
  it('descartado hoy se oculta; ayer vuelve', () => {
    expect(debeMostrarAviso({ ...base, descartadoDia: '2026-10-14' })).toBe(false);
    expect(debeMostrarAviso({ ...base, descartadoDia: '2026-10-13' })).toBe(true);
  });
});

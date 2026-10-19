import { describe, expect, it } from 'vitest';
import { debePedirRuta, respuestaRutaVigente } from './debe-pedir-ruta';

const base = { acabaDeIniciar: false, anterior: { ts: 0 }, mismoDestino: true };

describe('debePedirRuta', () => {
  it('pide si cambió el destino', () => {
    expect(debePedirRuta({ ...base, mismoDestino: false, ahoraMs: 1_000, distanciaM: 0 })).toBe(true);
  });
  it('pide si acaba de iniciar', () => {
    expect(debePedirRuta({ ...base, acabaDeIniciar: true, ahoraMs: 1_000, distanciaM: 0 })).toBe(true);
  });
  it('pide si nunca pidió', () => {
    expect(debePedirRuta({ ...base, anterior: null, ahoraMs: 1_000, distanciaM: 0 })).toBe(true);
  });
  it('no pide con 10 s y 100 m', () => {
    expect(debePedirRuta({ ...base, ahoraMs: 10_000, distanciaM: 100 })).toBe(false);
  });
  it('no pide con 20 s y 10 m', () => {
    expect(debePedirRuta({ ...base, ahoraMs: 20_000, distanciaM: 10 })).toBe(false);
  });
  it('pide con 20 s y 60 m', () => {
    expect(debePedirRuta({ ...base, ahoraMs: 20_000, distanciaM: 60 })).toBe(true);
  });
  it('reintenta con último pedido fallido, 16 s y 0 m', () => {
    expect(debePedirRuta({ ...base, anterior: { ts: 0, fallo: true }, ahoraMs: 16_000, distanciaM: 0 })).toBe(true);
  });
  it('no reintenta con último pedido fallido y 5 s', () => {
    expect(debePedirRuta({ ...base, anterior: { ts: 0, fallo: true }, ahoraMs: 5_000, distanciaM: 0 })).toBe(false);
  });
  it('no reintenta si el último respondió sin ruta (no fallo), 16 s y 0 m', () => {
    expect(debePedirRuta({ ...base, anterior: { ts: 0, fallo: false }, ahoraMs: 16_000, distanciaM: 0 })).toBe(false);
  });
});

describe('respuestaRutaVigente', () => {
  it('aplica si es el último pedido', () => {
    expect(respuestaRutaVigente({ idPedido: 3, idUltimo: 3 })).toBe(true);
  });
  it('descarta si hay un pedido más nuevo', () => {
    expect(respuestaRutaVigente({ idPedido: 2, idUltimo: 3 })).toBe(false);
  });
});

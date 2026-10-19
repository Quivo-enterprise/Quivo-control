import { describe, expect, it } from 'vitest';
import { debePedirRuta } from './debe-pedir-ruta';

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
});

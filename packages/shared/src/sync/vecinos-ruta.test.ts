import { describe, expect, it } from 'vitest';
import {
  UMBRAL_VECINO_FRESCO_MS,
  VecinoRutaSchema,
  VecinosRutaQuerySchema,
  VecinosRutaSchema,
} from './vecinos-ruta.js';

const VECINO = {
  placa: '1234ABC',
  numeroInterno: '12',
  tipo: 'minibus',
  marca: 'Toyota',
  modelo: 'Coaster',
  color: 'blanco',
  colorSecundario: null,
  distanciaM: 350.5,
  edadFixS: 42,
};

describe('UMBRAL_VECINO_FRESCO_MS', () => {
  it('son 10 minutos', () => {
    expect(UMBRAL_VECINO_FRESCO_MS).toBe(600_000);
  });
});

describe('VecinosRutaQuerySchema', () => {
  it('acepta query vacía (sin posición)', () => {
    expect(VecinosRutaQuerySchema.safeParse({}).success).toBe(true);
  });

  it('coerciona strings numéricos, incluidos negativos', () => {
    const r = VecinosRutaQuerySchema.parse({ lat: '-16.5', lng: '-68.15' });
    expect(r).toEqual({ lat: -16.5, lng: -68.15 });
  });

  it('rechaza string vacío (Number("") sería 0)', () => {
    expect(VecinosRutaQuerySchema.safeParse({ lat: '', lng: '-68' }).success).toBe(false);
    expect(VecinosRutaQuerySchema.safeParse({ lat: '-16', lng: '' }).success).toBe(false);
  });

  it('rechaza no numéricos y fuera de rango', () => {
    expect(VecinosRutaQuerySchema.safeParse({ lat: 'abc', lng: '0' }).success).toBe(false);
    expect(VecinosRutaQuerySchema.safeParse({ lat: '91', lng: '0' }).success).toBe(false);
    expect(VecinosRutaQuerySchema.safeParse({ lat: '0', lng: '181' }).success).toBe(false);
    expect(VecinosRutaQuerySchema.safeParse({ lat: 'Infinity', lng: '0' }).success).toBe(false);
  });

  it('exige lat y lng juntas o ninguna', () => {
    expect(VecinosRutaQuerySchema.safeParse({ lat: '-16.5' }).success).toBe(false);
    expect(VecinosRutaQuerySchema.safeParse({ lng: '-68.1' }).success).toBe(false);
  });
});

describe('VecinoRutaSchema', () => {
  it('acepta un vecino válido', () => {
    expect(VecinoRutaSchema.safeParse(VECINO).success).toBe(true);
  });

  it('rechaza distancia negativa y edad no entera', () => {
    expect(VecinoRutaSchema.safeParse({ ...VECINO, distanciaM: -1 }).success).toBe(false);
    expect(VecinoRutaSchema.safeParse({ ...VECINO, edadFixS: 1.5 }).success).toBe(false);
  });

  it('privacidad: descarta lat/lng y conductor si llegan', () => {
    const r = VecinoRutaSchema.parse({ ...VECINO, lat: -16, lng: -68, conductorNombre: 'X' });
    expect(r).not.toHaveProperty('lat');
    expect(r).not.toHaveProperty('lng');
    expect(r).not.toHaveProperty('conductorNombre');
  });
});

describe('VecinosRutaSchema', () => {
  it('acepta delante/detras nulos y calculadoEn ISO', () => {
    const r = VecinosRutaSchema.safeParse({
      delante: null,
      detras: VECINO,
      calculadoEn: '2026-10-10T12:00:00.000Z',
    });
    expect(r.success).toBe(true);
  });

  it('rechaza calculadoEn que no es ISO', () => {
    expect(
      VecinosRutaSchema.safeParse({ delante: null, detras: null, calculadoEn: 'ayer' }).success,
    ).toBe(false);
  });
});

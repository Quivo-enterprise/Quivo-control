import { describe, expect, it } from 'vitest';
import {
  estadoCamaraInicial,
  reducirModoCamara,
  type EstadoCamara,
  type ModoCamara,
} from './modo-camara';

const en = (modo: ModoCamara, seq = 5): EstadoCamara => ({ modo, desde: modo, accion: 'ninguna', seq });

describe('estadoCamaraInicial', () => {
  it('con tracking arranca en navegación siguiendo', () => {
    expect(estadoCamaraInicial(true)).toEqual({
      modo: 'navegacion',
      desde: 'navegacion',
      accion: 'seguir',
      seq: 0,
    });
  });
  it('sin tracking arranca en general encuadrando', () => {
    expect(estadoCamaraInicial(false)).toEqual({
      modo: 'general',
      desde: 'general',
      accion: 'encuadrar',
      seq: 0,
    });
  });
});

describe('iniciarRecorrido', () => {
  it.each<ModoCamara>(['general', 'libre'])('%s pasa a navegación y sigue (seq+1)', (modo) => {
    expect(reducirModoCamara(en(modo), { tipo: 'iniciarRecorrido' })).toEqual({
      modo: 'navegacion',
      desde: modo,
      accion: 'seguir',
      seq: 6,
    });
  });
  it('navegación devuelve la misma referencia', () => {
    const e = en('navegacion');
    expect(reducirModoCamara(e, { tipo: 'iniciarRecorrido' })).toBe(e);
  });
});

describe('finalizarRecorrido', () => {
  it.each<ModoCamara>(['general', 'navegacion', 'libre'])('%s pasa a general y encuadra (seq+1)', (modo) => {
    expect(reducirModoCamara(en(modo), { tipo: 'finalizarRecorrido' })).toEqual({
      modo: 'general',
      desde: modo,
      accion: 'encuadrar',
      seq: 6,
    });
  });
});

describe('panUsuario', () => {
  it('navegación pasa a libre sin acción y sin tocar seq', () => {
    expect(reducirModoCamara(en('navegacion'), { tipo: 'panUsuario' })).toEqual({
      modo: 'libre',
      desde: 'navegacion',
      accion: 'ninguna',
      seq: 5,
    });
  });
  it.each<ModoCamara>(['general', 'libre'])('%s devuelve la misma referencia', (modo) => {
    const e = en(modo);
    expect(reducirModoCamara(e, { tipo: 'panUsuario' })).toBe(e);
  });
});

describe('recentrar', () => {
  it.each<ModoCamara>(['libre', 'navegacion'])('%s vuelve a navegación y sigue (seq+1)', (modo) => {
    expect(reducirModoCamara(en(modo), { tipo: 'recentrar' })).toEqual({
      modo: 'navegacion',
      desde: modo,
      accion: 'seguir',
      seq: 6,
    });
  });
  it('general se queda en general y encuadra (seq+1)', () => {
    expect(reducirModoCamara(en('general'), { tipo: 'recentrar' })).toEqual({
      modo: 'general',
      desde: 'general',
      accion: 'encuadrar',
      seq: 6,
    });
  });
});

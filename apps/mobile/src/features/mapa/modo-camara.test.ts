import { describe, expect, it } from 'vitest';
import {
  estadoCamaraInicial,
  reducirModoCamara,
  type EstadoCamara,
  type ModoCamara,
  type OrientacionCamara,
} from './modo-camara';

const en = (
  modo: ModoCamara,
  seq = 5,
  orientacion: OrientacionCamara = 'rumbo',
): EstadoCamara => ({ modo, desde: modo, accion: 'ninguna', orientacion, seq });

describe('estadoCamaraInicial', () => {
  it('con tracking arranca en navegación siguiendo', () => {
    expect(estadoCamaraInicial(true)).toEqual({
      modo: 'navegacion',
      desde: 'navegacion',
      accion: 'seguir',
      orientacion: 'rumbo',
      seq: 0,
    });
  });
  it('sin tracking arranca en general encuadrando', () => {
    expect(estadoCamaraInicial(false)).toEqual({
      modo: 'general',
      desde: 'general',
      accion: 'encuadrar',
      orientacion: 'rumbo',
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
      orientacion: 'rumbo',
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
      orientacion: 'rumbo',
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
      orientacion: 'rumbo',
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
      orientacion: 'rumbo',
      seq: 6,
    });
  });
  it('general se queda en general y encuadra (seq+1)', () => {
    expect(reducirModoCamara(en('general'), { tipo: 'recentrar' })).toEqual({
      modo: 'general',
      desde: 'general',
      accion: 'encuadrar',
      orientacion: 'rumbo',
      seq: 6,
    });
  });
});

describe('alternarOrientacion', () => {
  it('en navegación alterna rumbo <-> norte, sigue al vehículo y sube seq', () => {
    const aNorte = reducirModoCamara(en('navegacion'), { tipo: 'alternarOrientacion' });
    expect(aNorte).toEqual({
      modo: 'navegacion',
      desde: 'navegacion',
      accion: 'seguir',
      orientacion: 'norte',
      seq: 6,
    });
    const deVuelta = reducirModoCamara(aNorte, { tipo: 'alternarOrientacion' });
    expect(deVuelta.orientacion).toBe('rumbo');
    expect(deVuelta.seq).toBe(7);
    expect(deVuelta.accion).toBe('seguir');
  });
  it.each<ModoCamara>(['general', 'libre'])('%s devuelve la misma referencia', (modo) => {
    const e = en(modo);
    expect(reducirModoCamara(e, { tipo: 'alternarOrientacion' })).toBe(e);
  });
});

describe('orientacion a través de las transiciones', () => {
  it('panUsuario la conserva', () => {
    expect(reducirModoCamara(en('navegacion', 5, 'norte'), { tipo: 'panUsuario' }).orientacion).toBe('norte');
  });
  it('recentrar desde libre la conserva', () => {
    const r = reducirModoCamara(en('libre', 5, 'norte'), { tipo: 'recentrar' });
    expect(r).toMatchObject({ modo: 'navegacion', accion: 'seguir', orientacion: 'norte', seq: 6 });
  });
  it('iniciarRecorrido desde libre la conserva', () => {
    expect(reducirModoCamara(en('libre', 5, 'norte'), { tipo: 'iniciarRecorrido' }).orientacion).toBe('norte');
  });
  it.each<ModoCamara>(['navegacion', 'libre'])('finalizarRecorrido desde %s la reinicia a rumbo', (modo) => {
    expect(reducirModoCamara(en(modo, 5, 'norte'), { tipo: 'finalizarRecorrido' }).orientacion).toBe('rumbo');
  });
});

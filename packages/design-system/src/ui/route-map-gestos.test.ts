import { describe, expect, it } from 'vitest';
import { esGestoUsuarioDeCamara } from './route-map-gestos.js';

describe('esGestoUsuarioDeCamara', () => {
  it('rueda y doble click son gestos de cámara', () => {
    expect(esGestoUsuarioDeCamara({ tipo: 'wheel' })).toBe(true);
    expect(esGestoUsuarioDeCamara({ tipo: 'dblclick' })).toBe(true);
  });

  it('teclas +/- y flechas sí; Enter/Tab/espacio no; con modificador no', () => {
    expect(esGestoUsuarioDeCamara({ tipo: 'keydown', tecla: '+' })).toBe(true);
    expect(esGestoUsuarioDeCamara({ tipo: 'keydown', tecla: '-' })).toBe(true);
    expect(esGestoUsuarioDeCamara({ tipo: 'keydown', tecla: 'ArrowLeft' })).toBe(true);
    expect(esGestoUsuarioDeCamara({ tipo: 'keydown', tecla: 'Enter' })).toBe(false);
    expect(esGestoUsuarioDeCamara({ tipo: 'keydown', tecla: ' ' })).toBe(false);
    expect(esGestoUsuarioDeCamara({ tipo: 'keydown', tecla: 'Tab' })).toBe(false);
    expect(esGestoUsuarioDeCamara({ tipo: 'keydown', tecla: '-', modificador: true })).toBe(false);
    expect(esGestoUsuarioDeCamara({ tipo: 'keydown' })).toBe(false);
  });

  it('pointerdown: control de zoom o pellizco sí; un toque/click simple no', () => {
    expect(esGestoUsuarioDeCamara({ tipo: 'pointerdown', enControlGoogle: true })).toBe(true);
    expect(esGestoUsuarioDeCamara({ tipo: 'pointerdown', punterosActivos: 2 })).toBe(true);
    expect(esGestoUsuarioDeCamara({ tipo: 'pointerdown', punterosActivos: 1 })).toBe(false);
    expect(esGestoUsuarioDeCamara({ tipo: 'pointerdown' })).toBe(false);
  });
});

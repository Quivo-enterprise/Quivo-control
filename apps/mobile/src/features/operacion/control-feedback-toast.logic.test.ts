import { describe, expect, it } from 'vitest';
import { debeMostrarToast, type IdentidadToastMostrado } from './control-feedback-toast.logic';
import type { DeteccionPuntoControl } from '../../gps/geofence';

function deteccion(overrides: Partial<DeteccionPuntoControl> = {}): DeteccionPuntoControl {
  return {
    puntoControlId: 'pc-1',
    distanciaM: 5,
    cumplido: true,
    radioToleranciaM: 30,
    pasada: 1,
    ...overrides,
  };
}

describe('debeMostrarToast', () => {
  it('no muestra si no hay detección', () => {
    expect(debeMostrarToast(null, null)).toBe(false);
  });

  it('no muestra si la detección no está cumplida', () => {
    expect(debeMostrarToast(null, deteccion({ cumplido: false }))).toBe(false);
  });

  it('muestra la primera confirmación (sin anterior)', () => {
    expect(debeMostrarToast(null, deteccion())).toBe(true);
  });

  it('NO vuelve a mostrar la misma identidad (mismo puntoControlId + pasada)', () => {
    const anterior: IdentidadToastMostrado = { puntoControlId: 'pc-1', pasada: 1 };
    expect(debeMostrarToast(anterior, deteccion({ puntoControlId: 'pc-1', pasada: 1 }))).toBe(false);
  });

  it('muestra una NUEVA pasada del mismo punto de control (multi-vuelta)', () => {
    const anterior: IdentidadToastMostrado = { puntoControlId: 'pc-1', pasada: 1 };
    expect(debeMostrarToast(anterior, deteccion({ puntoControlId: 'pc-1', pasada: 2 }))).toBe(true);
  });

  it('muestra un punto de control distinto aunque la pasada coincida', () => {
    const anterior: IdentidadToastMostrado = { puntoControlId: 'pc-1', pasada: 1 };
    expect(debeMostrarToast(anterior, deteccion({ puntoControlId: 'pc-2', pasada: 1 }))).toBe(true);
  });

  it('fail-open: muestra si la confirmación no trae pasada (identidad no comparable)', () => {
    const anterior: IdentidadToastMostrado = { puntoControlId: 'pc-1', pasada: 1 };
    expect(debeMostrarToast(anterior, deteccion({ pasada: undefined }))).toBe(true);
  });
});

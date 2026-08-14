import { describe, expect, it } from 'vitest';
import type { PuntoControlPaquete } from '@quivo/shared';
import {
  claveCumplimiento,
  detectarPuntosControlCercanos,
  filtrarNuevosCumplimientos,
} from './geofence';

function puntoControl(id: string, coord: [number, number], radioToleranciaM = 30): PuntoControlPaquete {
  return {
    id,
    orden: 0,
    coord: { type: 'Point', coordinates: coord },
    radioToleranciaM,
    obligatorio: true,
  };
}

describe('detectarPuntosControlCercanos', () => {
  it('marca cumplido un punto de control dentro de su radio de tolerancia', () => {
    const pc = puntoControl('pc-1', [-63.18, -17.78], 30);
    const [deteccion] = detectarPuntosControlCercanos([-63.18, -17.78], [pc]);
    expect(deteccion?.cumplido).toBe(true);
    expect(deteccion?.distanciaM).toBeCloseTo(0, 3);
  });

  it('no marca cumplido un punto de control fuera de su radio', () => {
    const pc = puntoControl('pc-1', [-63.18, -17.78], 30);
    // ~500m de distancia
    const [deteccion] = detectarPuntosControlCercanos([-63.18, -17.775], [pc]);
    expect(deteccion?.cumplido).toBe(false);
  });

  it('evalúa cada punto de control de la lista de forma independiente', () => {
    const cerca = puntoControl('pc-cerca', [-63.18, -17.78], 30);
    const lejos = puntoControl('pc-lejos', [-63.2, -17.8], 30);
    const detecciones = detectarPuntosControlCercanos([-63.18, -17.78], [cerca, lejos]);
    expect(detecciones.find((d) => d.puntoControlId === 'pc-cerca')?.cumplido).toBe(true);
    expect(detecciones.find((d) => d.puntoControlId === 'pc-lejos')?.cumplido).toBe(false);
  });
});

describe('filtrarNuevosCumplimientos', () => {
  it('devuelve solo los cumplidos que no estaban ya detectados', () => {
    const detecciones = [
      { puntoControlId: 'pc-1', distanciaM: 5, cumplido: true },
      { puntoControlId: 'pc-2', distanciaM: 500, cumplido: false },
      { puntoControlId: 'pc-3', distanciaM: 2, cumplido: true },
    ];
    const nuevos = filtrarNuevosCumplimientos(
      new Set([claveCumplimiento('sesion-1', 'pc-1')]),
      detecciones,
      'sesion-1',
    );
    expect(nuevos.map((d) => d.puntoControlId)).toEqual(['pc-3']);
  });

  it('no repite un punto de control ya detectado aunque siga cumplido', () => {
    const detecciones = [{ puntoControlId: 'pc-1', distanciaM: 5, cumplido: true }];
    const nuevos = filtrarNuevosCumplimientos(
      new Set([claveCumplimiento('sesion-1', 'pc-1')]),
      detecciones,
      'sesion-1',
    );
    expect(nuevos).toHaveLength(0);
  });

  it('NO suprime el cumplimiento de otra sesión sobre el mismo punto de control', () => {
    // Turno del día siguiente sobre la misma ruta recurrente, con el contexto JS headless
    // todavía vivo: `pc-1` ya está en el Set, pero con la clave de la sesión anterior.
    const detecciones = [{ puntoControlId: 'pc-1', distanciaM: 5, cumplido: true }];
    const nuevos = filtrarNuevosCumplimientos(
      new Set([claveCumplimiento('sesion-1', 'pc-1')]),
      detecciones,
      'sesion-2',
    );
    expect(nuevos.map((d) => d.puntoControlId)).toEqual(['pc-1']);
  });
});

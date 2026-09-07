import { describe, expect, it } from 'vitest';
import type { Ruta } from '@quivo/shared';
import {
  calcularDistanciaRutaKm,
  capitalizar,
  eliminarPuntoTrazado,
  filtrarRutas,
  formatearDistancia,
  invertirElementosOrdenados,
  invertirPuntosTrazado,
  invertirTipoParada,
  moverPuntoTrazado,
} from './route-utils';

const rutaBase: Ruta = {
  id: '00000000-0000-4000-8000-000000000001',
  lineaId: '00000000-0000-4000-8000-000000000002',
  sentido: 'ida',
  estado: 'activo',
  publicStatus: 'borrador',
  publishedAt: null,
  geometria: {
    type: 'LineString',
    coordinates: [
      [-66.157, -17.3935],
      [-66.157, -17.3845],
    ],
  },
};

describe('utilidades de rutas', () => {
  it('calcula la longitud aproximada de un trazado', () => {
    expect(calcularDistanciaRutaKm(rutaBase.geometria.coordinates)).toBeCloseTo(1, 1);
    expect(formatearDistancia(0.42)).toBe('420 m');
    expect(formatearDistancia(2.46)).toBe('2.5 km');
  });

  it('filtra por sentido y estado sin alterar el catálogo', () => {
    const vuelta: Ruta = {
      ...rutaBase,
      id: '00000000-0000-4000-8000-000000000003',
      sentido: 'vuelta',
    };
    const inactiva: Ruta = {
      ...rutaBase,
      id: '00000000-0000-4000-8000-000000000004',
      estado: 'inactivo',
    };
    const rutas = [rutaBase, vuelta, inactiva];

    expect(filtrarRutas(rutas, 'ida', 'activo')).toEqual([rutaBase]);
    expect(filtrarRutas(rutas, 'todos', 'inactivo')).toEqual([inactiva]);
    expect(rutas).toHaveLength(3);
  });

  it('presenta valores legibles', () => {
    expect(capitalizar('vuelta')).toBe('Vuelta');
    expect(capitalizar('')).toBe('');
  });

  it('edita el orden de nodos sin mutar el trazado original', () => {
    const points = ['inicio', 'centro', 'final'];

    expect(eliminarPuntoTrazado(points, 1)).toEqual(['inicio', 'final']);
    expect(moverPuntoTrazado(points, 2, 1)).toEqual(['inicio', 'final', 'centro']);
    expect(invertirPuntosTrazado(points)).toEqual(['final', 'centro', 'inicio']);
    expect(points).toEqual(['inicio', 'centro', 'final']);
  });

  it('ignora índices inválidos al editar nodos', () => {
    const points = ['inicio', 'final'];

    expect(eliminarPuntoTrazado(points, 4)).toEqual(points);
    expect(moverPuntoTrazado(points, 0, -1)).toEqual(points);
  });

  it('invierte paradas y controles conservando una secuencia válida', () => {
    const elements = [
      { nombre: 'inicio', orden: 0 },
      { nombre: 'centro', orden: 2 },
      { nombre: 'final', orden: 5 },
    ];

    expect(invertirElementosOrdenados(elements)).toEqual([
      { nombre: 'final', orden: 0 },
      { nombre: 'centro', orden: 2 },
      { nombre: 'inicio', orden: 5 },
    ]);
    expect(invertirTipoParada('origen')).toBe('destino');
    expect(invertirTipoParada('intermedia')).toBe('intermedia');
    expect(invertirTipoParada('destino')).toBe('origen');
    expect(elements[0]?.orden).toBe(0);
  });
});

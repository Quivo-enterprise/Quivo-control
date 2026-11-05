import { describe, expect, it } from 'vitest';
import type { Conductor, JornadaVehiculo, Vehiculo } from '@quivo/shared';
import { buscarHoy, normalizarBusqueda } from './hoy.logic';

const veh = (id: string, placa: string) => ({ id, placa }) as Vehiculo;
const cond = (id: string, nombre: string, telefono: string | null) => ({ id, nombre, telefono }) as Conductor;
const jor = (vehiculoId: string, conductorNombre: string | null) =>
  ({ vehiculoId, conductorNombre, lineaNombre: 'Línea 16' }) as JornadaVehiculo;

const V = [veh('v1', '4701EHA'), veh('v2', '1616PIL')];
const C = [cond('c1', 'José Bravo', '71234567'), cond('c2', 'Ana Quispe', null), cond('c3', 'Ana Quispe', '72222222')];

describe('buscarHoy', () => {
  it('normaliza tildes, espacios y guiones', () => {
    expect(normalizarBusqueda('4701-EHA ')).toBe('4701eha');
    expect(normalizarBusqueda('José')).toBe('jose');
  });
  it('exige al menos 2 caracteres', () => {
    expect(buscarHoy('4', V, C, [])).toEqual([]);
  });
  it('encuentra placa con otro formato y trae el teléfono del conductor de hoy', () => {
    const r = buscarHoy('4701 eh', V, C, [jor('v1', 'Jose Bravo')]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ tipo: 'vehiculo', titulo: '4701EHA', telefono: '71234567', detalle: 'Línea 16 · Jose Bravo' });
  });
  it('sin turno o nombre ambiguo: sin teléfono', () => {
    expect(buscarHoy('1616', V, C, [])[0]).toMatchObject({ telefono: null, detalle: 'Sin turno hoy' });
    expect(buscarHoy('4701', V, C, [jor('v1', 'Ana Quispe')])[0]?.telefono).toBeNull();
  });
  it('encuentra conductor por nombre sin tildes', () => {
    expect(buscarHoy('jose', V, C, [])).toEqual([
      { tipo: 'conductor', id: 'c1', titulo: 'José Bravo', detalle: 'Conductor', telefono: '71234567' },
    ]);
  });
});

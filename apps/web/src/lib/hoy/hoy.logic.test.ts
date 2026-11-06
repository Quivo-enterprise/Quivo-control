import { describe, expect, it } from 'vitest';
import type { Conductor, JornadaVehiculo, Vehiculo } from '@quivo/shared';
import { buscarHoy, fechaHoy, normalizarBusqueda } from './hoy.logic';

const veh = (id: string, placa: string) => ({ id, placa }) as Vehiculo;
const cond = (id: string, nombre: string, telefono: string | null) => ({ id, nombre, telefono }) as Conductor;
const jor = (vehiculoId: string, conductorId: string | null, conductorNombre: string | null) =>
  ({ vehiculoId, conductorId, conductorNombre, lineaNombre: 'Línea 16' }) as JornadaVehiculo;

const V = [veh('v1', '4701-EHA'), veh('v2', '1616PIL')];
const C = [cond('c1', 'José Bravo', '71234567'), cond('c2', 'Ana Quispe', null), cond('c3', 'Ana Quispe', '72222222')];

describe('buscarHoy', () => {
  it('normaliza tildes, espacios y guiones', () => {
    expect(normalizarBusqueda('4701-EHA ')).toBe('4701eha');
    expect(normalizarBusqueda('José')).toBe('jose');
  });
  it('exige al menos 2 caracteres', () => {
    expect(buscarHoy('4', V, C, []).resultados).toEqual([]);
  });
  it('encuentra placa con otro formato y trae el teléfono del conductor de hoy por id', () => {
    const { resultados } = buscarHoy('4701 eh', V, C, [jor('v1', 'c1', 'Jose Bravo')]);
    expect(resultados).toHaveLength(1);
    expect(resultados[0]).toMatchObject({ tipo: 'vehiculo', titulo: '4701-EHA', telefono: '71234567', detalle: 'Línea 16 · Jose Bravo' });
  });
  it('placa con punto: "4701.eha" encuentra "4701-EHA"', () => {
    expect(buscarHoy('4701.eha', V, C, []).resultados.map((r) => r.id)).toEqual(['v1']);
  });
  it('homónimos: el teléfono sale del conductorId, no del nombre', () => {
    expect(buscarHoy('4701', V, C, [jor('v1', 'c3', 'Ana Quispe')]).resultados[0]?.telefono).toBe('72222222');
    expect(buscarHoy('4701', V, C, [jor('v1', 'c2', 'Ana Quispe')]).resultados[0]?.telefono).toBeNull();
  });
  it('sin turno, sin conductor o conductor fuera de la lista: sin teléfono', () => {
    expect(buscarHoy('1616', V, C, []).resultados[0]).toMatchObject({ telefono: null, detalle: 'Sin turno hoy' });
    expect(buscarHoy('4701', V, C, [jor('v1', null, null)]).resultados[0]?.telefono).toBeNull();
    expect(buscarHoy('4701', V, C, [jor('v1', 'c9', 'Otro')]).resultados[0]?.telefono).toBeNull();
  });
  it('encuentra conductor por nombre sin tildes', () => {
    expect(buscarHoy('jose', V, C, []).resultados).toEqual([
      { tipo: 'conductor', id: 'c1', titulo: 'José Bravo', detalle: 'Conductor', telefono: '71234567' },
    ]);
  });
  it('al truncar devuelve el total, 10 de cada tipo y el otro tipo llena lo que sobra', () => {
    const vs = Array.from({ length: 30 }, (_, i) => veh(`v${i}`, `PEDRO${i}`));
    const cs = Array.from({ length: 30 }, (_, i) => cond(`c${i}`, `Pedro ${i}`, null));
    const tipos = (r: { tipo: string }[], t: string) => r.filter((x) => x.tipo === t).length;
    const a = buscarHoy('pedro', vs, cs, []);
    expect(a.total).toBe(60);
    expect(a.resultados).toHaveLength(20);
    expect(tipos(a.resultados, 'vehiculo')).toBe(10);
    const b = buscarHoy('pedro', vs, cs.slice(0, 2), []);
    expect([tipos(b.resultados, 'vehiculo'), tipos(b.resultados, 'conductor')]).toEqual([18, 2]);
    const c = buscarHoy('pedro', vs.slice(0, 3), cs, []);
    expect([tipos(c.resultados, 'vehiculo'), tipos(c.resultados, 'conductor')]).toEqual([3, 17]);
  });
});

describe('fechaHoy', () => {
  it('usa la fecha de La Paz aunque en UTC ya sea el día siguiente, sin puntos', () => {
    const r = fechaHoy(new Date('2026-11-06T02:30:00Z'));
    expect(r).toBe('Jue 5 nov');
    expect(r).not.toContain('.');
  });
});

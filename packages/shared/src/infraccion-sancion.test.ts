import { describe, expect, it } from 'vitest';
import type { Infraccion } from './entities/infraccion.js';
import {
  detalleInfraccion,
  etiquetaTipoInfraccion,
  motivoSancion,
  rangoCumplimiento,
  reglaInicialSancion,
} from './infraccion-sancion.js';

describe('detalle y etiqueta de infracción', () => {
  const base = {
    id: '1',
    estado: 'abierta',
    tipo: 'desvio_ruta',
    detalle: { distanciaMaxM: 180.4 },
    inicioTs: new Date('2026-10-13T14:00:00Z'),
    finTs: null,
  } as unknown as Infraccion;
  it('detalle de desvío y de PC omitido', () => {
    expect(detalleInfraccion(base)).toBe('a 180 m de la ruta');
    const pc = { ...base, tipo: 'pc_omitido', detalle: { puntoControlId: 'p3', orden: 7 } } as unknown as Infraccion;
    expect(detalleInfraccion(pc, ['p1', 'p2', 'p3'])).toBe('PC 3 omitido');
    expect(detalleInfraccion(pc)).toBe('PC 8 omitido');
  });
  it('detalle y etiqueta de las alertas de Molinos', () => {
    const corta = { ...base, tipo: 'espera_corta', detalle: { esperaMin: 20, requeridoMin: 30 } } as unknown as Infraccion;
    expect(detalleInfraccion(corta)).toBe('esperó 20 de 30 min en Molinos');
    expect(etiquetaTipoInfraccion('espera_corta')).toBe('Espera corta en Molinos');
    const omitido = { ...base, tipo: 'molinos_omitido', detalle: {} } as unknown as Infraccion;
    expect(detalleInfraccion(omitido)).toBe('cerró la vuelta sin pasar por Molinos');
    expect(etiquetaTipoInfraccion('molinos_omitido')).toBe('Molinos omitido');
  });
  it('motivoSancion formatea la hora en Bolivia (UTC-4), no en la del servidor', () => {
    expect(motivoSancion(base, 'ABC123')).toBe('Alteración de ruta del vehículo ABC123: a 180 m de la ruta (10:00).');
    expect(motivoSancion(base)).toBe('Alteración de ruta: a 180 m de la ruta (10:00).');
  });
});

describe('reglaInicialSancion', () => {
  const reglas = [
    { id: 'r1', tipo: 'otro' },
    { id: 'r2', tipo: 'desvio_ruta' },
  ];
  it('usa la regla de la infracción si sigue activa', () => {
    expect(reglaInicialSancion({ reglaId: 'r1', tipo: 'desvio_ruta' }, reglas)).toBe('r1');
  });
  it('si no, la regla activa de desvío; sin ninguna, undefined (no se asume la primera)', () => {
    expect(reglaInicialSancion({ reglaId: null, tipo: 'desvio_ruta' }, reglas)).toBe('r2');
    expect(reglaInicialSancion({ reglaId: 'inactiva', tipo: 'desvio_ruta' }, reglas)).toBe('r2');
    expect(reglaInicialSancion({ reglaId: null, tipo: 'desvio_ruta' }, [{ id: 'r1', tipo: 'otro' }])).toBeUndefined();
  });
  it('sin reglaId (infracción previa a la regla): la activa del mismo tipo, antes que desvío', () => {
    const con = [...reglas, { id: 'r3', tipo: 'pc_omitido' }];
    expect(reglaInicialSancion({ reglaId: null, tipo: 'pc_omitido' }, con)).toBe('r3');
    expect(reglaInicialSancion({ reglaId: 'inactiva', tipo: 'pc_omitido' }, con)).toBe('r3');
    expect(reglaInicialSancion({ reglaId: null, tipo: 'pc_omitido' }, reglas)).toBeUndefined();
  });
  it('molinos_omitido: prefiere su regla y si no hay cae a desvío_ruta', () => {
    const con = [...reglas, { id: 'r4', tipo: 'molinos_omitido' }];
    expect(reglaInicialSancion({ reglaId: null, tipo: 'molinos_omitido' }, con)).toBe('r4');
    expect(reglaInicialSancion({ reglaId: null, tipo: 'molinos_omitido' }, reglas)).toBe('r2');
  });
});

describe('rangoCumplimiento', () => {
  it('de mañana a hoy + 1 mes', () => {
    expect(rangoCumplimiento('2026-10-28')).toEqual({ min: '2026-10-29', max: '2026-11-28' });
  });
  it('recorta al fin del mes destino', () => {
    expect(rangoCumplimiento('2026-10-31').max).toBe('2026-11-30');
    expect(rangoCumplimiento('2027-01-31').max).toBe('2027-02-28');
    expect(rangoCumplimiento('2028-01-31').max).toBe('2028-02-29');
  });
  it('cruza fin de mes y de año', () => {
    expect(rangoCumplimiento('2026-10-31').min).toBe('2026-11-01');
    expect(rangoCumplimiento('2026-12-31')).toEqual({ min: '2027-01-01', max: '2027-01-31' });
    expect(rangoCumplimiento('2026-12-15').max).toBe('2027-01-15');
  });
});

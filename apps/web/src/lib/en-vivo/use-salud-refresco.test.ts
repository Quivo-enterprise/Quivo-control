import { describe, expect, it } from 'vitest';
import { saludRefresco } from './use-salud-refresco';

describe('saludRefresco', () => {
  const t0 = 1_000_000;
  it('ok hasta 3 polls sin datos nuevos; lento después', () => {
    expect(saludRefresco({ dataUpdatedAt: t0, isError: false }, t0 + 6_000, 2_000)).toEqual({ estado: 'ok', segundos: 6 });
    expect(saludRefresco({ dataUpdatedAt: t0, isError: false }, t0 + 7_000, 2_000)).toEqual({ estado: 'lento', segundos: 7 });
  });
  it('error = sin conexión, con los segundos desde el último dato', () => {
    expect(saludRefresco({ dataUpdatedAt: t0, isError: true }, t0 + 30_000)).toEqual({ estado: 'sin_conexion', segundos: 30 });
  });
  it('volver a la pestaña: el dato viejo no es lento mientras el poll se reanuda', () => {
    // Dato de hace 60 s, pero la pestaña volvió a ser visible hace 2 s.
    expect(saludRefresco({ dataUpdatedAt: t0, isError: false }, t0 + 60_000, 2_000, t0 + 58_000)).toEqual({ estado: 'ok', segundos: 2 });
  });
  it('atasco con la pestaña visible: lento aunque haya un refetch en curso', () => {
    expect(saludRefresco({ dataUpdatedAt: t0, isError: false }, t0 + 60_000, 2_000, t0 + 10_000)).toEqual({ estado: 'lento', segundos: 50 });
  });
  it('un error manda aunque la pestaña acabe de volver', () => {
    expect(saludRefresco({ dataUpdatedAt: t0, isError: true }, t0 + 60_000, 2_000, t0 + 59_000)).toEqual({ estado: 'sin_conexion', segundos: 1 });
  });
  it('sin datos todavía (carga inicial) no es una falla', () => {
    expect(saludRefresco({ dataUpdatedAt: 0, isError: false }, t0)).toEqual({ estado: 'ok', segundos: 0 });
  });
});

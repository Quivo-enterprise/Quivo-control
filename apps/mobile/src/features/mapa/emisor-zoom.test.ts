import { describe, expect, it, vi } from 'vitest';
import { crearEmisorZoom } from './emisor-zoom';

describe('crearEmisorZoom', () => {
  it('cuantiza el valor inicial', () => {
    expect(crearEmisorZoom(15.1).actual()).toBe(15);
  });
  it('notifica solo al cruzar un paso de 0.25', () => {
    const e = crearEmisorZoom(15);
    const oyente = vi.fn();
    e.suscribir(oyente);
    e.publicar(15.05);
    e.publicar(15.1);
    expect(oyente).not.toHaveBeenCalled();
    e.publicar(15.2);
    expect(oyente).toHaveBeenCalledTimes(1);
    expect(e.actual()).toBe(15.25);
  });
  it('ignora valores no finitos', () => {
    const e = crearEmisorZoom(15);
    const oyente = vi.fn();
    e.suscribir(oyente);
    e.publicar(NaN);
    e.publicar(Infinity);
    expect(oyente).not.toHaveBeenCalled();
    expect(e.actual()).toBe(15);
  });
  it('desuscribir detiene las notificaciones', () => {
    const e = crearEmisorZoom(15);
    const oyente = vi.fn();
    const baja = e.suscribir(oyente);
    baja();
    e.publicar(18);
    expect(oyente).not.toHaveBeenCalled();
  });
});

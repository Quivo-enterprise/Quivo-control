import { describe, expect, it, vi } from 'vitest';
import { crearEmisorRumbo, diferenciaRumbo, normalizarRumbo } from './rumbo-mapa';

describe('normalizarRumbo / diferenciaRumbo', () => {
  it('normaliza a [0,360)', () => {
    expect(normalizarRumbo(-10)).toBe(350);
    expect(normalizarRumbo(370)).toBe(10);
    expect(normalizarRumbo(360)).toBe(0);
  });
  it('mide la distancia circular mínima', () => {
    expect(diferenciaRumbo(359, 1)).toBe(2);
    expect(diferenciaRumbo(10, 350)).toBe(20);
    expect(diferenciaRumbo(0, 180)).toBe(180);
  });
});

describe('crearEmisorRumbo', () => {
  it('empieza en 0 y notifica cambios de 2° o más', () => {
    const e = crearEmisorRumbo();
    const oyente = vi.fn();
    e.suscribir(oyente);
    e.publicar(1);
    expect(oyente).not.toHaveBeenCalled();
    e.publicar(2);
    expect(oyente).toHaveBeenCalledWith(2);
    expect(e.actual()).toBe(2);
  });
  it('compara contra el último NOTIFICADO, no contra el último publicado', () => {
    const e = crearEmisorRumbo();
    const oyente = vi.fn();
    e.suscribir(oyente);
    e.publicar(1.5);
    e.publicar(1.9);
    expect(oyente).not.toHaveBeenCalled();
    e.publicar(2.5);
    expect(oyente).toHaveBeenCalledTimes(1);
  });
  it('cruza el norte sin saltos falsos', () => {
    const e = crearEmisorRumbo();
    const oyente = vi.fn();
    e.publicar(359, true);
    e.suscribir(oyente);
    e.publicar(1);
    expect(oyente).toHaveBeenCalledWith(1);
    e.publicar(0.5);
    expect(oyente).toHaveBeenCalledTimes(1);
  });
  it('forzar notifica aunque el cambio sea chico, pero no si es idéntico', () => {
    const e = crearEmisorRumbo();
    const oyente = vi.fn();
    e.publicar(1.5);
    e.publicar(5);
    e.suscribir(oyente);
    e.publicar(5, true);
    expect(oyente).not.toHaveBeenCalled();
    e.publicar(0, true);
    expect(oyente).toHaveBeenCalledWith(0);
  });
  it('ignora valores no finitos y desuscribe', () => {
    const e = crearEmisorRumbo();
    const oyente = vi.fn();
    const baja = e.suscribir(oyente);
    e.publicar(Number.NaN);
    expect(oyente).not.toHaveBeenCalled();
    baja();
    e.publicar(90);
    expect(oyente).not.toHaveBeenCalled();
    expect(e.actual()).toBe(90);
  });
});

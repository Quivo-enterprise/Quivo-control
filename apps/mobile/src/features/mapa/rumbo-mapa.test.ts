import { describe, expect, it, vi } from 'vitest';
import { crearEmisorRumbo } from './rumbo-mapa';

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

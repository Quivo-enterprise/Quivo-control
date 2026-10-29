import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTO_RECENTRAR_MS, crearGestorToque, crearTemporizadorReiniciable } from './use-modo-camara';

describe('crearTemporizadorReiniciable', () => {
  afterEach(() => vi.useRealTimers());

  it('dispara a los 5 s y cada armado reinicia la cuenta desde el último toque', () => {
    vi.useFakeTimers();
    const accion = vi.fn();
    const t = crearTemporizadorReiniciable(AUTO_RECENTRAR_MS, accion);
    t.armar();
    vi.advanceTimersByTime(4_000);
    t.armar();
    vi.advanceTimersByTime(4_000);
    expect(accion).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it('cancelar evita el disparo', () => {
    vi.useFakeTimers();
    const accion = vi.fn();
    const t = crearTemporizadorReiniciable(AUTO_RECENTRAR_MS, accion);
    t.armar();
    t.cancelar();
    vi.advanceTimersByTime(AUTO_RECENTRAR_MS * 2);
    expect(accion).not.toHaveBeenCalled();
  });
});

describe('crearGestorToque', () => {
  afterEach(() => vi.useRealTimers());

  it('con el dedo apoyado no dispara; al soltar arma 5 s', () => {
    vi.useFakeTimers();
    const accion = vi.fn();
    const t = crearTemporizadorReiniciable(AUTO_RECENTRAR_MS, accion);
    const g = crearGestorToque(t, () => true);
    g.onToque(true);
    expect(g.puedeArmar()).toBe(false);
    vi.advanceTimersByTime(AUTO_RECENTRAR_MS * 3);
    expect(accion).not.toHaveBeenCalled();
    g.onToque(false);
    expect(g.puedeArmar()).toBe(true);
    vi.advanceTimersByTime(AUTO_RECENTRAR_MS - 1);
    expect(accion).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it('apoyar cancela el temporizador ya armado; fuera de libre soltar no arma', () => {
    vi.useFakeTimers();
    const accion = vi.fn();
    const t = crearTemporizadorReiniciable(AUTO_RECENTRAR_MS, accion);
    let libre = true;
    const g = crearGestorToque(t, () => libre);
    t.armar();
    g.onToque(true);
    libre = false;
    g.onToque(false);
    vi.advanceTimersByTime(AUTO_RECENTRAR_MS * 2);
    expect(accion).not.toHaveBeenCalled();
  });
});

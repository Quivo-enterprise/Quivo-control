import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  alimentarEstadoVisual,
  configurarObsolescencia,
  obtenerEstadoVisual,
  reiniciarEstadoVisual,
  reiniciarEstadoVisualParaTests,
  suscribirseEstadoVisual,
} from './store-visual';
import type { FixVisual } from './tipos';

function fix(parcial: Partial<FixVisual> & Pick<FixVisual, 'lat' | 'lng' | 'ts'>): FixVisual {
  return {
    speed: -1,
    heading: -1,
    accuracy: 5,
    ...parcial,
  };
}

beforeEach(() => {
  reiniciarEstadoVisualParaTests();
});

afterEach(() => {
  reiniciarEstadoVisualParaTests();
  vi.useRealTimers();
});

describe('alimentarEstadoVisual / obtenerEstadoVisual', () => {
  it('empieza en null: ningún fix llegó todavía', () => {
    expect(obtenerEstadoVisual()).toBeNull();
  });

  it('publica el snapshot tras el primer fix', () => {
    alimentarEstadoVisual(fix({ lat: -17.38, lng: -66.15, ts: Date.now(), accuracy: 8 }));
    const snapshot = obtenerEstadoVisual();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.lat).toBe(-17.38);
    expect(snapshot?.lng).toBe(-66.15);
    expect(snapshot?.obsoleto).toBe(false);
  });

  it('notifica a los suscriptores cuando un fix cambia el estado', () => {
    const listener = vi.fn();
    const unsub = suscribirseEstadoVisual(listener);
    alimentarEstadoVisual(fix({ lat: 0, lng: 0, ts: 1000 }));
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('NO notifica cuando un fix idéntico al anterior no cambia nada', () => {
    const fixInicial = fix({ lat: 0, lng: 0, ts: 0, accuracy: 10 });
    alimentarEstadoVisual(fixInicial);
    const listener = vi.fn();
    const unsub = suscribirseEstadoVisual(listener);
    // Mismo fix exacto: el reducer llega al mismo lat/lng/rumbo/accuracy/speed/ts de antes.
    alimentarEstadoVisual({ ...fixInicial });
    expect(listener).not.toHaveBeenCalled();
    unsub();
  });

  it('mantiene la misma referencia de snapshot cuando no hay notificación (getSnapshot estable)', () => {
    const fixInicial = fix({ lat: 0, lng: 0, ts: 0, accuracy: 10 });
    alimentarEstadoVisual(fixInicial);
    const primero = obtenerEstadoVisual();
    alimentarEstadoVisual({ ...fixInicial });
    expect(obtenerEstadoVisual()).toBe(primero);
  });
});

describe('obsoleto — deshabilitado por default (hallazgo de revisión, MEDIO)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('sin llamar a configurarObsolescencia(true), nunca marca obsoleto aunque pase el umbral', () => {
    const ahora = Date.now();
    const listener = vi.fn();
    const unsub = suscribirseEstadoVisual(listener);
    alimentarEstadoVisual(fix({ lat: 0, lng: 0, ts: ahora }));
    expect(obtenerEstadoVisual()?.obsoleto).toBe(false);

    // Mismo avance que el test de abajo (con la obsolescencia habilitada) — sin habilitarla,
    // "sin fix hace 15s" es el caso normal de un vehículo detenido (evidencia por distancia/
    // heartbeat), no una señal perdida (ver el docblock de `obsolescenciaHabilitada`).
    vi.advanceTimersByTime(18_000);
    expect(obtenerEstadoVisual()?.obsoleto).toBe(false);
    unsub();
  });

  it('el temporizador nunca arranca sin habilitar la obsolescencia, aunque haya suscriptores', () => {
    const ahora = Date.now();
    const listener = vi.fn();
    const unsub = suscribirseEstadoVisual(listener);
    alimentarEstadoVisual(fix({ lat: 0, lng: 0, ts: ahora }));
    listener.mockClear();
    vi.advanceTimersByTime(30_000);
    expect(listener).not.toHaveBeenCalled();
    unsub();
  });
});

describe('configurarObsolescencia — reevaluación por temporizador', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('marca obsoleto sin necesidad de un fix nuevo, pasados 15s sin suscriptores no reevalúa', () => {
    configurarObsolescencia(true);
    const ahora = Date.now();
    alimentarEstadoVisual(fix({ lat: 0, lng: 0, ts: ahora }));
    // Sin ningún suscriptor: el temporizador nunca arrancó.
    vi.advanceTimersByTime(20_000);
    expect(obtenerEstadoVisual()?.obsoleto).toBe(false);
  });

  it('con un suscriptor activo y la obsolescencia habilitada, pasa a obsoleto solo (sin fix nuevo) tras el umbral', () => {
    configurarObsolescencia(true);
    const ahora = Date.now();
    const listener = vi.fn();
    const unsub = suscribirseEstadoVisual(listener);
    alimentarEstadoVisual(fix({ lat: 0, lng: 0, ts: ahora }));
    expect(obtenerEstadoVisual()?.obsoleto).toBe(false);

    // El temporizador reevalúa cada 3s (`INTERVALO_CHEQUEO_OBSOLETO_MS`): se avanza más allá del
    // umbral de 15s Y de un tick completo después de superarlo, para no depender de que el
    // umbral y la cadencia del temporizador coincidan exacto.
    vi.advanceTimersByTime(18_000);
    expect(obtenerEstadoVisual()?.obsoleto).toBe(true);
    unsub();
  });

  it('configurarObsolescencia(false) vuelve el snapshot a obsoleto:false de inmediato y detiene el temporizador', () => {
    configurarObsolescencia(true);
    const ahora = Date.now();
    const listener = vi.fn();
    const unsub = suscribirseEstadoVisual(listener);
    alimentarEstadoVisual(fix({ lat: 0, lng: 0, ts: ahora }));
    vi.advanceTimersByTime(18_000);
    expect(obtenerEstadoVisual()?.obsoleto).toBe(true);

    configurarObsolescencia(false);
    expect(obtenerEstadoVisual()?.obsoleto).toBe(false);

    // Con el temporizador detenido, seguir avanzando el tiempo no debe reactivar `obsoleto`.
    listener.mockClear();
    vi.advanceTimersByTime(30_000);
    expect(obtenerEstadoVisual()?.obsoleto).toBe(false);
    unsub();
  });

  it('configurarObsolescencia(true) reevalúa de inmediato si el umbral ya pasó mientras estaba deshabilitada', () => {
    const ahora = Date.now();
    alimentarEstadoVisual(fix({ lat: 0, lng: 0, ts: ahora }));
    vi.advanceTimersByTime(20_000);
    expect(obtenerEstadoVisual()?.obsoleto).toBe(false); // deshabilitada: no reevaluó

    configurarObsolescencia(true);
    expect(obtenerEstadoVisual()?.obsoleto).toBe(true); // reevalúa apenas se habilita
  });

  it('es no-op llamar con el mismo valor (no reinicia el temporizador innecesariamente)', () => {
    configurarObsolescencia(false);
    configurarObsolescencia(false);
    expect(obtenerEstadoVisual()).toBeNull();
  });
});

describe('reiniciarEstadoVisual (hallazgo de revisión, ALTO — "store visual nunca se reinicia")', () => {
  it('vuelve el snapshot a null y notifica a los suscriptores', () => {
    alimentarEstadoVisual(fix({ lat: -17.38, lng: -66.15, ts: Date.now() }));
    expect(obtenerEstadoVisual()).not.toBeNull();

    const listener = vi.fn();
    const unsub = suscribirseEstadoVisual(listener);
    reiniciarEstadoVisual();

    expect(obtenerEstadoVisual()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('a diferencia de reiniciarEstadoVisualParaTests, NO limpia los listeners existentes', () => {
    alimentarEstadoVisual(fix({ lat: 0, lng: 0, ts: Date.now() }));
    const listener = vi.fn();
    const unsub = suscribirseEstadoVisual(listener);
    reiniciarEstadoVisual();
    listener.mockClear();

    // El suscriptor sigue activo: un fix nuevo después del reinicio debe seguir notificando.
    alimentarEstadoVisual(fix({ lat: 1, lng: 1, ts: Date.now() }));
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('es seguro llamarlo sin ningún fix cargado (no-op sobre el snapshot, sin listeners que fallen)', () => {
    expect(() => reiniciarEstadoVisual()).not.toThrow();
    expect(obtenerEstadoVisual()).toBeNull();
  });
});

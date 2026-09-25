import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEBOUNCE_RECONEXION_MS, crearDetectorReconexion, esOnline } from './reconexion-detector';

describe('esOnline', () => {
  it('true cuando isConnected=true e isInternetReachable=true', () => {
    expect(esOnline(true, true)).toBe(true);
  });

  it('true cuando isConnected=true e isInternetReachable todavía no resolvió (null) — no queda pegado en offline', () => {
    expect(esOnline(true, null)).toBe(true);
  });

  it('false cuando isConnected=false, sea cual sea isInternetReachable', () => {
    expect(esOnline(false, true)).toBe(false);
    expect(esOnline(false, null)).toBe(false);
    expect(esOnline(false, false)).toBe(false);
  });

  it('false cuando isConnected=true pero isInternetReachable=false (Wi-Fi sin salida a internet)', () => {
    expect(esOnline(true, false)).toBe(false);
  });

  it('false cuando isConnected todavía no resolvió (null)', () => {
    expect(esOnline(null, true)).toBe(false);
  });
});

describe('crearDetectorReconexion', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('la transición offline→online dispara onReconectado una sola vez, pasado el debounce', () => {
    const onReconectado = vi.fn();
    const detector = crearDetectorReconexion({ debounceMs: DEBOUNCE_RECONEXION_MS, onReconectado });

    detector.notificar(false); // offline
    detector.notificar(true); // vuelve la red
    expect(onReconectado).not.toHaveBeenCalled(); // todavía no pasó el debounce

    vi.advanceTimersByTime(DEBOUNCE_RECONEXION_MS);
    expect(onReconectado).toHaveBeenCalledTimes(1);

    // Notificaciones 'online' repetidas después de ya haber disparado no vuelven a disparar —
    // ya no "estábamos offline", es simplemente el estado estable.
    detector.notificar(true);
    detector.notificar(true);
    vi.advanceTimersByTime(DEBOUNCE_RECONEXION_MS * 3);
    expect(onReconectado).toHaveBeenCalledTimes(1);
  });

  it('online→online (sin haber estado offline antes) nunca dispara', () => {
    const onReconectado = vi.fn();
    const detector = crearDetectorReconexion({ debounceMs: DEBOUNCE_RECONEXION_MS, onReconectado });

    // El detector arranca asumiendo que no viene de un offline conocido — el mapa ya se montó
    // online, no hay ningún tile abandonado que reintentar por esto.
    detector.notificar(true);
    detector.notificar(true);
    detector.notificar(true);
    vi.advanceTimersByTime(DEBOUNCE_RECONEXION_MS * 3);
    expect(onReconectado).not.toHaveBeenCalled();
  });

  it('debounce: una red que aletea (offline→online→offline dentro de la ventana) no dispara', () => {
    const onReconectado = vi.fn();
    const detector = crearDetectorReconexion({ debounceMs: DEBOUNCE_RECONEXION_MS, onReconectado });

    detector.notificar(false);
    detector.notificar(true);
    vi.advanceTimersByTime(DEBOUNCE_RECONEXION_MS / 2);
    detector.notificar(false); // se cae de nuevo antes de confirmarse — cancela el disparo pendiente
    vi.advanceTimersByTime(DEBOUNCE_RECONEXION_MS * 3);
    expect(onReconectado).not.toHaveBeenCalled();

    // Y si ahora sí vuelve y se queda, dispara una sola vez desde ese punto.
    detector.notificar(true);
    vi.advanceTimersByTime(DEBOUNCE_RECONEXION_MS);
    expect(onReconectado).toHaveBeenCalledTimes(1);
  });

  it('varias notificaciones online seguidas mientras el debounce corre no reinician un disparo por cada una (un solo timer)', () => {
    const onReconectado = vi.fn();
    const detector = crearDetectorReconexion({ debounceMs: DEBOUNCE_RECONEXION_MS, onReconectado });

    detector.notificar(false);
    detector.notificar(true);
    vi.advanceTimersByTime(DEBOUNCE_RECONEXION_MS - 1);
    detector.notificar(true); // reinicia la espera del debounce, no agrega un segundo timer
    vi.advanceTimersByTime(1);
    expect(onReconectado).not.toHaveBeenCalled(); // el reinicio corrió el reloj hacia atrás

    vi.advanceTimersByTime(DEBOUNCE_RECONEXION_MS - 1);
    expect(onReconectado).toHaveBeenCalledTimes(1);
  });

  it('destruir cancela un disparo pendiente (equivalente a desmontar el componente antes de que venza el debounce)', () => {
    const onReconectado = vi.fn();
    const detector = crearDetectorReconexion({ debounceMs: DEBOUNCE_RECONEXION_MS, onReconectado });

    detector.notificar(false);
    detector.notificar(true);
    detector.destruir();
    vi.advanceTimersByTime(DEBOUNCE_RECONEXION_MS * 3);
    expect(onReconectado).not.toHaveBeenCalled();
  });
});

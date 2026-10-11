import { describe, expect, it, vi } from 'vitest';
import { crearControladorCanalVisual, type SuscripcionWatch } from './canal-visual-controller';

/** Promesa resuelta/rechazada a mano, para controlar el orden de los eventos. */
function diferida<T>() {
  let resolver!: (v: T) => void;
  let rechazar!: (e: unknown) => void;
  const promesa = new Promise<T>((res, rej) => {
    resolver = res;
    rechazar = rej;
  });
  return { promesa, resolver, rechazar };
}
const vaciarMicrotareas = () => new Promise((r) => setTimeout(r, 0));

describe('crearControladorCanalVisual', () => {
  it('runtime real (Promise): start -> resolve -> detener => remove una vez, sin lanzar', async () => {
    const remove = vi.fn();
    const abrirWatch = vi.fn(() => Promise.resolve({ remove } as SuscripcionWatch));
    const c = crearControladorCanalVisual({ abrirWatch, reportarError: vi.fn() });
    c.iniciar();
    await vaciarMicrotareas();
    expect(() => c.detener()).not.toThrow();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(c.detener()).toBe(false); // idempotente
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('detener ANTES de resolver: al resolver se hace remove y no se guarda; un start posterior abre otro watch', async () => {
    const d1 = diferida<SuscripcionWatch>();
    const remove1 = vi.fn();
    const remove2 = vi.fn();
    const abrirWatch = vi
      .fn<() => Promise<SuscripcionWatch>>()
      .mockReturnValueOnce(d1.promesa)
      .mockResolvedValueOnce({ remove: remove2 });
    const c = crearControladorCanalVisual({ abrirWatch, reportarError: vi.fn() });
    c.iniciar();
    c.detener();
    d1.resolver({ remove: remove1 });
    await vaciarMicrotareas();
    expect(remove1).toHaveBeenCalledTimes(1);
    expect(c.estaActivoOPendiente()).toBe(false);
    c.iniciar();
    await vaciarMicrotareas();
    expect(abrirWatch).toHaveBeenCalledTimes(2);
    expect(c.estaActivoOPendiente()).toBe(true);
    c.detener();
    expect(remove2).toHaveBeenCalledTimes(1);
  });

  it('start repetido mientras está pendiente o activo => una sola llamada a watchPosition', async () => {
    const d = diferida<SuscripcionWatch>();
    const abrirWatch = vi.fn(() => d.promesa);
    const c = crearControladorCanalVisual({ abrirWatch, reportarError: vi.fn() });
    c.iniciar();
    c.iniciar();
    c.iniciar();
    expect(abrirWatch).toHaveBeenCalledTimes(1);
    d.resolver({ remove: vi.fn() });
    await vaciarMicrotareas();
    c.iniciar();
    expect(abrirWatch).toHaveBeenCalledTimes(1);
  });

  it('rechazo de la promesa: no lanza, reporta, limpia el estado y un start posterior funciona', async () => {
    const reportarError = vi.fn();
    const remove = vi.fn();
    const abrirWatch = vi
      .fn<() => Promise<SuscripcionWatch>>()
      .mockRejectedValueOnce(new Error('native fail'))
      .mockResolvedValueOnce({ remove });
    const c = crearControladorCanalVisual({ abrirWatch, reportarError });
    c.iniciar();
    await vaciarMicrotareas();
    expect(reportarError).toHaveBeenCalledWith(expect.any(Error), 'canal-visual-iniciar');
    expect(c.estaActivoOPendiente()).toBe(false);
    expect(() => c.detener()).not.toThrow();
    c.iniciar();
    await vaciarMicrotareas();
    expect(abrirWatch).toHaveBeenCalledTimes(2);
    c.detener();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('throw síncrono de watchPosition se reporta igual que un rechazo', async () => {
    const reportarError = vi.fn();
    const c = crearControladorCanalVisual({
      abrirWatch: () => {
        throw new Error('sync boom');
      },
      reportarError,
    });
    expect(() => c.iniciar()).not.toThrow();
    await vaciarMicrotareas();
    expect(reportarError).toHaveBeenCalledWith(expect.any(Error), 'canal-visual-iniciar');
    expect(c.estaActivoOPendiente()).toBe(false);
  });

  it('compat: un mock que devuelve la Subscription de forma síncrona sigue funcionando', async () => {
    const remove = vi.fn();
    const c = crearControladorCanalVisual({
      abrirWatch: () => ({ remove }),
      reportarError: vi.fn(),
    });
    c.iniciar();
    await vaciarMicrotareas();
    c.detener();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('detener nunca lanza: remove que lanza o valor sin remove() se reporta', async () => {
    const reportarError = vi.fn();
    const c = crearControladorCanalVisual({
      abrirWatch: () =>
        Promise.resolve({
          remove: () => {
            throw new Error('remove boom');
          },
        }),
      reportarError,
    });
    c.iniciar();
    await vaciarMicrotareas();
    expect(() => c.detener()).not.toThrow();
    expect(reportarError).toHaveBeenCalledWith(expect.any(Error), 'canal-visual-detener');

    const c2 = crearControladorCanalVisual({
      abrirWatch: () => Promise.resolve({} as unknown as SuscripcionWatch),
      reportarError,
    });
    c2.iniciar();
    await vaciarMicrotareas();
    expect(() => c2.detener()).not.toThrow();
    expect(c2.estaActivoOPendiente()).toBe(false);
  });

  it('esVigente: un fix de una generación vieja (detener mientras pendiente) se descarta', async () => {
    const d = diferida<SuscripcionWatch>();
    let generacionAbierta = -1;
    const c = crearControladorCanalVisual({
      abrirWatch: (g) => {
        generacionAbierta = g;
        return d.promesa;
      },
      reportarError: vi.fn(),
    });
    c.iniciar();
    expect(c.esVigente(generacionAbierta)).toBe(true); // pendiente = vigente
    c.detener();
    expect(c.esVigente(generacionAbierta)).toBe(false);
    d.resolver({ remove: vi.fn() });
    await vaciarMicrotareas();
    expect(c.esVigente(generacionAbierta)).toBe(false);
  });

  it('flicker detener->iniciar con la 1a promesa pendiente: solo la generación actual es vigente y la 1a sub se remueve al resolver', async () => {
    const d1 = diferida<SuscripcionWatch>();
    const d2 = diferida<SuscripcionWatch>();
    const remove1 = vi.fn();
    const remove2 = vi.fn();
    const generaciones: number[] = [];
    const promesas = [d1.promesa, d2.promesa];
    const c = crearControladorCanalVisual({
      abrirWatch: (g) => {
        generaciones.push(g);
        return promesas[generaciones.length - 1]!;
      },
      reportarError: vi.fn(),
    });
    c.iniciar();
    c.detener();
    c.iniciar();
    const [g1, g2] = generaciones as [number, number];
    // Simula el listener GLOBAL: cada fix llega a ambos callbacks, solo el vigente cuenta.
    const entregados: number[] = [];
    const fix = () => [g1, g2].forEach((g) => c.esVigente(g) && entregados.push(g));
    fix();
    expect(entregados).toEqual([g2]);
    d1.resolver({ remove: remove1 });
    d2.resolver({ remove: remove2 });
    await vaciarMicrotareas();
    expect(remove1).toHaveBeenCalledTimes(1);
    expect(remove2).not.toHaveBeenCalled();
    fix();
    expect(entregados).toEqual([g2, g2]);
  });

  it('onFallo: solo se llama para la generación vigente, no para una vieja', async () => {
    const d1 = diferida<SuscripcionWatch>();
    const d2 = diferida<SuscripcionWatch>();
    const onFallo = vi.fn();
    const reportarError = vi.fn();
    const promesas = [d1.promesa, d2.promesa];
    let n = 0;
    const c = crearControladorCanalVisual({
      abrirWatch: () => promesas[n++]!,
      onFallo,
      reportarError,
    });
    c.iniciar();
    c.detener();
    c.iniciar();
    d1.rechazar(new Error('vieja'));
    await vaciarMicrotareas();
    expect(onFallo).not.toHaveBeenCalled();
    expect(reportarError).toHaveBeenCalledTimes(1); // igual se reporta
    d2.rechazar(new Error('vigente'));
    await vaciarMicrotareas();
    expect(onFallo).toHaveBeenCalledTimes(1);
    expect(c.estaActivoOPendiente()).toBe(false);
  });

  it('onAbierto: solo al resolver la generación vigente (no una vieja, no antes de resolver)', async () => {
    const d1 = diferida<SuscripcionWatch>();
    const d2 = diferida<SuscripcionWatch>();
    const onAbierto = vi.fn();
    const promesas = [d1.promesa, d2.promesa];
    let n = 0;
    const c = crearControladorCanalVisual({
      abrirWatch: () => promesas[n++]!,
      onAbierto,
      reportarError: vi.fn(),
    });
    c.iniciar();
    expect(onAbierto).not.toHaveBeenCalled();
    c.detener();
    c.iniciar();
    d1.resolver({ remove: vi.fn() });
    await vaciarMicrotareas();
    expect(onAbierto).not.toHaveBeenCalled();
    d2.resolver({ remove: vi.fn() });
    await vaciarMicrotareas();
    expect(onAbierto).toHaveBeenCalledTimes(1);
  });
});

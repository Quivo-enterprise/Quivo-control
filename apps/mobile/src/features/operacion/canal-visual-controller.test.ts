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
});

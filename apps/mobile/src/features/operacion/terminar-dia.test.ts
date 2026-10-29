import { describe, expect, it, vi } from 'vitest';
import { terminarDia } from './terminar-dia';

function armar(pendientes: () => number, extra: { necesitaDetener?: boolean; detener?: boolean; sesionMuerta?: boolean } = {}) {
  let t = 0;
  const deps = {
    necesitaDetener: extra.necesitaDetener ?? true,
    sesionMuerta: extra.sesionMuerta ?? false,
    detener: vi.fn(async () => extra.detener ?? true),
    drenar: vi.fn(async (): Promise<{ enviados: number; leidos: number } | null> => ({ enviados: 1, leidos: 1 })),
    contarPendientes: vi.fn(async () => pendientes()),
    logout: vi.fn(async () => undefined),
    ahora: () => t,
    esperar: async (ms: number) => {
      t += ms;
    },
  };
  return deps;
}

describe('terminarDia', () => {
  it('con pendientes en 0 hace logout', async () => {
    const d = armar(() => 0);
    expect(await terminarDia(d)).toEqual({ ok: true });
    expect(d.detener).toHaveBeenCalledOnce();
    expect(d.logout).toHaveBeenCalledOnce();
  });

  it('si los pendientes no bajan antes del tope no hace logout', async () => {
    const d = armar(() => 3);
    expect(await terminarDia(d)).toEqual({ ok: false, motivo: 'sin_conexion' });
    expect(d.logout).not.toHaveBeenCalled();
  });

  it('con pendientes, leidos > 0 y enviados 0 (el servidor los rechaza) hace logout', async () => {
    const d = armar(() => 3);
    d.drenar.mockResolvedValue({ enviados: 0, leidos: 3 });
    expect(await terminarDia(d)).toEqual({ ok: true });
    expect(d.logout).toHaveBeenCalledOnce();
  });

  it('con pendientes y nada leído (filas en vuelo de otro) no hace logout', async () => {
    const d = armar(() => 3);
    d.drenar.mockResolvedValue({ enviados: 0, leidos: 0 });
    expect(await terminarDia(d)).toEqual({ ok: false, motivo: 'sin_conexion' });
    expect(d.logout).not.toHaveBeenCalled();
  });

  it('con sesión muerta detiene, no drena y hace logout', async () => {
    const d = armar(() => 3, { sesionMuerta: true });
    expect(await terminarDia(d)).toEqual({ ok: true });
    expect(d.detener).toHaveBeenCalledOnce();
    expect(d.drenar).not.toHaveBeenCalled();
    expect(d.logout).toHaveBeenCalledOnce();
  });

  it('si drenar devuelve null siempre (lease ocupado) no hace logout', async () => {
    const d = armar(() => 0);
    d.drenar.mockResolvedValue(null);
    expect(await terminarDia(d)).toEqual({ ok: false, motivo: 'sin_conexion' });
    expect(d.logout).not.toHaveBeenCalled();
  });

  it('una ronda con enviados > 0 y pendientes sigue; la siguiente con enviados 0 hace logout', async () => {
    const d = armar(() => 3);
    d.drenar.mockResolvedValueOnce({ enviados: 500, leidos: 500 }).mockResolvedValueOnce({ enviados: 0, leidos: 2 });
    expect(await terminarDia(d)).toEqual({ ok: true });
    expect(d.drenar).toHaveBeenCalledTimes(2);
    expect(d.logout).toHaveBeenCalledOnce();
  });

  it('un error de red al drenar cuenta como intento fallido', async () => {
    const d = armar(() => 0);
    d.drenar.mockRejectedValueOnce(new Error('red'));
    expect(await terminarDia(d)).toEqual({ ok: true });
    expect(d.drenar).toHaveBeenCalledTimes(2);
  });

  it('si detener falla no drena ni hace logout', async () => {
    const d = armar(() => 0, { detener: false });
    expect(await terminarDia(d)).toEqual({ ok: false, motivo: 'detener' });
    expect(d.drenar).not.toHaveBeenCalled();
    expect(d.logout).not.toHaveBeenCalled();
  });

  it('sin necesitaDetener no llama detener, drena y hace logout', async () => {
    const d = armar(() => 0, { necesitaDetener: false });
    expect(await terminarDia(d)).toEqual({ ok: true });
    expect(d.detener).not.toHaveBeenCalled();
    expect(d.drenar).toHaveBeenCalledOnce();
    expect(d.logout).toHaveBeenCalledOnce();
  });
});

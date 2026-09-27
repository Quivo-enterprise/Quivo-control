import { describe, expect, it, vi } from 'vitest';

// FIX POST-REVISIÓN (hallazgo de revisión — "AsyncStorage sin try/catch" en `autenticarSesion`/
// `logout`): `persistirSesionDemo`/`borrarSesionDemo` (extraídas de `useAuthMovilDemo` para poder
// testearlas sin un renderer de React, que no está instalado en este paquete) son las únicas
// funciones que tocan `AsyncStorage` en este archivo — se mockea el módulo entero para simular un
// fallo de storage sin tocar disco real.
const setItemMock = vi.fn();
const removeItemMock = vi.fn();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    setItem: (...args: unknown[]) => setItemMock(...args),
    removeItem: (...args: unknown[]) => removeItemMock(...args),
    getItem: vi.fn(),
  },
}));

const { persistirSesionDemo, borrarSesionDemo } = await import('./use-auth-movil-demo');

describe('persistirSesionDemo', () => {
  it('resuelve ok cuando AsyncStorage.setItem funciona', async () => {
    setItemMock.mockResolvedValueOnce(undefined);
    const resultado = await persistirSesionDemo({ placaNormalizada: '4521BQP', pin: '111111' });
    expect(resultado).toEqual({ ok: true });
  });

  it('resuelve un error legible (sin lanzar) cuando AsyncStorage.setItem falla', async () => {
    setItemMock.mockRejectedValueOnce(new Error('disco lleno'));
    const resultado = await persistirSesionDemo({ placaNormalizada: '4521BQP', pin: '111111' });
    expect(resultado.ok).toBe(false);
    expect(resultado).toMatchObject({ ok: false, error: expect.any(String) });
    if (!resultado.ok) expect(resultado.error.length).toBeGreaterThan(0);
  });
});

describe('borrarSesionDemo', () => {
  it('resuelve ok cuando AsyncStorage.removeItem funciona', async () => {
    removeItemMock.mockResolvedValueOnce(undefined);
    const resultado = await borrarSesionDemo();
    expect(resultado).toEqual({ ok: true });
  });

  it('resuelve un error legible (sin lanzar) cuando AsyncStorage.removeItem falla', async () => {
    removeItemMock.mockRejectedValueOnce(new Error('permiso revocado'));
    const resultado = await borrarSesionDemo();
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error.length).toBeGreaterThan(0);
  });
});

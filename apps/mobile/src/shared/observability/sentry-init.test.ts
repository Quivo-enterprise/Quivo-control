import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `./sentry.ts` importa `@sentry/react-native`/`expo-application`/`expo-constants` — se mockea
 * ENTERO para no arrastrar esos paquetes nativos a un test de Node, y para poder espiar si
 * `initSentry()` se llegó a llamar sin necesidad de un DSN real.
 */
const initSentryMock = vi.fn();
vi.mock('./sentry', () => ({ initSentry: initSentryMock }));

// FIX POST-REVISIÓN (hallazgo de revisión): `sentry-init.ts` dispara `initSentry()` como efecto
// de lado AL IMPORTAR el módulo (ver su docblock) — cada test importa el módulo DESPUÉS de fijar
// `EXPO_PUBLIC_MOCK_DEMO` y con `vi.resetModules()` para forzar una evaluación fresca de
// `MODO_DEMO` (`../../demo/flag.ts`, que lee `process.env` una sola vez al cargar el módulo).
describe('sentry-init', () => {
  const envOriginal = process.env.EXPO_PUBLIC_MOCK_DEMO;

  beforeEach(() => {
    vi.resetModules();
    initSentryMock.mockClear();
  });

  afterEach(() => {
    if (envOriginal === undefined) delete process.env.EXPO_PUBLIC_MOCK_DEMO;
    else process.env.EXPO_PUBLIC_MOCK_DEMO = envOriginal;
  });

  it('llama a initSentry() en un build real (sin MODO_DEMO)', async () => {
    process.env.EXPO_PUBLIC_MOCK_DEMO = 'false';
    await import('./sentry-init');
    expect(initSentryMock).toHaveBeenCalledTimes(1);
  });

  it('NO llama a initSentry() en modo demo — los errores del demo nunca deben llegar a Sentry de producción', async () => {
    process.env.EXPO_PUBLIC_MOCK_DEMO = 'true';
    await import('./sentry-init');
    expect(initSentryMock).not.toHaveBeenCalled();
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveJwtSecret } from './auth.js';

const ENV_EXAMPLE_PATH = fileURLToPath(new URL('../../../.env.example', import.meta.url));

/**
 * Extrae el valor de `JWT_SECRET` tal como está publicado hoy en `.env.example`, sin
 * asumir su contenido — así el test de abajo se rompe solo si alguien cambia ese
 * placeholder sin que el guardarraíl de `resolveJwtSecret()` lo siga cubriendo (QUI-356,
 * hallazgo de security review: el placeholder publicado en ese mismo diff pasaba las tres
 * comprobaciones originales sin problema, y esta prueba existe específicamente para que
 * ese desvío no pueda volver a pasar desapercibido).
 */
function leerJwtSecretPublicado(): string {
  const contenido = readFileSync(ENV_EXAMPLE_PATH, 'utf-8');
  const linea = contenido.split('\n').find((l) => l.startsWith('JWT_SECRET='));
  if (!linea) {
    throw new Error(
      '.env.example no tiene una línea "JWT_SECRET=" — no se puede verificar el guardarraíl ' +
        'de resolveJwtSecret() contra el valor real publicado.',
    );
  }
  return linea.slice('JWT_SECRET='.length).trim();
}

describe('resolveJwtSecret — guardarraíl QUI-356', () => {
  const jwtSecretOriginal = process.env.JWT_SECRET;
  const nodeEnvOriginal = process.env.NODE_ENV;

  afterEach(() => {
    if (jwtSecretOriginal === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = jwtSecretOriginal;
    }
    if (nodeEnvOriginal === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = nodeEnvOriginal;
    }
  });

  it('rechaza fuera de development el placeholder que hoy publica .env.example', () => {
    const placeholderPublicado = leerJwtSecretPublicado();
    // Si el placeholder real dejara de tener al menos 32 caracteres, este test dejaría de
    // probar lo que dice probar (pasaría por la comprobación de longitud, no por la de
    // placeholder) — falla explícito en vez de un falso positivo silencioso.
    expect(placeholderPublicado.length).toBeGreaterThanOrEqual(32);

    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = placeholderPublicado;

    expect(() => resolveJwtSecret()).toThrow(/placeholder/i);
  });

  it('sigue rechazando el default legado ("change-me-in-production") fuera de development', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'change-me-in-production';

    expect(() => resolveJwtSecret()).toThrow();
  });

  it('sigue rechazando la ausencia de JWT_SECRET fuera de development', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;

    expect(() => resolveJwtSecret()).toThrow();
  });

  it('acepta un secreto real (alta entropía, sin marcadores de placeholder) fuera de development', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'ci-only-secret-never-use-in-production-000000';

    expect(() => resolveJwtSecret()).not.toThrow();
  });

  it('en development sigue arrancando con el placeholder legado (solo advierte, no bloquea)', () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = 'change-me-in-production';

    expect(() => resolveJwtSecret()).not.toThrow();
  });
});

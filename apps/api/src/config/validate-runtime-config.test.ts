import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateRuntimeConfig } from './validate-runtime-config.js';

// Mismo criterio que packages/db/src/client.ts:41-66 debe replicar este gate: fuera de
// `NODE_ENV=development`, sólo RUNTIME_DATABASE_URL habilita el arranque — DATABASE_URL (el
// rol "postgres", dueño de las tablas) nunca es suficiente. Ver el comentario largo en
// validate-runtime-config.ts para el porqué.
describe('validateRuntimeConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('production: RUNTIME_DATABASE_URL + JWT_SECRET válidos y CORS_ORIGIN sin "*" arrancan sin lanzar', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RUNTIME_DATABASE_URL', 'postgresql://quivo_app:x@host/db');
    vi.stubEnv('DATABASE_URL', undefined);
    vi.stubEnv('JWT_SECRET', 'a'.repeat(32));
    vi.stubEnv('CORS_ORIGIN', 'https://panel.example.com');
    vi.stubEnv('PORT', '3001');

    expect(() => validateRuntimeConfig()).not.toThrow();
  });

  it('production: falta RUNTIME_DATABASE_URL y sólo hay DATABASE_URL → lanza (no cae al fallback dev)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RUNTIME_DATABASE_URL', undefined);
    vi.stubEnv('DATABASE_URL', 'postgresql://postgres:x@host/db');
    vi.stubEnv('JWT_SECRET', 'a'.repeat(32));
    vi.stubEnv('CORS_ORIGIN', 'https://panel.example.com');

    expect(() => validateRuntimeConfig()).toThrow(/RUNTIME_DATABASE_URL/);
  });

  it('production: falta RUNTIME_DATABASE_URL y no hay ninguna DATABASE_URL → lanza', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RUNTIME_DATABASE_URL', undefined);
    vi.stubEnv('DATABASE_URL', undefined);
    vi.stubEnv('JWT_SECRET', 'a'.repeat(32));
    vi.stubEnv('CORS_ORIGIN', 'https://panel.example.com');

    expect(() => validateRuntimeConfig()).toThrow(/RUNTIME_DATABASE_URL/);
  });

  it('development: sin RUNTIME_DATABASE_URL, cae al fallback DATABASE_URL — no lanza (mismo criterio que client.ts)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('RUNTIME_DATABASE_URL', undefined);
    vi.stubEnv('DATABASE_URL', 'postgresql://quivo:x@localhost/db');
    vi.stubEnv('JWT_SECRET', 'algo-de-desarrollo');

    expect(() => validateRuntimeConfig()).not.toThrow();
  });

  it('development: sin RUNTIME_DATABASE_URL ni DATABASE_URL → lanza igual (no hay nada de qué caer)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('RUNTIME_DATABASE_URL', undefined);
    vi.stubEnv('DATABASE_URL', undefined);
    vi.stubEnv('JWT_SECRET', 'algo-de-desarrollo');

    expect(() => validateRuntimeConfig()).toThrow(/RUNTIME_DATABASE_URL/);
  });

  it('falta JWT_SECRET → lanza mencionándolo, junto con RUNTIME_DATABASE_URL si también falta', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RUNTIME_DATABASE_URL', undefined);
    vi.stubEnv('DATABASE_URL', undefined);
    vi.stubEnv('JWT_SECRET', undefined);

    expect(() => validateRuntimeConfig()).toThrow(/JWT_SECRET/);
    expect(() => validateRuntimeConfig()).toThrow(/RUNTIME_DATABASE_URL/);
  });

  it('production: JWT_SECRET corto (<32) sigue rechazado aunque RUNTIME_DATABASE_URL esté OK', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RUNTIME_DATABASE_URL', 'postgresql://quivo_app:x@host/db');
    vi.stubEnv('JWT_SECRET', 'corto');
    vi.stubEnv('CORS_ORIGIN', 'https://panel.example.com');

    expect(() => validateRuntimeConfig()).toThrow(/JWT_SECRET debe tener al menos 32/);
  });

  it('production: CORS_ORIGIN con "*" sigue rechazado aunque RUNTIME_DATABASE_URL esté OK', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RUNTIME_DATABASE_URL', 'postgresql://quivo_app:x@host/db');
    vi.stubEnv('JWT_SECRET', 'a'.repeat(32));
    vi.stubEnv('CORS_ORIGIN', '*');

    expect(() => validateRuntimeConfig()).toThrow(/CORS_ORIGIN no puede usar \*/);
  });
});

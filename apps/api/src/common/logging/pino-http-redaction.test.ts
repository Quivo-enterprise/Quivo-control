import { describe, expect, it } from 'vitest';
import { pinoHttpRedaction } from './pino-http-redaction.js';

describe('pinoHttpRedaction', () => {
  it('elimina credenciales de entrada y cookies de sesión de los logs HTTP', () => {
    expect(pinoHttpRedaction.remove).toBe(true);
    expect(pinoHttpRedaction.paths).toEqual(
      expect.arrayContaining([
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
      ]),
    );
  });
});

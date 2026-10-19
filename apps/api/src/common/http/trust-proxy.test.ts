import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { TRUST_PROXY_HOPS } from './trust-proxy.js';

describe('trustProxy', () => {
  it('req.ip es la IP que vio Cloud Run (última de X-Forwarded-For), no la falsificada por el cliente', async () => {
    const app = Fastify({ trustProxy: TRUST_PROXY_HOPS });
    app.get('/ip', (req) => ({ ip: req.ip }));

    const res = await app.inject({
      url: '/ip',
      headers: { 'x-forwarded-for': '6.6.6.6, 1.2.3.4' },
    });

    expect(res.json()).toEqual({ ip: '1.2.3.4' });
  });
});

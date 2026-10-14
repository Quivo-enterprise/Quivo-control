import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function responder(status: number, cuerpo: string | null, headers?: Record<string, string>) {
  return vi.fn(async () => new Response(cuerpo, { status, headers }));
}

async function cargarRequest() {
  vi.resetModules();
  vi.stubEnv('EXPO_PUBLIC_API_URL', 'http://api.test');
  return (await import('./http-client')).request;
}

describe('request', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllEnvs());

  it('200 con cuerpo vacío devuelve null', async () => {
    vi.stubGlobal('fetch', responder(200, ''));
    const request = await cargarRequest();
    expect(await request('/x', { method: 'GET' })).toBeNull();
  });

  it('200 con content-length 0 devuelve null', async () => {
    vi.stubGlobal('fetch', responder(200, null, { 'content-length': '0' }));
    const request = await cargarRequest();
    expect(await request('/x', { method: 'GET' })).toBeNull();
  });

  it('204 devuelve null', async () => {
    vi.stubGlobal('fetch', responder(204, null));
    const request = await cargarRequest();
    expect(await request('/x', { method: 'GET' })).toBeNull();
  });

  it('el texto JSON null se parsea a null', async () => {
    vi.stubGlobal('fetch', responder(200, 'null'));
    const request = await cargarRequest();
    expect(await request('/x', { method: 'GET' })).toBeNull();
  });

  it('un cuerpo no JSON (HTML de un proxy) es error de contrato', async () => {
    vi.stubGlobal('fetch', responder(200, '<html>502</html>'));
    const request = await cargarRequest();
    await expect(request('/x', { method: 'GET' })).rejects.toMatchObject({ kind: 'contract' });
  });

  it('JSON válido se parsea', async () => {
    vi.stubGlobal('fetch', responder(200, JSON.stringify({ a: 1 })));
    const request = await cargarRequest();
    expect(await request('/x', { method: 'GET' })).toEqual({ a: 1 });
  });

  it('una respuesta no-2xx con JSON lanza error http con el mensaje', async () => {
    vi.stubGlobal('fetch', responder(404, JSON.stringify({ message: 'No existe' })));
    const request = await cargarRequest();
    await expect(request('/x', { method: 'GET' })).rejects.toMatchObject({
      kind: 'http',
      status: 404,
      message: 'No existe',
    });
  });
});

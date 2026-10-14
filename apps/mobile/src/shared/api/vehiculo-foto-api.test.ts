import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const FOTO = { fotoUrl: 'https://x/f.jpg', fotoActualizadaEn: '2026-10-14T13:05:00.000Z' };

function responder(status: number, cuerpo: string) {
  return vi.fn(async () => new Response(cuerpo, { status }));
}

async function cargarApi() {
  vi.resetModules();
  vi.stubEnv('EXPO_PUBLIC_API_URL', 'http://api.test');
  return (await import('./vehiculo-foto-api')).vehiculoFotoApi;
}

describe('vehiculoFotoApi', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllEnvs());

  it('obtener parsea la foto', async () => {
    vi.stubGlobal('fetch', responder(200, JSON.stringify(FOTO)));
    const api = await cargarApi();
    expect(await api.obtener('t')).toEqual(FOTO);
  });

  it('obtener devuelve null con cuerpo vacío (sin foto)', async () => {
    vi.stubGlobal('fetch', responder(200, ''));
    const api = await cargarApi();
    expect(await api.obtener('t')).toBeNull();
  });

  it('obtener rechaza un contrato inválido', async () => {
    vi.stubGlobal('fetch', responder(200, JSON.stringify({ fotoUrl: 1 })));
    const api = await cargarApi();
    await expect(api.obtener('t')).rejects.toMatchObject({ kind: 'contract' });
  });

  it('subir envía POST con token y body', async () => {
    const fetchMock = responder(201, JSON.stringify(FOTO));
    vi.stubGlobal('fetch', fetchMock);
    const api = await cargarApi();
    const r = await api.subir('tok', { imagenBase64: 'AAAA', contentType: 'image/jpeg' });
    expect(r).toEqual(FOTO);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/v1/mobile/vehiculo/foto');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual({
      imagenBase64: 'AAAA',
      contentType: 'image/jpeg',
    });
  });

  it.each([409, 422, 429])('subir propaga el status %i', async (status) => {
    vi.stubGlobal('fetch', responder(status, JSON.stringify({ message: 'x' })));
    const api = await cargarApi();
    await expect(
      api.subir('t', { imagenBase64: 'AAAA', contentType: 'image/jpeg' }),
    ).rejects.toMatchObject({ kind: 'http', status });
  });
});

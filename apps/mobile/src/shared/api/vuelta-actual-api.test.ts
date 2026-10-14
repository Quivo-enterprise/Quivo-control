import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const VUELTA_ID = '3f8d3c1e-7a52-4f0b-9a3e-1c2d4e5f6a7b';
const VARIANTE_ID = '9b1c2d3e-4f50-4a6b-8c7d-0e1f2a3b4c5d';
const PUNTO_ID = '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d';

const RESPUESTA = {
  vueltaId: VUELTA_ID,
  numero: 2,
  designacion: {
    varianteId: VARIANTE_ID,
    nombre: 'Vía Molinos',
    designadaEn: '2026-10-14T13:05:00.000Z',
    acuseEn: null,
    tramo: null,
    puntoEspera: {
      id: PUNTO_ID,
      coord: { type: 'Point', coordinates: [-66.15, -17.38] },
      esperaMin: 30,
    },
  },
  enEspera: null,
};

function responder(status: number, cuerpo: string) {
  return vi.fn(async () => new Response(cuerpo, { status }));
}

async function cargarApi() {
  vi.resetModules();
  vi.stubEnv('EXPO_PUBLIC_API_URL', 'http://api.test');
  return (await import('./vuelta-actual-api')).vueltaActualApi;
}

describe('vueltaActualApi', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllEnvs());

  it('obtener pide GET con token y parsea la respuesta', async () => {
    const fetchMock = responder(200, JSON.stringify(RESPUESTA));
    vi.stubGlobal('fetch', fetchMock);
    const api = await cargarApi();
    expect(await api.obtener('tok')).toEqual(RESPUESTA);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/v1/mobile/vuelta-actual');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('obtener acepta la sesión sin vuelta todavía', async () => {
    const sinVuelta = { vueltaId: null, numero: null, designacion: null, enEspera: null };
    vi.stubGlobal('fetch', responder(200, JSON.stringify(sinVuelta)));
    const api = await cargarApi();
    expect(await api.obtener('t')).toEqual(sinVuelta);
  });

  it('obtener rechaza un contrato inválido', async () => {
    vi.stubGlobal('fetch', responder(200, JSON.stringify({ vueltaId: 5 })));
    const api = await cargarApi();
    await expect(api.obtener('t')).rejects.toMatchObject({ kind: 'contract' });
  });

  it('obtener rechaza una respuesta vacía', async () => {
    vi.stubGlobal('fetch', responder(200, ''));
    const api = await cargarApi();
    await expect(api.obtener('t')).rejects.toMatchObject({ kind: 'contract' });
  });

  it('obtener propaga el status HTTP', async () => {
    vi.stubGlobal('fetch', responder(429, JSON.stringify({ message: 'x' })));
    const api = await cargarApi();
    await expect(api.obtener('t')).rejects.toMatchObject({ kind: 'http', status: 429 });
  });

  it('acusar envía POST con vueltaId y designadaEn tal cual', async () => {
    const fetchMock = responder(200, '');
    vi.stubGlobal('fetch', fetchMock);
    const api = await cargarApi();
    await api.acusar('tok', { vueltaId: VUELTA_ID, designadaEn: '2026-10-14T13:05:00.000Z' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/v1/mobile/vuelta-actual/acuse');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      vueltaId: VUELTA_ID,
      designadaEn: '2026-10-14T13:05:00.000Z',
    });
  });

  it('acusar devuelve la vuelta actualizada si el servidor la manda; null si no', async () => {
    vi.stubGlobal('fetch', responder(200, JSON.stringify(RESPUESTA)));
    const api = await cargarApi();
    const acuse = { vueltaId: VUELTA_ID, designadaEn: '2026-10-14T13:05:00.000Z' };
    expect(await api.acusar('t', acuse)).toEqual(RESPUESTA);
    vi.stubGlobal('fetch', responder(200, ''));
    expect(await api.acusar('t', acuse)).toBeNull();
  });

  it('acusar propaga el fallo de red/HTTP', async () => {
    vi.stubGlobal('fetch', responder(500, JSON.stringify({ message: 'x' })));
    const api = await cargarApi();
    await expect(
      api.acusar('t', { vueltaId: VUELTA_ID, designadaEn: '2026-10-14T13:05:00.000Z' }),
    ).rejects.toMatchObject({ kind: 'http', status: 500 });
  });
});

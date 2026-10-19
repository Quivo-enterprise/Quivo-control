import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuteoService } from './ruteo.service.js';

const A = { lat: -17.4, lng: -66.2 };
const B = { lat: -17.41, lng: -66.21 };

const crear = (osrmUrl?: string) =>
  new RuteoService({ get: () => osrmUrl } as unknown as ConfigService);

describe('RuteoService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sin OSRM_URL devuelve null sin llamar a fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await crear().rutaEntrePuntos(A, B)).toBeNull();
    expect(await crear('  ').rutaEntrePuntos(A, B)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('con OSRM_URL llama a fetch y convierte lng/lat a lat/lng', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [
          { geometry: { coordinates: [[-66.2, -17.4], [-66.21, -17.41]] }, distance: 10, duration: 2 },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const ruta = await crear('http://osrm:5001/').rutaEntrePuntos(A, B);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('http://osrm:5001/route/v1/driving/');
    expect(ruta?.coordenadas[0]).toEqual([-17.4, -66.2]);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

async function cargarApi() {
  vi.resetModules();
  vi.stubEnv('EXPO_PUBLIC_API_URL', 'http://api.test');
  return import('./vecinos-ruta-api');
}

describe('construirQueryVecinos', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('sin posición ni fase: query vacía (nunca lat/lng/fase como string vacío)', async () => {
    const { construirQueryVecinos } = await cargarApi();
    expect(construirQueryVecinos()).toBe('');
    expect(construirQueryVecinos(null, null)).toBe('');
  });

  it('manda la fase sola, sin lat/lng', async () => {
    const { construirQueryVecinos } = await cargarApi();
    expect(construirQueryVecinos(null, 'regreso')).toBe('fase=regreso');
  });

  it('manda lat, lng y fase juntas', async () => {
    const { construirQueryVecinos } = await cargarApi();
    const q = new URLSearchParams(construirQueryVecinos({ lat: -17.34957, lng: -66.18631 }, 'ida'));
    expect(q.get('lat')).toBe('-17.34957');
    expect(q.get('lng')).toBe('-66.18631');
    expect(q.get('fase')).toBe('ida');
  });

  it('descarta una posición no finita (no manda NaN)', async () => {
    const { construirQueryVecinos } = await cargarApi();
    expect(construirQueryVecinos({ lat: Number.NaN, lng: -66 }, 'ida')).toBe('fase=ida');
  });

  it('fix impreciso (accuracy > 50 m): no manda lat/lng, sí la fase', async () => {
    const { construirQueryVecinos } = await cargarApi();
    expect(construirQueryVecinos({ lat: -17.3, lng: -66.2, accuracy: 50.1 }, 'ida')).toBe(
      'fase=ida',
    );
  });

  it('accuracy ≤ 50 m, nula o ausente: manda lat/lng', async () => {
    const { construirQueryVecinos } = await cargarApi();
    for (const accuracy of [50, 5, null, undefined]) {
      const q = new URLSearchParams(
        construirQueryVecinos({ lat: -17.3, lng: -66.2, accuracy }, null),
      );
      expect(q.get('lat')).toBe('-17.3');
      expect(q.get('lng')).toBe('-66.2');
    }
  });

  it('la query generada la acepta el schema del servidor', async () => {
    const { construirQueryVecinos } = await cargarApi();
    const { VecinosRutaQuerySchema } = await import('@quivo/shared');
    const crudo = Object.fromEntries(
      new URLSearchParams(construirQueryVecinos({ lat: -17.3, lng: -66.2 }, 'regreso')),
    );
    expect(VecinosRutaQuerySchema.parse(crudo)).toEqual({
      lat: -17.3,
      lng: -66.2,
      fase: 'regreso',
    });
  });
});

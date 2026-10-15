import { describe, expect, it } from 'vitest';
import { PuntoControlPaqueteSchema } from './paquete-dia.js';

const base = {
  id: '11111111-1111-4111-8111-111111111111',
  orden: 1,
  coord: { type: 'Point', coordinates: [-66.1, -17.4] },
  radioToleranciaM: 30,
  obligatorio: false,
};

describe('PuntoControlPaqueteSchema.rol', () => {
  it('conserva el rol cuando viaja', () => {
    expect(PuntoControlPaqueteSchema.parse({ ...base, rol: 'espera' }).rol).toBe('espera');
  });
  it('acepta null y ausente (paquetes viejos cacheados)', () => {
    expect(PuntoControlPaqueteSchema.parse({ ...base, rol: null }).rol).toBeNull();
    expect(PuntoControlPaqueteSchema.parse(base).rol).toBeUndefined();
  });
  it('rechaza un rol desconocido', () => {
    expect(PuntoControlPaqueteSchema.safeParse({ ...base, rol: 'otro' }).success).toBe(false);
  });
});

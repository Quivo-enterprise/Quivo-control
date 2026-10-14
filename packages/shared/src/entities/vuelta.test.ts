import { describe, expect, it } from 'vitest';
import {
  AcuseVueltaSchema,
  DesignarVueltaSchema,
  VueltaActualMovilSchema,
  VueltaPosicionSchema,
} from './vuelta.js';

const UUID = '00000000-0000-4000-8000-000000000001';

describe('vuelta (contratos)', () => {
  it('DesignarVuelta acepta un uuid o null (cancelar) y rechaza el resto', () => {
    expect(DesignarVueltaSchema.safeParse({ varianteId: UUID }).success).toBe(true);
    expect(DesignarVueltaSchema.safeParse({ varianteId: null }).success).toBe(true);
    expect(DesignarVueltaSchema.safeParse({ varianteId: 'molinos' }).success).toBe(false);
    expect(DesignarVueltaSchema.safeParse({}).success).toBe(false);
  });

  it('AcuseVuelta exige vueltaId uuid y designadaEn ISO', () => {
    expect(AcuseVueltaSchema.safeParse({ vueltaId: UUID, designadaEn: '2026-10-13T15:00:00.000Z' }).success).toBe(true);
    expect(AcuseVueltaSchema.safeParse({ vueltaId: UUID, designadaEn: 'ayer' }).success).toBe(false);
    expect(AcuseVueltaSchema.safeParse({ designadaEn: '2026-10-13T15:00:00.000Z' }).success).toBe(false);
  });

  it('VueltaActualMovil: sin vuelta, con designación y en espera', () => {
    expect(
      VueltaActualMovilSchema.safeParse({ vueltaId: null, numero: null, designacion: null, enEspera: null }).success,
    ).toBe(true);
    const completa = VueltaActualMovilSchema.safeParse({
      vueltaId: UUID,
      numero: 2,
      designacion: {
        varianteId: UUID,
        nombre: 'Vía Molinos',
        designadaEn: '2026-10-13T15:00:00.000Z',
        acuseEn: null,
        tramo: { type: 'LineString', coordinates: [[-65.9, -17.3], [-65.91, -17.31]] },
        puntoEspera: { id: UUID, coord: { type: 'Point', coordinates: [-65.91, -17.31] }, esperaMin: 30 },
      },
      enEspera: { desdeTs: '2026-10-13T15:20:00.000Z' },
    });
    expect(completa.success).toBe(true);
  });

  it('VueltaPosicion no admite número de vuelta 0', () => {
    const base = { varianteId: null, varianteNombre: null, designadaEn: null, acuseEn: null, enEspera: false, esperaDesdeTs: null };
    expect(VueltaPosicionSchema.safeParse({ numero: 1, ...base }).success).toBe(true);
    expect(VueltaPosicionSchema.safeParse({ numero: 0, ...base }).success).toBe(false);
  });
});

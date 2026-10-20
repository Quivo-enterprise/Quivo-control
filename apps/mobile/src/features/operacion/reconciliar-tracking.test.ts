import { describe, expect, it } from 'vitest';
import { decidirReconciliacionTracking } from './reconciliar-tracking';

describe('decidirReconciliacionTracking', () => {
  it('nativo activo con la UI en "Comenzar" → reenganchar', () => {
    expect(
      decidirReconciliacionTracking({ nativoActivo: true, tracking: false, operacionEnVuelo: false }),
    ).toBe('reenganchar');
  });

  it('nativo parado con la UI en "Finalizar" → nativo-detenido', () => {
    expect(
      decidirReconciliacionTracking({ nativoActivo: false, tracking: true, operacionEnVuelo: false }),
    ).toBe('nativo-detenido');
  });

  it('estados coherentes → nada', () => {
    expect(
      decidirReconciliacionTracking({ nativoActivo: true, tracking: true, operacionEnVuelo: false }),
    ).toBe('nada');
    expect(
      decidirReconciliacionTracking({ nativoActivo: false, tracking: false, operacionEnVuelo: false }),
    ).toBe('nada');
  });

  it('con iniciar/detener en vuelo → nada, aunque haya desincronía', () => {
    expect(
      decidirReconciliacionTracking({ nativoActivo: true, tracking: false, operacionEnVuelo: true }),
    ).toBe('nada');
    expect(
      decidirReconciliacionTracking({ nativoActivo: false, tracking: true, operacionEnVuelo: true }),
    ).toBe('nada');
  });
});

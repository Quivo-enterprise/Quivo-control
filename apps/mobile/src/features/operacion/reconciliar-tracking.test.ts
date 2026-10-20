import { describe, expect, it } from 'vitest';
import { decidirReconciliacionTracking, reconciliacionVigente } from './reconciliar-tracking';

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

describe('reconciliacionVigente', () => {
  const base = { montado: true, generacionCapturada: 3, generacionActual: 3, operacionesEnVuelo: 0 };

  it('montado, misma generación y sin operaciones en vuelo → vigente', () => {
    expect(reconciliacionVigente(base)).toBe(true);
  });

  it('ABA: una operación empezó y terminó (contador en 0) pero la generación cambió → no vigente', () => {
    expect(reconciliacionVigente({ ...base, generacionActual: 4 })).toBe(false);
  });

  it('desmontado o con operación en vuelo → no vigente', () => {
    expect(reconciliacionVigente({ ...base, montado: false })).toBe(false);
    expect(reconciliacionVigente({ ...base, operacionesEnVuelo: 1 })).toBe(false);
  });
});

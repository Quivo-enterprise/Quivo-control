import { UMBRAL_VECINO_FRESCO_MS } from '@quivo/shared';
import { describe, expect, it } from 'vitest';
import { CacheTtl, seleccionarVecinos, type CandidatoVecino } from './vecinos-ruta.util.js';

const AHORA = new Date('2026-10-10T16:00:00.000Z');
const LARGO_M = 1000;

function cand(
  sesionId: string,
  frac: number,
  extra: Partial<CandidatoVecino> = {},
): CandidatoVecino {
  return {
    sesionId,
    vehiculoId: `veh-${sesionId}`,
    placa: `P-${sesionId}`,
    numeroInterno: null,
    tipo: 'bus',
    marca: 'm',
    modelo: 'x',
    color: 'blanco',
    colorSecundario: null,
    frac,
    ultimoFixTs: new Date(AHORA.getTime() - 30_000),
    ...extra,
  };
}

describe('seleccionarVecinos', () => {
  it('sin candidatos: ni delante ni detrás', () => {
    expect(seleccionarVecinos(0.5, [], 'yo', LARGO_M, AHORA)).toEqual({
      delante: null,
      detras: null,
    });
  });

  it('solo uno adelante', () => {
    const r = seleccionarVecinos(0.5, [cand('a', 0.7)], 'yo', LARGO_M, AHORA);
    expect(r.delante?.placa).toBe('P-a');
    expect(r.delante?.distanciaM).toBeCloseTo(200, 6);
    expect(r.delante?.edadFixS).toBe(30);
    expect(r.detras).toBeNull();
  });

  it('solo uno atrás', () => {
    const r = seleccionarVecinos(0.5, [cand('a', 0.1)], 'yo', LARGO_M, AHORA);
    expect(r.detras?.placa).toBe('P-a');
    expect(r.detras?.distanciaM).toBeCloseTo(400, 6);
    expect(r.delante).toBeNull();
  });

  it('ambos: elige el más cercano de cada lado', () => {
    const r = seleccionarVecinos(
      0.5,
      [
        cand('lejosAdelante', 0.9),
        cand('cercaAdelante', 0.6),
        cand('cercaAtras', 0.45),
        cand('lejosAtras', 0.1),
      ],
      'yo',
      LARGO_M,
      AHORA,
    );
    expect(r.delante?.placa).toBe('P-cercaAdelante');
    expect(r.detras?.placa).toBe('P-cercaAtras');
    expect(r.detras?.distanciaM).toBeCloseTo(50, 6);
  });

  it('excluye a un vecino con fix más viejo que el umbral (y acepta el justo en el umbral)', () => {
    const viejo = cand('viejo', 0.6, {
      ultimoFixTs: new Date(AHORA.getTime() - UMBRAL_VECINO_FRESCO_MS - 1),
    });
    const justo = cand('justo', 0.7, {
      ultimoFixTs: new Date(AHORA.getTime() - UMBRAL_VECINO_FRESCO_MS),
    });
    const r = seleccionarVecinos(0.5, [viejo, justo], 'yo', LARGO_M, AHORA);
    expect(r.delante?.placa).toBe('P-justo');
  });

  it('una entrada cacheada descarta a quien se volvió viejo después (frescura relativa a ahora)', () => {
    const c = cand('a', 0.6);
    expect(seleccionarVecinos(0.5, [c], 'yo', LARGO_M, AHORA).delante).not.toBeNull();
    const despues = new Date(AHORA.getTime() + UMBRAL_VECINO_FRESCO_MS);
    expect(seleccionarVecinos(0.5, [c], 'yo', LARGO_M, despues).delante).toBeNull();
  });

  it('excluye mi propia sesión y otras sesiones de mi mismo vehículo', () => {
    const propia = cand('yo', 0.6);
    const mismoVehiculo = cand('otra', 0.7, { vehiculoId: 'mi-veh' });
    const r = seleccionarVecinos(0.5, [propia, mismoVehiculo], 'yo', LARGO_M, AHORA, 'mi-veh');
    expect(r).toEqual({ delante: null, detras: null });
  });

  it('empate con mi frac: va a detrás, nunca a delante', () => {
    const r = seleccionarVecinos(0.5, [cand('igual', 0.5)], 'yo', LARGO_M, AHORA);
    expect(r.detras?.placa).toBe('P-igual');
    expect(r.detras?.distanciaM).toBe(0);
    expect(r.delante).toBeNull();
  });

  it('empate entre candidatos de igual frac: gana el fix más reciente', () => {
    const r = seleccionarVecinos(
      0.5,
      [
        cand('viejo', 0.7, { ultimoFixTs: new Date(AHORA.getTime() - 120_000) }),
        cand('nuevo', 0.7, { ultimoFixTs: new Date(AHORA.getTime() - 5_000) }),
      ],
      'yo',
      LARGO_M,
      AHORA,
    );
    expect(r.delante?.placa).toBe('P-nuevo');
  });

  it('edadFixS nunca es negativa ante skew de reloj', () => {
    const futuro = cand('a', 0.6, { ultimoFixTs: new Date(AHORA.getTime() + 5_000) });
    expect(seleccionarVecinos(0.5, [futuro], 'yo', LARGO_M, AHORA).delante?.edadFixS).toBe(0);
  });

  it('el vecino expone solo los campos del contrato (sin lat/lng/conductor/sesionId)', () => {
    const r = seleccionarVecinos(0.5, [cand('a', 0.6), cand('b', 0.4)], 'yo', LARGO_M, AHORA);
    const esperadas = [
      'color',
      'colorSecundario',
      'distanciaM',
      'edadFixS',
      'marca',
      'modelo',
      'numeroInterno',
      'placa',
      'tipo',
    ];
    expect(Object.keys(r.delante!).sort()).toEqual(esperadas);
    expect(Object.keys(r.detras!).sort()).toEqual(esperadas);
  });
});

describe('CacheTtl', () => {
  it('devuelve el valor dentro del TTL y lo borra al expirar', () => {
    const c = new CacheTtl<number>(1000, 10);
    c.set('k', 1, 0);
    expect(c.get('k', 999)).toBe(1);
    expect(c.get('k', 1000)).toBeUndefined();
    expect(c.size).toBe(0);
  });

  it('al llegar al tope purga primero las expiradas', () => {
    const c = new CacheTtl<number>(1000, 2);
    c.set('a', 1, 0);
    c.set('b', 2, 900);
    c.set('c', 3, 1500); // 'a' expiró (1000 <= 1500) y se purga; 'b' sobrevive
    expect(c.get('a', 1500)).toBeUndefined();
    expect(c.get('b', 1500)).toBe(2);
    expect(c.get('c', 1500)).toBe(3);
  });

  it('si sigue lleno descarta la más antigua; nunca supera el tope', () => {
    const c = new CacheTtl<number>(10_000, 2);
    c.set('a', 1, 0);
    c.set('b', 2, 1);
    c.set('c', 3, 2);
    expect(c.size).toBe(2);
    expect(c.get('a', 3)).toBeUndefined();
    expect(c.get('b', 3)).toBe(2);
    expect(c.get('c', 3)).toBe(3);
  });

  it('reescribir una clave existente no desaloja a otras', () => {
    const c = new CacheTtl<number>(10_000, 2);
    c.set('a', 1, 0);
    c.set('b', 2, 1);
    c.set('a', 9, 2);
    expect(c.size).toBe(2);
    expect(c.get('a', 3)).toBe(9);
    expect(c.get('b', 3)).toBe(2);
  });
});

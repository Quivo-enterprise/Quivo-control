import { UMBRAL_VECINO_FRESCO_MS } from '@quivo/shared';
import { describe, expect, it } from 'vitest';
import { CacheTtl, seleccionarVecinos, type CandidatoVecino } from './vecinos-ruta.util.js';

const AHORA = new Date('2026-10-10T16:00:00.000Z');
const LARGO_M = 1000;
const LINEAL = { largoM: LARGO_M, circular: false };
const CIRCULAR = { largoM: LARGO_M, circular: true };

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
    progresoM: frac * LARGO_M,
    ultimoFixTs: new Date(AHORA.getTime() - 30_000),
    ...extra,
  };
}

describe('seleccionarVecinos', () => {
  it('sin candidatos: ni delante ni detrás', () => {
    expect(seleccionarVecinos({ progresoM: 0.5 * LARGO_M, ...LINEAL }, [], 'yo', AHORA)).toEqual({
      delante: null,
      detras: null,
    });
  });

  it('solo uno adelante', () => {
    const r = seleccionarVecinos(
      { progresoM: 0.5 * LARGO_M, ...LINEAL },
      [cand('a', 0.7)],
      'yo',
      AHORA,
    );
    expect(r.delante?.placa).toBe('P-a');
    expect(r.delante?.distanciaM).toBeCloseTo(200, 6);
    expect(r.delante?.edadFixS).toBe(30);
    expect(r.detras).toBeNull();
  });

  it('solo uno atrás', () => {
    const r = seleccionarVecinos(
      { progresoM: 0.5 * LARGO_M, ...LINEAL },
      [cand('a', 0.1)],
      'yo',
      AHORA,
    );
    expect(r.detras?.placa).toBe('P-a');
    expect(r.detras?.distanciaM).toBeCloseTo(400, 6);
    expect(r.delante).toBeNull();
  });

  it('ambos: elige el más cercano de cada lado', () => {
    const r = seleccionarVecinos(
      { progresoM: 0.5 * LARGO_M, ...LINEAL },
      [
        cand('lejosAdelante', 0.9),
        cand('cercaAdelante', 0.6),
        cand('cercaAtras', 0.45),
        cand('lejosAtras', 0.1),
      ],
      'yo',
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
    const r = seleccionarVecinos(
      { progresoM: 0.5 * LARGO_M, ...LINEAL },
      [viejo, justo],
      'yo',
      AHORA,
    );
    expect(r.delante?.placa).toBe('P-justo');
  });

  it('una entrada cacheada descarta a quien se volvió viejo después (frescura relativa a ahora)', () => {
    const c = cand('a', 0.6);
    expect(
      seleccionarVecinos({ progresoM: 0.5 * LARGO_M, ...LINEAL }, [c], 'yo', AHORA).delante,
    ).not.toBeNull();
    const despues = new Date(AHORA.getTime() + UMBRAL_VECINO_FRESCO_MS);
    expect(
      seleccionarVecinos({ progresoM: 0.5 * LARGO_M, ...LINEAL }, [c], 'yo', despues).delante,
    ).toBeNull();
  });

  it('excluye mi propia sesión y otras sesiones de mi mismo vehículo', () => {
    const propia = cand('yo', 0.6);
    const mismoVehiculo = cand('otra', 0.7, { vehiculoId: 'mi-veh' });
    const r = seleccionarVecinos(
      { progresoM: 0.5 * LARGO_M, ...LINEAL },
      [propia, mismoVehiculo],
      'yo',
      AHORA,
      'mi-veh',
    );
    expect(r).toEqual({ delante: null, detras: null });
  });

  it('empate con mi frac: va a detrás, nunca a delante', () => {
    const r = seleccionarVecinos(
      { progresoM: 0.5 * LARGO_M, ...LINEAL },
      [cand('igual', 0.5)],
      'yo',
      AHORA,
    );
    expect(r.detras?.placa).toBe('P-igual');
    expect(r.detras?.distanciaM).toBe(0);
    expect(r.delante).toBeNull();
  });

  it('empate entre candidatos de igual frac: gana el fix más reciente', () => {
    const r = seleccionarVecinos(
      { progresoM: 0.5 * LARGO_M, ...LINEAL },
      [
        cand('viejo', 0.7, { ultimoFixTs: new Date(AHORA.getTime() - 120_000) }),
        cand('nuevo', 0.7, { ultimoFixTs: new Date(AHORA.getTime() - 5_000) }),
      ],
      'yo',
      AHORA,
    );
    expect(r.delante?.placa).toBe('P-nuevo');
  });

  it('edadFixS nunca es negativa ante skew de reloj', () => {
    const futuro = cand('a', 0.6, { ultimoFixTs: new Date(AHORA.getTime() + 5_000) });
    expect(
      seleccionarVecinos({ progresoM: 0.5 * LARGO_M, ...LINEAL }, [futuro], 'yo', AHORA).delante
        ?.edadFixS,
    ).toBe(0);
  });

  it('el vecino expone solo los campos del contrato (sin lat/lng/conductor/sesionId)', () => {
    const r = seleccionarVecinos(
      { progresoM: 0.5 * LARGO_M, ...LINEAL },
      [cand('a', 0.6), cand('b', 0.4)],
      'yo',
      AHORA,
    );
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

describe('seleccionarVecinos — circuito cerrado', () => {
  it('cada vecino aparece en UNA sola fila: el lado más corto', () => {
    // Yo en 900 de 1000; uno en 100 está a 200 m "delante" (cruza el cierre), no a 800 detrás.
    const r = seleccionarVecinos({ progresoM: 900, ...CIRCULAR }, [cand('a', 0.1)], 'yo', AHORA);
    expect(r.delante?.placa).toBe('P-a');
    expect(r.delante?.distanciaM).toBeCloseTo(200, 6);
    expect(r.detras).toBeNull();
  });

  it('uno que sale de la terminal y otro que llega: detrás a pocos metros, no a una vuelta', () => {
    // Yo recién salí (20 m); el otro está llegando (990 m). Lineal los vería a 970 m.
    const circ = seleccionarVecinos(
      { progresoM: 20, ...CIRCULAR },
      [cand('llega', 0.99)],
      'yo',
      AHORA,
    );
    expect(circ.detras?.distanciaM).toBeCloseTo(30, 6);
    expect(circ.delante).toBeNull();
    const lineal = seleccionarVecinos(
      { progresoM: 20, ...LINEAL },
      [cand('llega', 0.99)],
      'yo',
      AHORA,
    );
    expect(lineal.delante?.distanciaM).toBeCloseTo(970, 6);
  });

  it('simetría: A ve a B delante a X si y solo si B ve a A detrás a X', () => {
    const a = seleccionarVecinos({ progresoM: 100, ...CIRCULAR }, [cand('b', 0.3)], 'a', AHORA);
    const b = seleccionarVecinos({ progresoM: 300, ...CIRCULAR }, [cand('a', 0.1)], 'b', AHORA);
    expect(a.delante?.distanciaM).toBeCloseTo(200, 6);
    expect(b.detras?.distanciaM).toBeCloseTo(200, 6);
    expect(a.detras).toBeNull();
    expect(b.delante).toBeNull();
  });

  it('con dos vehículos nunca hay inversión: no pueden verse ambos delante', () => {
    for (let a = 0; a < 1000; a += 70) {
      for (let b = 0; b < 1000; b += 90) {
        // Opuestos exactos (d = L/2): ambos lados empatan, caso de medida cero.
        if (a === b || Math.abs(a - b) === LARGO_M / 2) continue;
        const veA = seleccionarVecinos(
          { progresoM: a, ...CIRCULAR },
          [cand('b', b / LARGO_M)],
          'a',
          AHORA,
        );
        const veB = seleccionarVecinos(
          { progresoM: b, ...CIRCULAR },
          [cand('a', a / LARGO_M)],
          'b',
          AHORA,
        );
        expect(veA.delante !== null && veB.delante !== null).toBe(false);
        expect(veA.detras !== null && veB.detras !== null).toBe(false);
      }
    }
  });

  it('elige el más cercano de cada lado entre varios', () => {
    const r = seleccionarVecinos(
      { progresoM: 950, ...CIRCULAR },
      [cand('d1', 0.1), cand('d2', 0.3), cand('t1', 0.8), cand('t2', 0.6)],
      'yo',
      AHORA,
    );
    expect(r.delante?.placa).toBe('P-d1'); // 150 m, cruzando el cierre
    expect(r.detras?.placa).toBe('P-t1'); // 150 m
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

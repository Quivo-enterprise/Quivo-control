import { describe, expect, it } from 'vitest';
import type { PuntoControlPaquete } from '@quivo/shared';
import {
  DISTANCIA_FUERA_IDA_M,
  DISTANCIA_SOBRE_REGRESO_M,
  FIXES_FALLBACK_REGRESO,
  crearFiltroFase,
  evaluarFixFase,
  faseDe,
  mitadesDelCircuito,
  puntosDeFase,
} from './fase-vuelta';

type Rol = NonNullable<PuntoControlPaquete['rol']>;
const pc = (id: string, orden: number, rol: Rol | null = null, lng = orden, lat = 0): PuntoControlPaquete => ({
  id,
  orden,
  coord: { type: 'Point', coordinates: [lng, lat] },
  radioToleranciaM: 30,
  obligatorio: true,
  rol,
});
const ids = (puntos: PuntoControlPaquete[]) => puntos.map((p) => p.id);

// Numeración nueva: SR 0, intermedios 1..7 (ida), Honduras 8, intermedios 9..14 (regreso), Molinos 15, 16.
const nueva = [
  pc('sr', 0, 'terminal'),
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => pc(`i${n}`, n)),
  pc('h', 8, 'retorno'),
  ...[9, 10, 11, 12, 13, 14].map((n) => pc(`r${n}`, n)),
  pc('m', 15, 'espera'),
  pc('r16', 16),
];
// Producción actual (numeración vieja): SR 0, Molinos 1, Honduras 2.
const vieja = [pc('sr', 0, 'terminal'), pc('m', 1, 'espera'), pc('h', 2, 'retorno')];

describe('pertenencia de los PC a la fase', () => {
  it('numeración vieja: ida = {SR, Honduras}; regreso = {SR, Molinos}', () => {
    expect(ids(puntosDeFase(vieja, 'ida'))).toEqual(['sr', 'h']);
    expect(ids(puntosDeFase(vieja, 'regreso'))).toEqual(['sr', 'm']);
  });

  it('numeración vieja sin rol terminal: el de menor orden es la terminal (en ambas fases)', () => {
    const sinRol = [pc('sr', 0), pc('m', 1, 'espera'), pc('h', 2, 'retorno')];
    expect(ids(puntosDeFase(sinRol, 'regreso'))).toEqual(['sr', 'm']);
  });

  it('numeración nueva: ida hasta Honduras inclusive; regreso desde Honduras (exclusive) con Molinos', () => {
    expect(ids(puntosDeFase(nueva, 'ida'))).toEqual(['sr', 'i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7', 'h']);
    expect(ids(puntosDeFase(nueva, 'regreso'))).toEqual(['sr', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14', 'm', 'r16']);
  });

  it('sin PC retorno (120/Z12) o sin fase: todos pertenecen', () => {
    const sinRoles = [pc('a', 0), pc('b', 1), pc('c', 2)];
    expect(puntosDeFase(sinRoles, 'regreso')).toHaveLength(3);
    expect(puntosDeFase(nueva, null)).toHaveLength(nueva.length);
    expect(crearFiltroFase(sinRoles, 'ida')(sinRoles[2]!)).toBe(true);
  });
});

describe('fallback de fase por geometría', () => {
  const sobreRegreso = (e: { fase?: 'ida' | 'regreso'; fixesRegreso?: number }) =>
    evaluarFixFase(e, DISTANCIA_FUERA_IDA_M + 1, DISTANCIA_SOBRE_REGRESO_M - 1);

  it('pasa a regreso tras FIXES_FALLBACK_REGRESO fixes seguidos lejos de la ida y sobre el regreso', () => {
    let e: { fase?: 'ida' | 'regreso'; fixesRegreso?: number } = {};
    for (let i = 1; i < FIXES_FALLBACK_REGRESO; i++) {
      e = sobreRegreso(e);
      expect(faseDe(e)).toBe('ida');
      expect(e.fixesRegreso).toBe(i);
    }
    e = sobreRegreso(e);
    expect(e).toEqual({ fase: 'regreso', fixesRegreso: 0 });
  });

  it('un fix que no cumple reinicia el contador; si ya estaba en 0 devuelve el mismo objeto', () => {
    const e = sobreRegreso(sobreRegreso({} as { fase?: 'ida' | 'regreso'; fixesRegreso?: number }));
    expect(evaluarFixFase(e, 10, 500).fixesRegreso).toBe(0);
    const limpio: { fixesRegreso?: number } = {};
    expect(evaluarFixFase(limpio, 10, 500)).toBe(limpio);
  });

  it('calles compartidas (cerca de la ida a la vez) no cuentan', () => {
    const e = evaluarFixFase({} as { fixesRegreso?: number }, DISTANCIA_FUERA_IDA_M - 1, 5);
    expect(e.fixesRegreso ?? 0).toBe(0);
  });

  it('un fix impreciso ni cuenta ni reinicia', () => {
    const e = { fixesRegreso: 2 };
    expect(evaluarFixFase(e, 500, 5, DISTANCIA_SOBRE_REGRESO_M + 1)).toBe(e);
  });

  it('simétrico: en regreso, FIXES_FALLBACK_REGRESO fixes sobre la ida exclusiva vuelven a ida', () => {
    type E = { fase?: 'ida' | 'regreso'; fixesRegreso?: number };
    const sobreIda = (e: E) =>
      evaluarFixFase(e, DISTANCIA_SOBRE_REGRESO_M - 1, DISTANCIA_FUERA_IDA_M + 1);
    let e: E = { fase: 'regreso' };
    for (let i = 1; i < FIXES_FALLBACK_REGRESO; i++) {
      e = sobreIda(e);
      expect(faseDe(e)).toBe('regreso');
    }
    expect(sobreIda(e)).toEqual({ fase: 'ida', fixesRegreso: 0 });
    // Sobre el regreso (o calle compartida) no cuenta: reinicia.
    expect(evaluarFixFase(e, 500, 5).fixesRegreso).toBe(0);
    expect(evaluarFixFase({ fase: 'regreso' as const }, 10, 10).fase).toBe('regreso');
  });
});

describe('mitadesDelCircuito', () => {
  const geometria: [number, number][] = [[0, 0], [1, 0], [2, 0], [2, 0.001], [1, 0.001], [0, 0.001], [0, 0]];
  it('parte por el retorno y devuelve null sin retorno o si no pasa cerca', () => {
    const partido = mitadesDelCircuito(geometria, [pc('h', 8, 'retorno', 2, 0.0001)]);
    expect(partido).not.toBeNull();
    expect(partido!.ida[0]).toEqual([0, 0]);
    expect(mitadesDelCircuito(geometria, [pc('a', 0)])).toBeNull();
    expect(mitadesDelCircuito(geometria, [pc('h', 8, 'retorno', 50, 50)])).toBeNull();
  });
});

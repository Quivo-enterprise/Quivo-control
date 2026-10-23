import { describe, expect, it } from 'vitest';
import type { PuntoControlPaquete } from '@quivo/shared';
import {
  DISTANCIA_FUERA_IDA_M,
  DISTANCIA_SOBRE_REGRESO_M,
  FIXES_FALLBACK_REGRESO,
  RADIO_CANDADO_RETORNO_M,
  TOLERANCIA_SENTIDO_FASE_GRADOS,
  type SentidoFix,
  crearFiltroFase,
  evaluarFixFase,
  faseDe,
  filtrarPorSentido,
  mitadesDelCircuito,
  puntosDeFase,
  retornoBloqueaIda,
  rutasDelCircuito,
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
  type E = { fase?: 'ida' | 'regreso'; fixesRegreso?: number };
  // Rumbo del vehículo 90° (este); cada mitad con su rumbo en la posición del fix.
  const alineadoRegreso: SentidoFix = { rumbo: 90, rumboIda: 270, rumboRegreso: 90 };
  const sobreRegreso = (e: E, sentido: SentidoFix = alineadoRegreso, retornoPasado = false) =>
    evaluarFixFase(e, DISTANCIA_FUERA_IDA_M + 1, DISTANCIA_SOBRE_REGRESO_M - 1, undefined, sentido, retornoPasado);

  it('pasa a regreso tras FIXES_FALLBACK_REGRESO fixes seguidos lejos de la ida, sobre el regreso y en su sentido', () => {
    let e: E = {};
    for (let i = 1; i < FIXES_FALLBACK_REGRESO; i++) {
      e = sobreRegreso(e);
      expect(faseDe(e)).toBe('ida');
      expect(e.fixesRegreso).toBe(i);
    }
    e = sobreRegreso(e);
    expect(e).toEqual({ fase: 'regreso', fixesRegreso: 0 });
  });

  it('rumbo opuesto al de la mitad candidata: no cuenta y reinicia el contador', () => {
    const opuesto: SentidoFix = { rumbo: 270, rumboIda: 270, rumboRegreso: 90 };
    const e = sobreRegreso(sobreRegreso({}));
    expect(e.fixesRegreso).toBe(2);
    expect(sobreRegreso(e, opuesto).fixesRegreso).toBe(0);
    let x: E = {};
    for (let i = 0; i < 10; i++) x = sobreRegreso(x, opuesto);
    expect(faseDe(x)).toBe('ida');
  });

  it('dentro de la tolerancia (60°) cuenta; fuera no', () => {
    const casi: SentidoFix = { rumbo: 90 + TOLERANCIA_SENTIDO_FASE_GRADOS, rumboIda: 270, rumboRegreso: 90 };
    const lejos: SentidoFix = { rumbo: 90 + TOLERANCIA_SENTIDO_FASE_GRADOS + 1, rumboIda: 270, rumboRegreso: 90 };
    expect(sobreRegreso({}, casi).fixesRegreso).toBe(1);
    expect(sobreRegreso({}, lejos).fixesRegreso ?? 0).toBe(0);
  });

  it('sin rumbo confiable (lento / sin velocidad) el fix no cuenta', () => {
    const lento: SentidoFix = { rumbo: null, rumboIda: 270, rumboRegreso: 90 };
    let e: E = {};
    for (let i = 0; i < 10; i++) e = sobreRegreso(e, lento);
    expect(e).toEqual({});
    // Ni reinicia: lento / rápido alternados siguen acumulando y voltean tras 3 fixes rápidos.
    e = {};
    for (let i = 1; i <= FIXES_FALLBACK_REGRESO; i++) {
      e = sobreRegreso(sobreRegreso(e, lento));
      expect(e.fixesRegreso ?? 0).toBe(i % FIXES_FALLBACK_REGRESO);
    }
    expect(faseDe(e)).toBe('regreso');
    expect(sobreRegreso({}, { rumbo: 90, rumboIda: 270, rumboRegreso: null }).fixesRegreso ?? 0).toBe(0);
  });

  it('un fix que no cumple reinicia el contador; si ya estaba en 0 devuelve el mismo objeto', () => {
    const e = sobreRegreso(sobreRegreso({}));
    expect(evaluarFixFase(e, 10, 500, undefined, alineadoRegreso).fixesRegreso).toBe(0);
    const limpio: { fixesRegreso?: number } = {};
    expect(evaluarFixFase(limpio, 10, 500, undefined, alineadoRegreso)).toBe(limpio);
  });

  it('calles compartidas (cerca de la ida a la vez) no cuentan', () => {
    const e = evaluarFixFase({} as { fixesRegreso?: number }, DISTANCIA_FUERA_IDA_M - 1, 5, undefined, alineadoRegreso);
    expect(e.fixesRegreso ?? 0).toBe(0);
  });

  it('un fix impreciso ni cuenta ni reinicia', () => {
    const e = { fixesRegreso: 2 };
    expect(evaluarFixFase(e, 500, 5, DISTANCIA_SOBRE_REGRESO_M + 1, alineadoRegreso)).toBe(e);
  });

  it('simétrico: en regreso, FIXES_FALLBACK_REGRESO fixes sobre la ida exclusiva y en su sentido vuelven a ida', () => {
    const alineadoIda: SentidoFix = { rumbo: 270, rumboIda: 270, rumboRegreso: 90 };
    const sobreIda = (e: E) =>
      evaluarFixFase(e, DISTANCIA_SOBRE_REGRESO_M - 1, DISTANCIA_FUERA_IDA_M + 1, undefined, alineadoIda);
    let e: E = { fase: 'regreso' };
    for (let i = 1; i < FIXES_FALLBACK_REGRESO; i++) {
      e = sobreIda(e);
      expect(faseDe(e)).toBe('regreso');
    }
    expect(sobreIda(e)).toEqual({ fase: 'ida', fixesRegreso: 0 });
    // Sobre el regreso (o calle compartida) no cuenta: reinicia.
    expect(evaluarFixFase(e, 500, 5, undefined, alineadoIda).fixesRegreso).toBe(0);
    expect(evaluarFixFase({ fase: 'regreso' as const }, 10, 10, undefined, alineadoIda).fase).toBe('regreso');
  });

  it('retorno ya pasado: nunca vuelve de regreso a ida, aunque cumpla las tres condiciones', () => {
    const alineadoIda: SentidoFix = { rumbo: 270, rumboIda: 270, rumboRegreso: 90 };
    const e: E = { fase: 'regreso', fixesRegreso: 2 };
    expect(evaluarFixFase(e, 5, DISTANCIA_FUERA_IDA_M + 40, undefined, alineadoIda, true)).toBe(e);
    // Sin el retorno pasado (PC8 perdido y cambio erróneo) la recuperación sigue funcionando.
    expect(faseDe(evaluarFixFase(e, 5, DISTANCIA_FUERA_IDA_M + 40, undefined, alineadoIda, false))).toBe('ida');
    // Y ida -> regreso (recuperar un PC8 perdido) no depende de ese candado.
    expect(sobreRegreso({ fixesRegreso: 2 }, alineadoRegreso, true).fase).toBe('regreso');
  });
});

describe('candado de retorno pasado', () => {
  const retorno = pc('h', 8, 'retorno', 0, 0);
  const lejos: [number, number] = [0, (RADIO_CANDADO_RETORNO_M + 200) / 111_320];
  const cerca: [number, number] = [0, (RADIO_CANDADO_RETORNO_M - 200) / 111_320];

  it('bloquea solo con el retorno pasado y el fix dentro del radio', () => {
    expect(retornoBloqueaIda(true, cerca, retorno)).toBe(true);
    expect(retornoBloqueaIda(true, lejos, retorno)).toBe(false);
    expect(retornoBloqueaIda(false, cerca, retorno)).toBe(false);
  });

  it('cerca del retorno no vuelve a ida; lejos (terminal perdida) 3 fixes alineados en tramo de ida lo recuperan', () => {
    const alineadoIda: SentidoFix = { rumbo: 270, rumboIda: 270, rumboRegreso: 90 };
    const paso = (e: { fase?: 'ida' | 'regreso'; fixesRegreso?: number }, posicion: [number, number]) =>
      evaluarFixFase(e, 5, DISTANCIA_FUERA_IDA_M + 40, undefined, alineadoIda, retornoBloqueaIda(true, posicion, retorno));
    let e: { fase?: 'ida' | 'regreso'; fixesRegreso?: number } = { fase: 'regreso' };
    for (let i = 0; i < 10; i++) e = paso(e, cerca);
    expect(faseDe(e)).toBe('regreso');
    for (let i = 0; i < FIXES_FALLBACK_REGRESO; i++) e = paso(e, lejos);
    expect(faseDe(e)).toBe('ida');
  });
});

describe('compuerta de sentido de los PC', () => {
  const rumboPc = new Map([['i1', 90], ['r14', 270]]);
  const lista = [pc('sr', 0, 'terminal'), pc('i1', 1), pc('r14', 14), pc('m', 15, 'espera')];
  const idsDe = (p: PuntoControlPaquete[]) => ids(p);

  it('sin rumbo confiable devuelve la misma lista', () => {
    expect(filtrarPorSentido(lista, rumboPc, null)).toBe(lista);
  });

  it('descarta el PC cuyo trazado va en contra (> 90°) y conserva el que va a favor', () => {
    expect(idsDe(filtrarPorSentido(lista, rumboPc, 90))).toEqual(['sr', 'i1', 'm']);
    expect(idsDe(filtrarPorSentido(lista, rumboPc, 270))).toEqual(['sr', 'r14', 'm']);
    expect(idsDe(filtrarPorSentido(lista, rumboPc, 180))).toEqual(['sr', 'i1', 'r14', 'm']); // justo 90° de ambos: se conserva
  });

  it('terminal y espera quedan exentos aunque vayas en contra', () => {
    expect(idsDe(filtrarPorSentido(lista, new Map([['i1', 90], ['r14', 90]]), 270))).toEqual(['sr', 'm']);
  });

  it('rutasDelCircuito: rumbo por PC solo para los no exentos, cada uno sobre su mitad', () => {
    const geometria: [number, number][] = [[0, 0], [0.01, 0], [0.02, 0], [0.02, 0.001], [0.01, 0.001], [0, 0.001]];
    const puntos = [
      pc('sr', 0, 'terminal', 0, 0),
      pc('i1', 1, null, 0.01, 0),
      pc('h', 8, 'retorno', 0.02, 0.0005),
      pc('r9', 9, null, 0.01, 0.001),
      pc('m', 15, 'espera', 0.005, 0.001),
    ];
    const { rumboPc } = rutasDelCircuito(geometria, puntos);
    expect([...rumboPc.keys()].sort()).toEqual(['i1', 'r9']); // terminal, retorno y espera exentos
    expect(rumboPc.get('i1')).toBeCloseTo(90, 0); // ida hacia el este
    expect(rumboPc.get('r9')).toBeCloseTo(270, 0); // regreso hacia el oeste
    // El retorno (Honduras) nunca se descarta por sentido: ahí el rumbo se invierte.
    const lista = [puntos[2]!];
    expect(filtrarPorSentido(lista, rumboPc, 0)).toEqual(lista);
    expect(filtrarPorSentido(lista, rumboPc, 180)).toEqual(lista);
  });

  it('rutasDelCircuito: mover un PC invalida la caché', () => {
    const geometria: [number, number][] = [[0, 0], [0.01, 0], [0.02, 0], [0.02, 0.001], [0.01, 0.001], [0, 0.001]];
    const armar = (lngI1: number) => [
      pc('sr', 0, 'terminal', 0, 0),
      pc('i1', 1, null, lngI1, 0),
      pc('h', 8, 'retorno', 0.02, 0.0005),
      pc('r9', 9, null, 0.01, 0.001),
    ];
    const antes = rutasDelCircuito(geometria, armar(0.01));
    const despues = rutasDelCircuito(geometria, armar(0.015));
    expect(despues).not.toBe(antes);
    expect(rutasDelCircuito(geometria, armar(0.015))).toBe(despues);
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

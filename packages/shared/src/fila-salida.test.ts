import { describe, expect, it } from 'vitest';
import {
  calcularFilaSalida,
  MARGEN_DEMORADO_MS,
  resolverFrecuencia,
  type EnFilaEntrada,
  type ReglaFrecuenciaCalculo,
} from './fila-salida.js';
import { CrearFrecuenciaReglaSchema, FilaSalidaSchema } from './entities/fila-salida.js';

// Hora de Bolivia (UTC-4) del 20/10/2026 -> instante UTC.
const bo = (h: number, m = 0, dia = 20) => new Date(Date.UTC(2026, 9, dia, h + 4, m));
const min = (n: number) => n * 60_000;

function regla(p: Partial<ReglaFrecuenciaCalculo> & { minutos: number }): ReglaFrecuenciaCalculo {
  return {
    alcance: 'todos',
    grupoId: null,
    vehiculoId: null,
    desdeMin: null,
    hastaMin: null,
    creadaEn: bo(6),
    anuladaEn: null,
    ...p,
  };
}

function fila(id: string, llegada: Date, grupoId: string | null = null): EnFilaEntrada {
  return { id, vehiculoId: `v-${id}`, grupoId, llegadaTs: llegada, ordenTs: llegada };
}

const V = { id: 'v-a', grupoId: 'g1' };

describe('resolverFrecuencia', () => {
  it('sin reglas usa la base; sin base ni reglas es 0 (sale en orden sin espera)', () => {
    expect(resolverFrecuencia(V, bo(9), [], 7)).toBe(7);
    expect(resolverFrecuencia(V, bo(9), [], null)).toBe(0);
  });

  it('franja 7-8 aplica dentro y no fuera (límite superior exclusivo)', () => {
    const reglas = [regla({ minutos: 10, desdeMin: 7 * 60, hastaMin: 8 * 60 })];
    expect(resolverFrecuencia(V, bo(7), reglas, 6)).toBe(10);
    expect(resolverFrecuencia(V, bo(7, 59), reglas, 6)).toBe(10);
    expect(resolverFrecuencia(V, bo(8), reglas, 6)).toBe(6);
    expect(resolverFrecuencia(V, bo(6, 59), reglas, 6)).toBe(6);
  });

  it('precedencia vehículo > grupo > todos > base', () => {
    const todos = regla({ minutos: 4 });
    const grupo = regla({ minutos: 5, alcance: 'grupo', grupoId: 'g1' });
    const veh = regla({ minutos: 9, alcance: 'vehiculo', vehiculoId: 'v-a' });
    expect(resolverFrecuencia(V, bo(9), [todos, grupo, veh], 6)).toBe(9);
    expect(resolverFrecuencia(V, bo(9), [veh, todos, grupo], 6)).toBe(9);
    expect(resolverFrecuencia(V, bo(9), [todos, grupo], 6)).toBe(5);
    expect(resolverFrecuencia(V, bo(9), [todos], 6)).toBe(4);
  });

  it('ignora reglas de otro grupo o de otro vehículo, y el grupo no aplica a quien no tiene grupo', () => {
    const grupoOtro = regla({ minutos: 5, alcance: 'grupo', grupoId: 'g2' });
    const vehOtro = regla({ minutos: 9, alcance: 'vehiculo', vehiculoId: 'v-z' });
    expect(resolverFrecuencia(V, bo(9), [grupoOtro, vehOtro], 6)).toBe(6);
    const grupoG1 = regla({ minutos: 5, alcance: 'grupo', grupoId: 'g1' });
    expect(resolverFrecuencia({ id: 'v-b', grupoId: null }, bo(9), [grupoG1], 6)).toBe(6);
  });

  it('dentro del nivel, franja que contiene t gana a la sin franja aunque sea más vieja', () => {
    const sinFranja = regla({ minutos: 6, creadaEn: bo(7, 30) });
    const conFranja = regla({ minutos: 10, desdeMin: 7 * 60, hastaMin: 8 * 60, creadaEn: bo(6) });
    expect(resolverFrecuencia(V, bo(7, 45), [sinFranja, conFranja], 3)).toBe(10);
    // Fuera de la franja la con-franja no aplica y queda la sin franja.
    expect(resolverFrecuencia(V, bo(9), [sinFranja, conFranja], 3)).toBe(6);
  });

  it('entre iguales gana la más reciente', () => {
    const vieja = regla({ minutos: 6, creadaEn: bo(6) });
    const nueva = regla({ minutos: 9, creadaEn: bo(6, 30) });
    expect(resolverFrecuencia(V, bo(9), [vieja, nueva], null)).toBe(9);
    expect(resolverFrecuencia(V, bo(9), [nueva, vieja], null)).toBe(9);
  });

  it('cambio de regla a mitad del día: la nueva aplica desde su creadaEn, no antes', () => {
    const vieja = regla({ minutos: 6, creadaEn: bo(6) });
    const nueva = regla({ minutos: 12, creadaEn: bo(9) });
    expect(resolverFrecuencia(V, bo(8, 59), [vieja, nueva], null)).toBe(6);
    expect(resolverFrecuencia(V, bo(9), [vieja, nueva], null)).toBe(12);
  });

  it('una regla anulada no cuenta', () => {
    const anulada = regla({ minutos: 2, anuladaEn: bo(8) });
    expect(resolverFrecuencia(V, bo(9), [anulada], 6)).toBe(6);
  });

  it('día Bolivia: la regla vence a medianoche local (UTC-4), no a medianoche UTC', () => {
    const r = regla({ minutos: 3, creadaEn: bo(22) });
    // 23:30 Bolivia = 03:30Z del día siguiente: sigue siendo el mismo día local.
    expect(resolverFrecuencia(V, bo(23, 30), [r], 8)).toBe(3);
    // 00:10 Bolivia del 21: otro día, vuelve la base.
    expect(resolverFrecuencia(V, bo(0, 10, 21), [r], 8)).toBe(8);
  });

  it('la franja se mide en minutos del día de Bolivia, no UTC', () => {
    // 07:30 Bolivia = 11:30Z; si se usara UTC caería en la franja 11:00-12:00.
    const r = regla({ minutos: 10, desdeMin: 11 * 60, hastaMin: 12 * 60 });
    expect(resolverFrecuencia(V, bo(7, 30), [r], 6)).toBe(6);
    expect(resolverFrecuencia(V, bo(11, 30), [r], 6)).toBe(10);
  });
});

describe('calcularFilaSalida', () => {
  const base = { reglas: [], baseMin: 6 };

  it('lista vacía devuelve []', () => {
    expect(calcularFilaSalida({ ...base, enFila: [], ultimaSalidaTs: null, ahora: bo(9) })).toEqual(
      [],
    );
  });

  it('un solo trufi sin salidas previas: ETA = llegada + frecuencia, habilitado desde ahí', () => {
    const [p] = calcularFilaSalida({
      ...base,
      enFila: [fila('a', bo(9))],
      ultimaSalidaTs: null,
      ahora: bo(9, 9),
    });
    expect(p).toMatchObject({ posicion: 1, habilitado: true, demorado: true });
    expect(p!.etaTs).toEqual(bo(9, 6));
    expect(p!.esperaMs).toBe(0);
  });

  it('sin salidas previas y recién llegado: espera la frecuencia, no habilitado', () => {
    const [p] = calcularFilaSalida({
      ...base,
      enFila: [fila('a', bo(9))],
      ultimaSalidaTs: null,
      ahora: bo(9),
    });
    expect(p).toMatchObject({ habilitado: false, demorado: false });
    expect(p!.esperaMs).toBe(min(6));
  });

  it('sin salidas previas y sin frecuencia: ETA = llegada, habilitado exacto, no demorado', () => {
    const [p] = calcularFilaSalida({
      reglas: [],
      baseMin: null,
      enFila: [fila('a', bo(9))],
      ultimaSalidaTs: null,
      ahora: bo(9),
    });
    expect(p).toMatchObject({ habilitado: true, demorado: false });
  });

  it('llegada tardía (después de última salida + frec): manda llegada + frec', () => {
    const [p] = calcularFilaSalida({
      ...base,
      enFila: [fila('a', bo(9, 30))],
      ultimaSalidaTs: bo(9),
      ahora: bo(9, 31),
    });
    expect(p!.etaTs).toEqual(bo(9, 36));
  });

  it('llegada temprana (antes de última salida + frec): manda la última salida', () => {
    const [p] = calcularFilaSalida({
      ...base,
      enFila: [fila('a', bo(8, 50))],
      ultimaSalidaTs: bo(9),
      ahora: bo(9, 1),
    });
    expect(p!.etaTs).toEqual(bo(9, 6));
  });

  it('movido al final (ordenTs = ahora, llegada vieja, sin salida reciente): ETA = ordenTs', () => {
    const [p] = calcularFilaSalida({
      ...base,
      enFila: [{ ...fila('a', bo(8, 0)), ordenTs: bo(9, 30) }],
      ultimaSalidaTs: bo(8, 10),
      ahora: bo(9, 30),
    });
    expect(p!.etaTs).toEqual(bo(9, 30));
    expect(p!.habilitado).toBe(true);
  });

  it('2.º con llegada tardía: manda su llegada + frec, no la cadena', () => {
    const r = calcularFilaSalida({
      ...base,
      enFila: [fila('a', bo(8, 50)), fila('b', bo(9, 20))],
      ultimaSalidaTs: bo(9),
      ahora: bo(9, 1),
    });
    // a: 9:06; b: max(9:06 + 6 = 9:12, 9:20 + 6 = 9:26) = 9:26.
    expect(r.map((x) => x.etaTs)).toEqual([bo(9, 6), bo(9, 26)]);
  });

  it('franja: la espera desde la llegada usa la frecuencia vigente en la llegada', () => {
    const reglas = [regla({ minutos: 10, desdeMin: 7 * 60, hastaMin: 8 * 60 })];
    const [p] = calcularFilaSalida({
      enFila: [fila('a', bo(7, 55))],
      ultimaSalidaTs: null,
      reglas,
      baseMin: 6,
      ahora: bo(7, 56),
    });
    expect(p!.etaTs).toEqual(bo(8, 5));
  });

  it('margen de demora: a ETA+1 min no demorado y la ETA del 2.º ya corre (continuo); ETA+2 min+1 ms demorado', () => {
    const args = {
      ...base,
      enFila: [fila('a', bo(9)), fila('b', bo(9))],
      ultimaSalidaTs: null,
    };
    const eta = bo(9, 6).getTime();
    const ahoraDentro = eta + 60_000;
    const dentro = calcularFilaSalida({ ...args, ahora: new Date(ahoraDentro) });
    expect(dentro[0]).toMatchObject({ habilitado: true, demorado: false });
    expect(dentro[1]!.etaTs.getTime()).toBe(ahoraDentro + 6 * 60_000);
    const limite = calcularFilaSalida({ ...args, ahora: new Date(eta + MARGEN_DEMORADO_MS) });
    expect(limite[0]!.demorado).toBe(false);
    const fuera = calcularFilaSalida({ ...args, ahora: new Date(eta + MARGEN_DEMORADO_MS + 1) });
    expect(fuera[0]!.demorado).toBe(true);
    expect(fuera[1]!.etaTs.getTime()).toBe(eta + MARGEN_DEMORADO_MS + 1 + 6 * 60_000);
  });

  it('ETA del 1.º = última salida + frecuencia; los siguientes encadenan', () => {
    const r = calcularFilaSalida({
      ...base,
      enFila: [fila('a', bo(8, 50)), fila('b', bo(8, 52)), fila('c', bo(8, 55))],
      ultimaSalidaTs: bo(9),
      ahora: bo(9, 2),
    });
    expect(r.map((x) => x.etaTs)).toEqual([bo(9, 6), bo(9, 12), bo(9, 18)]);
    expect(r.map((x) => x.posicion)).toEqual([1, 2, 3]);
    expect(r.map((x) => x.habilitado)).toEqual([false, false, false]);
    expect(r[0]!.esperaMs).toBe(min(4));
    expect(r[2]!.esperaMs).toBe(min(16));
  });

  it('ordena por ordenTs aunque lleguen desordenados ("mover al final" = ordenTs nuevo)', () => {
    const a = { ...fila('a', bo(8, 50)), ordenTs: bo(9, 10) };
    const b = fila('b', bo(8, 52));
    const r = calcularFilaSalida({
      ...base,
      enFila: [a, b],
      ultimaSalidaTs: bo(9),
      ahora: bo(9, 1),
    });
    expect(r.map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('habilitado solo para el 1.º, desde su ETA', () => {
    const r = calcularFilaSalida({
      ...base,
      enFila: [fila('a', bo(8, 50)), fila('b', bo(8, 52))],
      ultimaSalidaTs: bo(9),
      ahora: bo(9, 6),
    });
    expect(r[0]).toMatchObject({ habilitado: true, demorado: false });
    expect(r[1]).toMatchObject({ habilitado: false, demorado: false });
  });

  it('1.º demorado corre la estimación de los de atrás desde ahora', () => {
    const r = calcularFilaSalida({
      ...base,
      enFila: [fila('a', bo(8, 50)), fila('b', bo(8, 52)), fila('c', bo(8, 55))],
      ultimaSalidaTs: bo(9),
      ahora: bo(9, 20),
    });
    expect(r[0]).toMatchObject({ habilitado: true, demorado: true });
    expect(r[0]!.etaTs).toEqual(bo(9, 6));
    expect(r[0]!.esperaMs).toBe(0);
    // b = max(9:06, ahora 9:20) + 6; c = max(b, ahora) + 6.
    expect(r[1]!.etaTs).toEqual(bo(9, 26));
    expect(r[2]!.etaTs).toEqual(bo(9, 32));
    expect(r[1]!.habilitado).toBe(false);
  });

  it('franja 7-8 cada 10 y después la base cada 6, evaluada en el instante ancla de cada paso', () => {
    const reglas = [regla({ minutos: 10, desdeMin: 7 * 60, hastaMin: 8 * 60 })];
    const r = calcularFilaSalida({
      enFila: [fila('a', bo(7, 0)), fila('b', bo(7, 1)), fila('c', bo(7, 2))],
      ultimaSalidaTs: bo(7, 40),
      reglas,
      baseMin: 6,
      ahora: bo(7, 41),
    });
    // a: 7:40 + 10 (franja) = 7:50; b: 7:50 + 10 (7:50 en franja) = 8:00; c: 8:00 + 6 (fuera) = 8:06.
    expect(r.map((x) => x.etaTs)).toEqual([bo(7, 50), bo(8, 0), bo(8, 6)]);
  });

  it('frecuencia por trufi y por grupo distintas en la misma fila', () => {
    const reglas = [
      regla({ minutos: 4, alcance: 'grupo', grupoId: 'g1' }),
      regla({ minutos: 9, alcance: 'vehiculo', vehiculoId: 'v-b' }),
    ];
    const r = calcularFilaSalida({
      enFila: [fila('a', bo(8, 50), 'g1'), fila('b', bo(8, 51), 'g1'), fila('c', bo(8, 52))],
      ultimaSalidaTs: bo(9),
      reglas,
      baseMin: 6,
      ahora: bo(9, 1),
    });
    // a (g1): 9:00+4 = 9:04; b (veh 9): 9:04+9 = 9:13; c (base 6): 9:13+6 = 9:19.
    expect(r.map((x) => x.etaTs)).toEqual([bo(9, 4), bo(9, 13), bo(9, 19)]);
  });

  it('regla creada después de la última salida afecta al que espera: el corte de reglas es ahora', () => {
    const reglas = [regla({ minutos: 20, creadaEn: bo(10, 2) })];
    const [p] = calcularFilaSalida({
      enFila: [fila('a', bo(9, 50))],
      ultimaSalidaTs: bo(10, 0),
      reglas,
      baseMin: 10,
      ahora: bo(10, 3),
    });
    expect(p!.etaTs).toEqual(bo(10, 20));
  });

  it('regla creada después de ahora no cuenta', () => {
    const reglas = [regla({ minutos: 20, creadaEn: bo(10, 5) })];
    const [p] = calcularFilaSalida({
      enFila: [fila('a', bo(9, 50))],
      ultimaSalidaTs: bo(10, 0),
      reglas,
      baseMin: 10,
      ahora: bo(10, 3),
    });
    expect(p!.etaTs).toEqual(bo(10, 10));
  });

  it('1.º demorado: la franja del 2.º se evalúa en su base real (ahora), no en la ETA del 1.º', () => {
    const reglas = [regla({ minutos: 15, desdeMin: 7 * 60, hastaMin: 8 * 60 })];
    const r = calcularFilaSalida({
      enFila: [fila('a', bo(6, 0)), fila('b', bo(6, 1))],
      ultimaSalidaTs: bo(6, 52),
      reglas,
      baseMin: 6,
      ahora: bo(7, 5),
    });
    // a: 6:52 + 6 (fuera de franja) = 6:58, demorado; b: base = ahora 7:05, en franja: +15 = 7:20.
    expect(r.map((x) => x.etaTs)).toEqual([bo(6, 58), bo(7, 20)]);
  });

  it('regla anulada se ignora en la fila', () => {
    const reglas = [regla({ minutos: 30, anuladaEn: bo(8) })];
    const [p] = calcularFilaSalida({
      enFila: [fila('a', bo(8, 50))],
      ultimaSalidaTs: bo(9),
      reglas,
      baseMin: 6,
      ahora: bo(9, 1),
    });
    expect(p!.etaTs).toEqual(bo(9, 6));
  });

  it('sin base ni reglas: frecuencia 0, el siguiente sale apenas sale el de adelante', () => {
    const r = calcularFilaSalida({
      enFila: [fila('a', bo(8, 50)), fila('b', bo(8, 52))],
      ultimaSalidaTs: bo(9),
      reglas: [],
      baseMin: null,
      ahora: bo(9),
    });
    expect(r.map((x) => x.etaTs)).toEqual([bo(9), bo(9)]);
    expect(r[0]!.habilitado).toBe(true);
  });

  it('cruce de medianoche Bolivia: la última salida de las 23:58 + frecuencia pasa al día siguiente', () => {
    const [p] = calcularFilaSalida({
      ...base,
      enFila: [fila('a', bo(23, 50))],
      ultimaSalidaTs: bo(23, 58),
      ahora: bo(23, 59),
    });
    expect(p!.etaTs).toEqual(bo(0, 4, 21));
    expect(p!.esperaMs).toBe(min(5));
  });
});

describe('schemas', () => {
  it('CrearFrecuenciaRegla valida coherencia alcance/ids y franja', () => {
    const g = '11111111-1111-4111-8111-111111111111';
    expect(CrearFrecuenciaReglaSchema.safeParse({ alcance: 'todos', minutos: 10 }).success).toBe(
      true,
    );
    expect(
      CrearFrecuenciaReglaSchema.safeParse({ alcance: 'todos', minutos: 10, grupoId: g }).success,
    ).toBe(false);
    expect(CrearFrecuenciaReglaSchema.safeParse({ alcance: 'grupo', minutos: 10 }).success).toBe(
      false,
    );
    expect(
      CrearFrecuenciaReglaSchema.safeParse({ alcance: 'grupo', minutos: 10, grupoId: g }).success,
    ).toBe(true);
    expect(
      CrearFrecuenciaReglaSchema.safeParse({ alcance: 'vehiculo', minutos: 10, grupoId: g })
        .success,
    ).toBe(false);
    expect(CrearFrecuenciaReglaSchema.safeParse({ alcance: 'todos', minutos: 0 }).success).toBe(
      false,
    );
    expect(CrearFrecuenciaReglaSchema.safeParse({ alcance: 'todos', minutos: 121 }).success).toBe(
      false,
    );
    expect(
      CrearFrecuenciaReglaSchema.safeParse({ alcance: 'todos', minutos: 5, desdeMin: 420 }).success,
    ).toBe(false);
    expect(
      CrearFrecuenciaReglaSchema.safeParse({
        alcance: 'todos',
        minutos: 5,
        desdeMin: 480,
        hastaMin: 420,
      }).success,
    ).toBe(false);
    expect(
      CrearFrecuenciaReglaSchema.safeParse({
        alcance: 'todos',
        minutos: 5,
        desdeMin: 420,
        hastaMin: 480,
      }).success,
    ).toBe(true);
  });

  it('FilaSalida exige salidaTs/origen si y solo si estado = salio', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const ok = {
      id,
      puntoControlId: id,
      sesionId: id,
      vehiculoId: id,
      llegadaTs: 'x',
      ordenTs: 'x',
      anticipada: false,
    };
    expect(
      FilaSalidaSchema.safeParse({ ...ok, estado: 'en_fila', salidaTs: null, salidaOrigen: null })
        .success,
    ).toBe(true);
    expect(
      FilaSalidaSchema.safeParse({ ...ok, estado: 'salio', salidaTs: null, salidaOrigen: null })
        .success,
    ).toBe(false);
    expect(
      FilaSalidaSchema.safeParse({ ...ok, estado: 'salio', salidaTs: 'x', salidaOrigen: 'boton' })
        .success,
    ).toBe(true);
  });
});

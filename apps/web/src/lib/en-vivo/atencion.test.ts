import { describe, expect, it } from 'vitest';
import { EstadoFrescuraSchema, type PosicionEnVivo } from '@quivo/shared';
import {
  incidenciasVisibles,
  colasVerificadas,
  colasVisibles,
  ORDEN_ESTADOS_FRESCURA,
  conteoPorEstado,
  estadoDe,
  filtrarPorEstado,
  listaAtencion,
  listaFlota,
  motivosAtencion,
  necesitaAtencion,
  ordenColaMolinos,
  puntajeAtencion,
  resumenFlota,
} from './atencion';

const SERVIDOR = '2026-10-22T15:00:00.000Z';
const hace = (min: number) => new Date(Date.parse(SERVIDOR) - min * 60_000).toISOString();
const pos = (o: Partial<PosicionEnVivo> = {}) =>
  ({ id: 's', lineaId: 'L16', vehiculoPlaca: 'AAA', estadoFrescura: 'reportando', servidorTs: SERVIDOR, ultimoFixTs: hace(0), ...o }) as PosicionEnVivo;
const esperando = (o: Partial<PosicionEnVivo> = {}) =>
  pos({ vuelta: { numero: 1, varianteId: 'v', varianteNombre: 'M', designadaEn: null, acuseEn: null, enEspera: true, esperaDesdeTs: null, molinosProxima: false }, ...o });

describe('incidencias del chofer', () => {
  const inc = (min: number, o: { categoria?: string; texto?: string; tsDispositivo?: string } = {}) => ({
    id: 'e1',
    categoria: o.categoria ?? 'bloqueo',
    texto: o.texto ?? 'Bloqueo',
    ts: o.tsDispositivo ?? hace(min),
    recibidoTs: hace(min),
  });
  it('dentro de 30 min: motivo con texto y hace N min, y pide atención', () => {
    const p = pos({ ultimaIncidencia: inc(5) });
    expect(motivosAtencion(p)).toEqual(['Incidencia: Bloqueo · hace 5 min']);
    expect(necesitaAtencion(p)).toBe(true);
  });
  it('pasados 30 min, sin incidencia o respuesta vieja sin el campo: no aparece', () => {
    expect(necesitaAtencion(pos({ ultimaIncidencia: inc(31) }))).toBe(false);
    expect(motivosAtencion(pos({ ultimaIncidencia: null }))).toEqual([]);
    expect(necesitaAtencion(pos())).toBe(false);
  });
  it('la ventana usa la recepción en el servidor, no el reloj del dispositivo', () => {
    // Reloj del dispositivo 3 h adelantado: igual cuenta 5 min desde la recepción.
    const adelantado = pos({ ultimaIncidencia: inc(5, { tsDispositivo: hace(-180) }) });
    expect(motivosAtencion(adelantado)).toEqual(['Incidencia: Bloqueo · hace 5 min']);
    // Outbox demorado: el evento es de hace 35 min en el dispositivo, pero llegó hace 1 min.
    const demorado = pos({ ultimaIncidencia: inc(1, { categoria: 'salud', texto: 'Salud', tsDispositivo: hace(35) }) });
    expect(necesitaAtencion(demorado)).toBe(true);
  });
  it('salud rankea sobre las demás incidencias', () => {
    const salud = pos({ id: 'a', ultimaIncidencia: inc(1, { categoria: 'salud', texto: 'Salud' }) });
    const otra = pos({ id: 'b', vehiculoPlaca: 'AAA', ultimaIncidencia: inc(1) });
    expect(puntajeAtencion(salud)).toBeGreaterThan(puntajeAtencion(otra));
    expect(listaAtencion([otra, salud], new Map()).map((f) => f.posicion.id)).toEqual(['a', 'b']);
  });
});

describe('incidenciasVisibles', () => {
  const inc = (id: string) => ({ id, categoria: 'salud', texto: id, ts: 't', recibidoTs: 't' });
  it('antepone la última en vivo si no está en el contexto', () => {
    expect(incidenciasVisibles([inc('a')], inc('b')).map((i) => i.id)).toEqual(['b', 'a']);
  });
  it('no duplica si ya está, ni falla sin última', () => {
    expect(incidenciasVisibles([inc('a')], inc('a')).map((i) => i.id)).toEqual(['a']);
    expect(incidenciasVisibles([inc('a')], null).map((i) => i.id)).toEqual(['a']);
  });
});

describe('conteoPorEstado', () => {
  it('cuenta los 7 estados (en 0 los ausentes) y manda lo desconocido a sin_datos', () => {
    const c = conteoPorEstado([
      pos(), pos(), pos({ estadoFrescura: 'perdido' }), pos({ estadoFrescura: 'raro' as never }),
    ]);
    expect(c).toEqual({ reportando: 2, detenido: 0, perdido: 1, sin_datos: 1, finalizado: 0, en_pausa: 0, inactivo: 0 });
  });
});

describe('motivosAtencion / necesitaAtencion / puntajeAtencion', () => {
  it('flota sana: sin motivos ni puntaje', () => {
    expect(motivosAtencion(pos())).toEqual([]);
    expect(necesitaAtencion(pos())).toBe(false);
    expect(puntajeAtencion(pos())).toBe(0);
  });
  it('perdido con hace X; sin GPS aún', () => {
    expect(motivosAtencion(pos({ estadoFrescura: 'perdido', ultimoFixTs: hace(18) }))).toEqual(['hace 18 min']);
    expect(motivosAtencion(pos({ estadoFrescura: 'perdido', ultimoFixTs: null }))).toEqual([]);
    expect(motivosAtencion(pos({ estadoFrescura: 'sin_datos', ultimoFixTs: null }))).toEqual(['Sin GPS aún']);
  });
  it('infracciones abiertas con singular/plural y nivel; ignora nivel sin abiertas', () => {
    expect(motivosAtencion(pos({ infraccionNivel: 'grave', infraccionesAbiertas: 2 }))).toEqual(['2 infracciones · grave']);
    expect(motivosAtencion(pos({ infraccionNivel: 'leve', infraccionesAbiertas: 1 }))).toEqual(['1 infracción · leve']);
    expect(necesitaAtencion(pos({ infraccionNivel: 'grave', infraccionesAbiertas: 0 }))).toBe(false);
  });
  it('cola de Molinos: solo con lugar en la cola del servidor', () => {
    expect(motivosAtencion(esperando(), 2)).toEqual(['2.º en cola de Molinos']);
    expect(necesitaAtencion(esperando(), 1)).toBe(true);
    expect(necesitaAtencion(esperando(), 2)).toBe(false);
    expect(necesitaAtencion(esperando())).toBe(false);
  });
  it('cola de Molinos: un orden viejo no vale si la posición fresca ya no espera', () => {
    expect(motivosAtencion(pos(), 1)).toEqual([]);
    expect(necesitaAtencion(pos(), 1)).toBe(false);
    expect(puntajeAtencion(pos(), 1)).toBe(0);
  });
  it('puntaje de Molinos conserva el orden más allá del 20.º', () => {
    expect(puntajeAtencion(esperando(), 20)).toBe(1);
    expect(puntajeAtencion(esperando(), 40)).toBe(1);
    expect(puntajeAtencion(esperando(), 18)).toBeGreaterThan(puntajeAtencion(esperando(), 20));
  });
  it('necesitaAtencion: perdido, sin datos o infracción abierta', () => {
    expect(necesitaAtencion(pos({ estadoFrescura: 'perdido' }))).toBe(true);
    expect(necesitaAtencion(pos({ estadoFrescura: 'sin_datos' }))).toBe(true);
    expect(necesitaAtencion(pos({ infraccionNivel: 'leve', infraccionesAbiertas: 1 }))).toBe(true);
  });
  it('acumula motivos y ordena: gravísima > perdido > sin datos > leve > Molinos', () => {
    const grav = pos({ infraccionNivel: 'gravisima', infraccionesAbiertas: 1 });
    const perd = pos({ estadoFrescura: 'perdido' });
    const sin = pos({ estadoFrescura: 'sin_datos' });
    const leve = pos({ infraccionNivel: 'leve', infraccionesAbiertas: 1 });
    const mol = esperando();
    const orden = [grav, perd, sin, leve].map((p) => puntajeAtencion(p)).concat(puntajeAtencion(mol, 1));
    expect(orden).toEqual([...orden].sort((a, b) => b - a));
    expect(puntajeAtencion(mol, 1)).toBeGreaterThan(puntajeAtencion(mol, 3));
    expect(motivosAtencion(esperando({ estadoFrescura: 'perdido', infraccionNivel: 'leve', infraccionesAbiertas: 1 }), 1)).toHaveLength(3);
  });
});

describe('ordenColaMolinos', () => {
  it('sesionId -> posición del servidor; sin resumen, vacío', () => {
    const colas = [{ puntoEsperaId: 'p', lineas: [], entradas: [{ sesionId: 'a', vehiculoId: 'v', placa: 'A', posicion: 2 }] }];
    expect(ordenColaMolinos({ colas }).get('a')).toBe(2);
    expect(ordenColaMolinos(undefined).size).toBe(0);
  });
});

describe('filtrarPorEstado / estadoDe / resumenFlota', () => {
  const lista = [
    pos({ id: 'a' }),
    pos({ id: 'b', estadoFrescura: 'perdido' }),
    pos({ id: 'c', estadoFrescura: 'raro' as never }),
    pos({ id: 'd', estadoFrescura: 'finalizado' }),
    pos({ id: 'e', estadoFrescura: 'inactivo' }),
  ];
  it('sin estado devuelve todos; con estado, solo ese (lo desconocido es sin_datos)', () => {
    expect(filtrarPorEstado(lista, null)).toHaveLength(5);
    expect(filtrarPorEstado(lista, 'perdido').map((p) => p.id)).toEqual(['b']);
    expect(filtrarPorEstado(lista, 'sin_datos').map((p) => p.id)).toEqual(['c']);
    expect(estadoDe(lista[2]!)).toBe('sin_datos');
  });
  it('conserva el vehículo con el cajón abierto', () => {
    expect(filtrarPorEstado(lista, 'perdido', 'a').map((p) => p.id)).toEqual(['a', 'b']);
  });
  it('en servicio = flota menos finalizados e inactivos; inactivo no necesita atención', () => {
    expect(resumenFlota(conteoPorEstado(lista))).toEqual({ total: 5, enServicio: 3 });
    expect(necesitaAtencion(lista[4]!)).toBe(false);
  });
});

describe('listaAtencion / listaFlota', () => {
  const lista = [
    pos({ id: 'z', vehiculoPlaca: 'ZZZ' }),
    pos({ id: 'p', vehiculoPlaca: 'PER', estadoFrescura: 'perdido', ultimoFixTs: hace(20) }),
    pos({ id: 'g', vehiculoPlaca: 'GRA', infraccionNivel: 'gravisima', infraccionesAbiertas: 1 }),
    pos({ id: 's', vehiculoPlaca: 'AAA', estadoFrescura: 'sin_datos', lat: null, lng: null }),
  ];
  it('Atención: solo los que la necesitan, por puntaje desc, con motivos', () => {
    const filas = listaAtencion(lista, new Map());
    expect(filas.map((f) => f.posicion.id)).toEqual(['g', 'p', 's']);
    expect(filas[1]!.motivos).toEqual(['hace 20 min']);
  });
  it('Atención vacía con flota sana', () => {
    expect(listaAtencion([pos({ id: 'z' })], new Map())).toEqual([]);
  });
  it('Atención: el 1.º de la cola de Molinos entra; el 2.º no', () => {
    const e = esperando({ id: 'm1' });
    const f = esperando({ id: 'm2' });
    expect(listaAtencion([e, f], new Map([['m1', 1], ['m2', 2]])).map((x) => x.posicion.id)).toEqual(['m1']);
  });
  it('Toda la flota: orden estable por placa, incluye sin GPS', () => {
    expect(listaFlota(lista, new Map()).map((f) => f.posicion.vehiculoPlaca)).toEqual(['AAA', 'GRA', 'PER', 'ZZZ']);
    expect(listaFlota([...lista].reverse(), new Map()).map((f) => f.posicion.id)).toEqual(['s', 'g', 'p', 'z']);
  });
});

describe('colasVisibles', () => {
  const cola = (lineaId: string, n: number) => ({
    puntoEsperaId: `pe-${lineaId}`,
    lineas: [{ lineaId, lineaNombre: lineaId }],
    entradas: Array.from({ length: n }, (_, i) => ({ sesionId: `s${i}`, vehiculoId: `v${i}`, placa: `P${i}`, posicion: i + 1 })),
  });
  it('descarta colas vacías y filtra por línea', () => {
    const colas = [cola('L16', 2), cola('L120', 0), cola('L120', 1)];
    expect(colasVisibles(colas, '')).toHaveLength(2);
    expect(colasVisibles(colas, 'L16')).toHaveLength(1);
    expect(colasVisibles(undefined, '')).toEqual([]);
  });
});

describe('colasVerificadas', () => {
  const colas = [{ puntoEsperaId: 'p', lineas: [], entradas: [
    { sesionId: 'a', vehiculoId: 'v', placa: 'A', posicion: 1 },
    { sesionId: 'b', vehiculoId: 'v', placa: 'B', posicion: 2 },
    { sesionId: 'z', vehiculoId: 'v', placa: 'Z', posicion: 3 },
  ] }];
  it('deja solo a los que la posición fresca confirma en espera', () => {
    const r = colasVerificadas(colas, [esperando({ id: 'a' }), pos({ id: 'b' })]);
    expect(r[0]!.entradas.map((e) => e.sesionId)).toEqual(['a']);
    expect(colasVerificadas(undefined, [])).toEqual([]);
  });
});

describe('estado desconocido (API más nueva que el panel)', () => {
  const raro = pos({ estadoFrescura: 'raro' as never });
  it('se trata como sin_datos en motivos, atención y puntaje', () => {
    expect(motivosAtencion(raro)).toEqual(['Sin GPS aún']);
    expect(necesitaAtencion(raro)).toBe(true);
    expect(puntajeAtencion(raro)).toBe(70);
  });
});

describe('ORDEN_ESTADOS_FRESCURA', () => {
  it('cubre exactamente los estados del schema', () => {
    expect([...ORDEN_ESTADOS_FRESCURA].sort()).toEqual([...EstadoFrescuraSchema.options].sort());
  });
});

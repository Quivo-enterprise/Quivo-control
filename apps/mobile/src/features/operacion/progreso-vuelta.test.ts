import { describe, expect, it } from 'vitest';
import type { PuntoControlPaquete } from '@quivo/shared';
import { faseDe } from './fase-vuelta';
import {
  claveProgresoVuelta,
  conProximo,
  derivarProgresoEstaticoEnOrden,
  ordenEfectivoPuntos,
  proximoMasCercanoIdEnOrden,
  estadoInicialVuelta,
  fechaLocal,
  normalizarEstado,
  pasoPunto,
  reiniciarVuelta,
  separarClaveProgreso,
  type DesignacionOrden,
  type EstadoProgresoVuelta,
} from './progreso-vuelta';

// Los tests derivan siempre sobre el orden efectivo (única fuente: `ordenEfectivoPuntos`).
const derivarProgresoEstatico = (
  e: EstadoProgresoVuelta,
  pcs: readonly PuntoControlPaquete[],
  d?: DesignacionOrden,
) => derivarProgresoEstaticoEnOrden(e, ordenEfectivoPuntos(pcs, d));
const proximoMasCercanoId = (
  pcs: readonly PuntoControlPaquete[],
  pos: { lat: number; lng: number } | null,
  d?: DesignacionOrden,
) => proximoMasCercanoIdEnOrden(ordenEfectivoPuntos(pcs, d), pos);
const derivarProgreso = (
  e: EstadoProgresoVuelta,
  pcs: readonly PuntoControlPaquete[],
  pos: { lat: number; lng: number } | null,
  d?: DesignacionOrden,
) => {
  const estatico = derivarProgresoEstatico(e, pcs, d);
  return conProximo(estatico, estatico.conInicio ? null : proximoMasCercanoId(pcs, pos, d));
};

function punto(id: string, orden: number, lng = 0, lat = 0): PuntoControlPaquete {
  return {
    id,
    orden,
    coord: { type: 'Point', coordinates: [lng, lat] },
    radioToleranciaM: 30,
    obligatorio: true,
  };
}

const ruta = ['a', 'b', 'c', 'd', 'e'].map((id, i) => punto(id, i));
const ids = ruta.map((p) => p.id);

function pasar(estado: EstadoProgresoVuelta, pasos: string[], vigentes: readonly string[] = ids) {
  return pasos.reduce(
    (acc, id, i) => pasoPunto(acc, { puntoId: id, clave: `${id}:${acc.procesados.length}:${i}` }, vigentes),
    estado,
  );
}

const estadosDe = (e: EstadoProgresoVuelta, pos: { lat: number; lng: number } | null = null) =>
  derivarProgreso(e, ruta, pos).puntos.map((p) => `${p.punto.id}=${p.estado}`);

describe('pasoPunto', () => {
  it('el primer punto pasado es el inicio de la vuelta', () => {
    const e = pasar(estadoInicialVuelta('s1'), ['c']);
    expect(e.inicioId).toBe('c');
    expect(e.pasados).toEqual(['c']);
  });

  it('acepta cualquier orden y no duplica un punto ya pasado', () => {
    const e = pasar(estadoInicialVuelta('s1'), ['c', 'e', 'd', 'e']);
    expect(e.pasados).toEqual(['c', 'e', 'd']);
    expect(e.vueltasCompletadas).toBe(0);
  });

  it('cierra la vuelta al volver al punto de inicio y arranca la nueva con él ya pasado', () => {
    const e = pasar(estadoInicialVuelta('s1'), ['c', 'd', 'e', 'c']);
    expect(e.vueltasCompletadas).toBe(1);
    expect(e.pasados).toEqual(['c']);
    expect(e.ultimaVueltaResumen).toEqual({ numero: 1, pasados: 3, total: 5 });
  });

  it('pasar de nuevo el inicio sin haber pasado nada más no cuenta vuelta', () => {
    const e = pasar(estadoInicialVuelta('s1'), ['c', 'c']);
    expect(e.vueltasCompletadas).toBe(0);
    expect(e.pasados).toEqual(['c']);
  });

  it('ignora una clave ya procesada (idempotencia)', () => {
    const base = pasoPunto(estadoInicialVuelta('s1'), { puntoId: 'a', clave: 'k1' }, ids);
    const sinCambio = pasoPunto(base, { puntoId: 'a', clave: 'k1' }, ids);
    expect(sinCambio).toBe(base);
    const dosVeces = pasoPunto(
      pasoPunto(base, { puntoId: 'b', clave: 'k2' }, ids),
      { puntoId: 'a', clave: 'k1' },
      ids,
    );
    expect(dosVeces.vueltasCompletadas).toBe(0);
  });

  it('acota las claves recordadas', () => {
    let e = estadoInicialVuelta('s1');
    for (let i = 0; i < 300; i++) e = pasoPunto(e, { puntoId: 'a', clave: `k${i}` }, ids);
    expect(e.procesados).toHaveLength(200);
    expect(e.procesados.at(-1)).toBe('k299');
  });

  it('cuenta varias vueltas', () => {
    const e = pasar(estadoInicialVuelta('s1'), ['a', 'b', 'a', 'c', 'a']);
    expect(e.vueltasCompletadas).toBe(2);
    expect(e.ultimaVueltaResumen?.numero).toBe(2);
  });
});

describe('derivarProgreso', () => {
  it('sin pasos: todo pendiente y próximo = el más cercano a la posición', () => {
    const cercanos = ['a', 'b', 'c'].map((id, i) => punto(id, i, i * 0.01, 0));
    const d = derivarProgreso(estadoInicialVuelta('s'), cercanos, { lat: 0, lng: 0.0199 });
    expect(d.proximo?.id).toBe('c');
    expect(d.puntos.map((p) => p.estado)).toEqual(['pendiente', 'pendiente', 'proximo']);
  });

  it('sin pasos y sin posición: próximo = menor orden', () => {
    expect(derivarProgreso(estadoInicialVuelta('s'), ruta, null).proximo?.id).toBe('a');
  });

  it('arrancar a mitad de ruta (#c primero) rota el orden y el próximo es el siguiente circular', () => {
    const e = pasar(estadoInicialVuelta('s'), ['c']);
    const d = derivarProgreso(e, ruta, null);
    expect(d.puntos.map((p) => p.punto.id)).toEqual(['c', 'd', 'e', 'a', 'b']);
    expect(d.proximo?.id).toBe('d');
    expect(d.vueltaActual).toBe(1);
  });

  it('puntos fuera de orden: los saltados quedan omitidos (rojo) y el próximo sigue al último pasado', () => {
    const e = pasar(estadoInicialVuelta('s'), ['a', 'd']);
    expect(estadosDe(e)).toEqual([
      'a=pasado',
      'b=omitido',
      'c=omitido',
      'd=pasado',
      'e=proximo',
    ]);
    const d = derivarProgreso(e, ruta, null);
    expect(d.omitidos).toBe(2);
    expect(d.pasados).toBe(2);
  });

  it('pasar luego un omitido re-ancla el próximo al último pasado (c deja de ser rojo)', () => {
    const e = pasar(estadoInicialVuelta('s'), ['a', 'd', 'b']);
    expect(estadosDe(e)).toEqual([
      'a=pasado',
      'b=pasado',
      'c=proximo',
      'd=pasado',
      'e=pendiente',
    ]);
  });

  it('autocorrección: un paso espurio adelantado se corrige al pasar el punto real', () => {
    const larga = ['1', '2', '3', '4', '5', '6', '7', '8'].map((id, i) => punto(id, i));
    const idsLarga = larga.map((p) => p.id);
    const estadosLarga = (e: EstadoProgresoVuelta) =>
      derivarProgreso(e, larga, null).puntos.map((p) => `${p.punto.id}=${p.estado}`);
    const espurio = pasar(estadoInicialVuelta('s'), ['1', '2', '8'], idsLarga);
    expect(estadosLarga(espurio).filter((x) => x.endsWith('omitido'))).toHaveLength(5);
    const corregido = pasar(espurio, ['3'], idsLarga);
    const d = derivarProgreso(corregido, larga, null);
    expect(d.omitidos).toBe(0);
    expect(d.proximo?.id).toBe('4');
    expect(estadosLarga(corregido)).toEqual([
      '1=pasado',
      '2=pasado',
      '3=pasado',
      '4=proximo',
      '5=pendiente',
      '6=pendiente',
      '7=pendiente',
      '8=pasado',
    ]);
  });

  it('si el último pasado es el inicio (vuelta recién cerrada) no hay omitidos', () => {
    const e = pasar(estadoInicialVuelta('s'), ['c', 'e', 'c']);
    expect(derivarProgreso(e, ruta, null).omitidos).toBe(0);
  });

  it('si no queda nada adelante, el próximo es el punto de inicio (cierra la vuelta)', () => {
    const e = pasar(estadoInicialVuelta('s'), ['c', 'd', 'e', 'a', 'b']);
    const d = derivarProgreso(e, ruta, null);
    expect(d.proximo?.id).toBe('c');
    expect(d.puntos[0]?.estado).toBe('proximo');
    expect(d.pasados).toBe(5);
    expect(d.omitidos).toBe(0);
  });

  it('tras cerrar la vuelta, la nueva arranca con el inicio ya pasado', () => {
    const e = pasar(estadoInicialVuelta('s'), ['c', 'e', 'c']);
    const d = derivarProgreso(e, ruta, null);
    expect(d.vueltaActual).toBe(2);
    expect(d.pasados).toBe(1);
    expect(d.proximo?.id).toBe('d');
  });

  it('lista vacía', () => {
    const d = derivarProgreso(estadoInicialVuelta('s'), [], null);
    expect(d.proximo).toBeNull();
    expect(d.puntos).toEqual([]);
    expect(d.total).toBe(0);
  });

  it('inicio que ya no está en la ruta (paquete refrescado) cae al modo sin inicio', () => {
    const e = pasar(estadoInicialVuelta('s'), ['zzz']);
    expect(derivarProgreso(e, ruta, null).proximo?.id).toBe('a');
  });
});

describe('robustez ante puntos quitados del paquete', () => {
  it('normalizarEstado re-ancla el inicio al primer pasado vigente y el último al último vigente', () => {
    const e = pasar(estadoInicialVuelta('s'), ['c', 'd', 'e']);
    const n = normalizarEstado(e, ['a', 'b', 'd', 'e']);
    expect(n.pasados).toEqual(['d', 'e']);
    expect(n.inicioId).toBe('d');
    expect(n.ultimoId).toBe('e');
  });

  it('al re-anclar saltea los PC de espera', () => {
    const e = { ...estadoInicialVuelta('s'), inicioId: 'A', pasados: ['molinos', 'A', 'B'], ultimoId: 'B' };
    const n = normalizarEstado(e, ['molinos', 'B'], ['molinos']); // A removido
    expect(n.pasados).toEqual(['molinos', 'B']);
    expect(n.inicioId).toBe('B');
    const solo = normalizarEstado({ ...estadoInicialVuelta('s'), inicioId: 'A', pasados: ['molinos', 'A'], ultimoId: 'A' }, ['molinos'], ['molinos']);
    expect(solo.inicioId).toBeNull();
  });

  it('sin pasados vigentes, inicio y último quedan en null', () => {
    const e = pasar(estadoInicialVuelta('s'), ['c']);
    const n = normalizarEstado(e, ['a', 'b']);
    expect(n.inicioId).toBeNull();
    expect(n.ultimoId).toBeNull();
    expect(n.pasados).toEqual([]);
  });

  it('devuelve el mismo objeto si no hay nada que ajustar', () => {
    const e = pasar(estadoInicialVuelta('s'), ['c', 'd']);
    expect(normalizarEstado(e, ids)).toBe(e);
  });

  it('derivarProgreso con el inicio quitado re-ancla y no se cae', () => {
    const e = pasar(estadoInicialVuelta('s'), ['c', 'd', 'e']);
    const sinC = ruta.filter((p) => p.id !== 'c');
    const d = derivarProgreso(e, sinC, null);
    expect(d.puntos.map((p) => p.punto.id)).toEqual(['d', 'e', 'a', 'b']);
    expect(d.pasados).toBe(2);
    expect(d.proximo?.id).toBe('a');
    expect(d.total).toBe(4);
  });

  it('pasoPunto con el inicio quitado no cierra una vuelta fantasma y re-ancla', () => {
    const e = pasar(estadoInicialVuelta('s'), ['c', 'd']);
    const vigentes = ['a', 'b', 'd', 'e'];
    const n = pasoPunto(e, { puntoId: 'e', clave: 'k-e' }, vigentes);
    expect(n.inicioId).toBe('d');
    expect(n.pasados).toEqual(['d', 'e']);
    expect(n.vueltasCompletadas).toBe(0);
  });

  it('el resumen de vuelta usa el total vigente', () => {
    const e = pasar(estadoInicialVuelta('s'), ['c', 'd', 'c'], ['a', 'c', 'd']);
    expect(e.ultimaVueltaResumen).toEqual({ numero: 1, pasados: 2, total: 3 });
  });

  it('un paso a un punto que ya no existe solo recuerda la clave', () => {
    const e = pasoPunto(estadoInicialVuelta('s'), { puntoId: 'zzz', clave: 'k' }, ids);
    expect(e.pasados).toEqual([]);
    expect(e.inicioId).toBeNull();
    expect(e.procesados).toEqual(['k']);
  });
});

describe('reiniciarVuelta', () => {
  it('limpia la vuelta en curso y conserva el conteo de vueltas', () => {
    const e = pasar(estadoInicialVuelta('s'), ['a', 'b', 'a', 'c']);
    expect(e.vueltasCompletadas).toBe(1);
    const r = reiniciarVuelta(e);
    expect(r.inicioId).toBeNull();
    expect(r.pasados).toEqual([]);
    expect(r.ultimoId).toBeNull();
    expect(r.vueltasCompletadas).toBe(1);
    expect(r.procesados).toEqual(e.procesados);
  });

  it('devuelve el mismo objeto si ya estaba limpia', () => {
    const e = estadoInicialVuelta('s');
    expect(reiniciarVuelta(e)).toBe(e);
  });
});

describe('clave del progreso', () => {
  it('fechaLocal usa el día local del dispositivo (YYYY-MM-DD)', () => {
    const ms = new Date(2026, 0, 5, 23, 59).getTime();
    expect(fechaLocal(ms)).toBe('2026-01-05');
    expect(fechaLocal(new Date(2026, 11, 31, 0, 1).getTime())).toBe('2026-12-31');
  });

  it('claveProgresoVuelta y separarClaveProgreso son inversas (aunque el sesionId tenga ":")', () => {
    const clave = claveProgresoVuelta('ses:ion-1', '2026-10-11');
    expect(clave).toBe('ses:ion-1:2026-10-11');
    expect(separarClaveProgreso(clave)).toEqual({ sesionId: 'ses:ion-1', fecha: '2026-10-11' });
  });
});

describe('PC de espera (Molinos) y designación', () => {
  type Rol = 'terminal' | 'retorno' | 'espera' | null;
  const conRol = (id: string, orden: number, rol: Rol) => ({ ...punto(id, orden), rol });
  const l16 = [conRol('sr', 0, 'terminal'), conRol('mol', 1, 'espera'), conRol('hon', 2, 'retorno')];
  const desig = { puntoEspera: { id: 'mol' } };
  const lista = (e: EstadoProgresoVuelta, d: typeof desig | null) =>
    derivarProgresoEstatico(e, l16, d ?? undefined).puntos.map((p) => `${p.punto.id}=${p.estado}`);
  const pasarL16 = (pasos: string[], vigentes: readonly string[]) =>
    pasar(estadoInicialVuelta('s1'), pasos, vigentes);

  it('sin designación: Molinos nunca es próximo ni omitido y no cuenta en el total', () => {
    const vig = ['sr', 'hon'];
    const tras = derivarProgresoEstatico(pasarL16(['sr'], vig), l16);
    expect(tras.proximo?.id).toBe('hon');
    expect(tras.total).toBe(2);
    const fin = derivarProgresoEstatico(pasarL16(['sr', 'hon'], vig), l16);
    expect(fin.proximo?.id).toBe('sr');
    expect(fin.omitidos).toBe(0);
    expect(fin.puntos.map((p) => p.punto.id)).toEqual(['sr', 'hon']);
  });

  it('con designación: tras Honduras el próximo es Molinos y luego SR', () => {
    const vig = ['sr', 'mol', 'hon'];
    expect(lista(pasarL16(['sr'], vig), desig)).toEqual(['sr=pasado', 'hon=proximo', 'mol=pendiente']);
    expect(lista(pasarL16(['sr', 'hon'], vig), desig)).toEqual(['sr=pasado', 'hon=pasado', 'mol=proximo']);
    const fin = derivarProgresoEstatico(pasarL16(['sr', 'hon', 'mol'], vig), l16, desig);
    expect(fin.proximo?.id).toBe('sr');
    expect(fin.omitidos).toBe(0);
    expect(fin.total).toBe(3);
  });

  it('cancelación a mitad de vuelta: Molinos sale del cálculo sin omitidos espurios', () => {
    const e = pasarL16(['sr', 'hon'], ['sr', 'mol', 'hon']);
    const con = derivarProgresoEstatico(e, l16, desig);
    expect(con.proximo?.id).toBe('mol');
    const sin = derivarProgresoEstatico(e, l16, null);
    expect(sin.proximo?.id).toBe('sr');
    expect(sin.omitidos).toBe(0);
    expect(sin.total).toBe(2);
  });

  it('aparece a mitad de vuelta (después de Honduras): el próximo pasa a Molinos', () => {
    const e = pasarL16(['sr', 'hon'], ['sr', 'hon']);
    expect(derivarProgresoEstatico(e, l16, null).proximo?.id).toBe('sr');
    const con = derivarProgresoEstatico(e, l16, desig);
    expect(con.proximo?.id).toBe('mol');
    expect(con.omitidos).toBe(0);
  });

  it('designación que llega tras pasar el retorno y el cierre: Molinos queda omitido (regla general)', () => {
    // Vuelta anclada en Honduras (SR -> Honduras -> SR): con la designación activa el orden efectivo
    // rotado es [hon, mol, sr] y ya se pasó un PC posterior a Molinos (sr).
    const e = pasarL16(['hon', 'sr'], ['sr', 'mol', 'hon']);
    const d = derivarProgresoEstatico(e, l16, desig);
    expect(d.puntos.map((p) => `${p.punto.id}=${p.estado}`)).toEqual([
      'hon=proximo',
      'mol=omitido',
      'sr=pasado',
    ]);
    expect(d.omitidos).toBe(1);
  });

  it('[A, R, M, B, C]: tras R el próximo es M; si ya se pasó B, M queda omitido y el próximo es C', () => {
    const pcs = [
      conRol('a', 0, 'terminal'),
      conRol('r', 1, 'retorno'),
      conRol('m', 2, 'espera'),
      conRol('b', 3, null),
      conRol('c', 4, null),
    ];
    const d = { puntoEspera: { id: 'm' } };
    const vig = ['a', 'r', 'm', 'b', 'c'];
    const tras = (pasos: string[]) =>
      derivarProgresoEstatico(pasar(estadoInicialVuelta('s1'), pasos, vig), pcs, d);
    expect(tras(['a', 'r']).proximo?.id).toBe('m');
    const salteado = tras(['a', 'r', 'b']);
    expect(salteado.proximo?.id).toBe('c');
    expect(salteado.puntos.find((p) => p.punto.id === 'm')?.estado).toBe('omitido');
  });

  it('Molinos no ancla la vuelta: pasar por él sin designación solo queda registrado como pasado', () => {
    const e = pasoPunto(estadoInicialVuelta('s1'), { puntoId: 'mol', clave: 'k1' }, ['sr', 'hon'], ['mol']);
    expect(e.inicioId).toBeNull();
    expect(e.pasados).toEqual(['mol']);
    expect(e.procesados).toContain('k1');
    // Idempotente por clave.
    expect(pasoPunto(e, { puntoId: 'mol', clave: 'k1' }, ['sr', 'hon'], ['mol'])).toBe(e);
    // Un paso posterior ancla en el PC real y conserva el registro de Molinos.
    const ancla = pasoPunto(e, { puntoId: 'sr', clave: 'k2' }, ['sr', 'hon'], ['mol']);
    expect(ancla.inicioId).toBe('sr');
    expect(ancla.pasados).toEqual(['mol', 'sr']);
  });

  it('paso por Molinos antes de la designación: al llegar la designación Molinos figura pasado', () => {
    const efectivos = ['sr', 'hon'];
    let e = estadoInicialVuelta('s1');
    for (const [i, id] of ['sr', 'hon', 'mol'].entries()) {
      e = pasoPunto(e, { puntoId: id, clave: `k${i}` }, efectivos, ['mol']);
    }
    // Sin designación no cuenta: ni total ni próximo ni omitidos.
    const sin = derivarProgresoEstatico(e, l16, null);
    expect(sin.total).toBe(2);
    expect(sin.pasados).toBe(2);
    expect(sin.proximo?.id).toBe('sr');
    const con = derivarProgresoEstatico(e, l16, desig);
    expect(con.total).toBe(3);
    expect(con.pasados).toBe(3);
    expect(con.puntos.find((p) => p.punto.id === 'mol')?.estado).toBe('pasado');
    expect(con.omitidos).toBe(0);
  });

  it('el registro de Molinos sin designación no cuenta para cerrar la vuelta (solo inicio + Molinos)', () => {
    let e = estadoInicialVuelta('s1');
    for (const [i, id] of ['sr', 'mol', 'sr'].entries()) {
      e = pasoPunto(e, { puntoId: id, clave: `k${i}` }, ['sr', 'hon'], ['mol']);
    }
    expect(e.vueltasCompletadas).toBe(0);
  });

  it('vuelta sin designación cerrada: total del resumen con el orden efectivo (4/4, no 4/5)', () => {
    const base4 = ['a', 'b', 'c', 'd'];
    const efectivos = ordenEfectivoPuntos(
      [...base4.map((id, i) => conRol(id, i, null)), conRol('m', 4, 'espera')],
      null,
    ).map((p) => p.id);
    expect(efectivos).toEqual(base4);
    let e = estadoInicialVuelta('s1');
    for (const [i, id] of ['a', 'b', 'c', 'd', 'a'].entries()) {
      e = pasoPunto(e, { puntoId: id, clave: `k${i}` }, efectivos, ['m']);
    }
    expect(e.ultimaVueltaResumen).toEqual({ numero: 1, pasados: 4, total: 4 });
  });

  it('con designación activa el total incluye a Molinos (5/5)', () => {
    const pcs = [...['a', 'b', 'c', 'd'].map((id, i) => conRol(id, i, null)), conRol('m', 4, 'espera')];
    const efectivos = ordenEfectivoPuntos(pcs, { puntoEspera: { id: 'm' } }).map((p) => p.id);
    let e = estadoInicialVuelta('s1');
    for (const [i, id] of ['a', 'b', 'c', 'd', 'm', 'a'].entries()) {
      e = pasoPunto(e, { puntoId: id, clave: `k${i}` }, efectivos, ['m']);
    }
    expect(e.ultimaVueltaResumen).toEqual({ numero: 1, pasados: 5, total: 5 });
  });

  it('paquete sin rol: idéntico al comportamiento previo', () => {
    const sinRol = derivarProgresoEstatico(estadoInicialVuelta('s1'), ruta);
    expect(derivarProgresoEstatico(estadoInicialVuelta('s1'), ruta, desig)).toEqual(sinRol);
    const e = pasar(estadoInicialVuelta('s1'), ['a', 'c']);
    expect(derivarProgresoEstatico(e, ruta, desig)).toEqual(derivarProgresoEstatico(e, ruta));
    expect(derivarProgresoEstatico(e, ruta).omitidos).toBe(1);
  });

  it('designación cuyo puntoEspera no coincide con ningún PC: se ignora', () => {
    const e = pasarL16(['sr'], ['sr', 'hon']);
    expect(derivarProgresoEstatico(e, l16, { puntoEspera: { id: 'otro' } })).toEqual(
      derivarProgresoEstatico(e, l16, null),
    );
  });

  it('sin PC retorno, Molinos queda en su orden', () => {
    const pcs = [conRol('sr', 0, 'terminal'), conRol('mol', 1, 'espera'), conRol('x', 2, null)];
    expect(ordenEfectivoPuntos(pcs, desig).map((p) => p.id)).toEqual(['sr', 'mol', 'x']);
    expect(ordenEfectivoPuntos(pcs, null).map((p) => p.id)).toEqual(['sr', 'x']);
  });

  it('proximoMasCercanoId ignora Molinos sin designación', () => {
    const pcs = [
      { ...conRol('sr', 0, 'terminal'), coord: { type: 'Point' as const, coordinates: [0, 0] as [number, number] } },
      { ...conRol('mol', 1, 'espera'), coord: { type: 'Point' as const, coordinates: [1, 1] as [number, number] } },
      { ...conRol('hon', 2, 'retorno'), coord: { type: 'Point' as const, coordinates: [5, 5] as [number, number] } },
    ];
    const pos = { lat: 1, lng: 1 };
    expect(proximoMasCercanoId(pcs, pos)).toBe('sr');
    expect(proximoMasCercanoId(pcs, pos, desig)).toBe('mol');
  });
});

describe('fases ida/regreso del circuito (PC retorno)', () => {
  type Rol = NonNullable<PuntoControlPaquete['rol']>;
  const conRol = (id: string, orden: number, rol: Rol | null = null) => ({ ...punto(id, orden), rol });
  const rolesDe = (pcs: PuntoControlPaquete[]) => ({
    retornoId: pcs.find((p) => p.rol === 'retorno')?.id ?? null,
    terminalId: pcs.find((p) => p.rol === 'terminal')?.id ?? null,
  });
  const paso = (
    pcs: PuntoControlPaquete[],
    estado: EstadoProgresoVuelta,
    pasos: string[],
    d?: DesignacionOrden,
  ) =>
    pasos.reduce(
      (acc, id, i) =>
        pasoPunto(
          acc,
          { puntoId: id, clave: `${id}:${acc.procesados.length}:${i}` },
          ordenEfectivoPuntos(pcs, d).map((p) => p.id),
          pcs.filter((p) => p.rol === 'espera').map((p) => p.id),
          rolesDe(pcs),
        ),
      estado,
    );
  const nueva = [
    conRol('sr', 0, 'terminal'),
    ...[1, 2, 3, 4, 5, 6, 7].map((n) => conRol(`i${n}`, n)),
    conRol('h', 8, 'retorno'),
    ...[9, 10, 11, 12, 13, 14].map((n) => conRol(`r${n}`, n)),
    conRol('m', 15, 'espera'),
    conRol('r16', 16),
  ];
  const vieja = [conRol('sr', 0, 'terminal'), conRol('m', 1, 'espera'), conRol('h', 2, 'retorno')];
  const desMolinos: DesignacionOrden = { puntoEspera: { id: 'm' } };
  const idsDe = (e: { puntos: { punto: PuntoControlPaquete }[] }) => e.puntos.map((p) => p.punto.id);

  it('Molinos con orden posterior al retorno queda en su orden (numeración nueva)', () => {
    const ids = ordenEfectivoPuntos(nueva, desMolinos).map((p) => p.id);
    expect(ids.indexOf('m')).toBe(ids.indexOf('r14') + 1);
    expect(ids.at(-1)).toBe('r16');
    expect(ordenEfectivoPuntos(nueva, null).map((p) => p.id)).not.toContain('m');
  });

  it('numeración vieja: Molinos sigue justo después del retorno', () => {
    expect(ordenEfectivoPuntos(vieja, desMolinos).map((p) => p.id)).toEqual(['sr', 'h', 'm']);
  });

  it('la vuelta arranca en la terminal; pasos previos por intermedios no la anclan', () => {
    const e0 = paso(nueva, estadoInicialVuelta('s'), ['i3', 'i4']);
    expect(e0.inicioId).toBeNull();
    expect(e0.fase ?? 'ida').toBe('ida');
    const e1 = paso(nueva, e0, ['sr']);
    expect(e1.inicioId).toBe('sr');
    expect(e1.pasados).toEqual(['sr']);
  });

  it('pasar el retorno cambia a regreso; cerrar la vuelta en la terminal vuelve a ida', () => {
    let e = paso(nueva, estadoInicialVuelta('s'), ['sr', 'i1', 'i2']);
    expect(faseDe(e)).toBe('ida');
    e = paso(nueva, e, ['h']);
    expect(faseDe(e)).toBe('regreso');
    e = paso(nueva, e, ['r9', 'r10', 'sr']);
    expect(e.vueltasCompletadas).toBe(1);
    expect(faseDe(e)).toBe('ida');
    expect(e.pasados).toEqual(['sr']);
  });

  it('sin rol terminal el ancla es el PC de menor orden y nunca el retorno', () => {
    const sinTerminal = [conRol('a', 0), conRol('b', 1), conRol('h', 2, 'retorno'), conRol('c', 3)];
    let e = paso(sinTerminal, estadoInicialVuelta('s'), ['h']);
    expect(e.inicioId).toBeNull(); // Honduras no ancla la vuelta
    e = paso(sinTerminal, e, ['a', 'b', 'h']);
    expect(e.inicioId).toBe('a');
    expect(faseDe(e)).toBe('regreso');
    // Vuelta siguiente: pasar Honduras no reinicia la fase a ida.
    e = paso(sinTerminal, e, ['c', 'a']);
    expect(e.vueltasCompletadas).toBe(1);
    e = paso(sinTerminal, e, ['b', 'h']);
    expect(faseDe(e)).toBe('regreso');
  });

  it('la terminal no cierra la vuelta con solo ella pasada ni toca la fase', () => {
    const e = paso(nueva, estadoInicialVuelta('s'), ['sr', 'sr']);
    expect(e.vueltasCompletadas).toBe(0);
    expect(faseDe(e)).toBe('ida');
  });

  it('numeración vieja: SR → Honduras (regreso) → Molinos → SR cierra y vuelve a ida', () => {
    let e = paso(vieja, estadoInicialVuelta('s'), ['sr', 'h'], desMolinos);
    expect(faseDe(e)).toBe('regreso');
    e = paso(vieja, e, ['m', 'sr'], desMolinos);
    expect(e.vueltasCompletadas).toBe(1);
    expect(faseDe(e)).toBe('ida');
  });

  it('derivar en ida muestra solo la ida y el próximo es de la ida; el total sigue siendo el de la vuelta', () => {
    const e = paso(nueva, estadoInicialVuelta('s'), ['sr', 'i1']);
    const d = derivarProgresoEstaticoEnOrden(e, ordenEfectivoPuntos(nueva, null), 'ida');
    expect(idsDe(d)).toEqual(['sr', 'i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7', 'h']);
    expect(d.proximo?.id).toBe('i2');
    expect(d.total).toBe(nueva.length - 1); // sin Molinos (no designado)
  });

  it('en regreso muestra solo el regreso, el próximo es del regreso y los de la ida no figuran omitidos', () => {
    // Saltea i2..i7 (omitidos en la ida), pasa Honduras.
    const e = paso(nueva, estadoInicialVuelta('s'), ['sr', 'i1', 'h']);
    const d = derivarProgresoEstaticoEnOrden(e, ordenEfectivoPuntos(nueva, desMolinos), 'regreso');
    expect(idsDe(d)).toEqual(['sr', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14', 'm', 'r16']);
    expect(d.proximo?.id).toBe('r9');
    expect(d.puntos.every((p) => p.estado !== 'omitido')).toBe(true);
    expect(d.omitidos).toBe(0);
  });

  it('en ida los PC del regreso (adelante) son pendientes, nunca omitidos', () => {
    const e = paso(nueva, estadoInicialVuelta('s'), ['sr', 'i1', 'i2', 'i3']);
    const completo = derivarProgresoEstaticoEnOrden(e, ordenEfectivoPuntos(nueva, null));
    expect(completo.puntos.filter((p) => p.estado === 'omitido')).toEqual([]);
  });

  it('un PC de la fase salteado sí queda omitido', () => {
    const e = paso(nueva, estadoInicialVuelta('s'), ['sr', 'i1', 'i3']);
    const d = derivarProgresoEstaticoEnOrden(e, ordenEfectivoPuntos(nueva, null), 'ida');
    expect(d.puntos.find((p) => p.punto.id === 'i2')?.estado).toBe('omitido');
    expect(d.omitidos).toBe(1);
  });

  it('numeración vieja: ida = SR+Honduras (próximo Honduras); regreso = SR+Molinos', () => {
    const orden = ordenEfectivoPuntos(vieja, desMolinos);
    const ida = derivarProgresoEstaticoEnOrden(paso(vieja, estadoInicialVuelta('s'), ['sr'], desMolinos), orden, 'ida');
    expect(idsDe(ida)).toEqual(['sr', 'h']);
    expect(ida.proximo?.id).toBe('h');
    const regreso = derivarProgresoEstaticoEnOrden(
      paso(vieja, estadoInicialVuelta('s'), ['sr', 'h'], desMolinos),
      orden,
      'regreso',
    );
    expect(idsDe(regreso)).toEqual(['sr', 'm']);
    expect(regreso.proximo?.id).toBe('m');
    // Sin designación, el regreso solo tiene la terminal: el próximo es ella (cierra la vuelta).
    const sinDes = derivarProgresoEstaticoEnOrden(
      paso(vieja, estadoInicialVuelta('s'), ['sr', 'h']),
      ordenEfectivoPuntos(vieja, null),
      'regreso',
    );
    expect(idsDe(sinDes)).toEqual(['sr']);
    expect(sinDes.proximo?.id).toBe('sr');
  });

  it('rutas sin roles: sin fase y con el anclaje de siempre (primer PC pasado)', () => {
    const e = pasar(estadoInicialVuelta('s'), ['c', 'd', 'c']);
    expect(e.inicioId).toBe('c');
    expect(e.vueltasCompletadas).toBe(1);
    expect(e.fase).toBeUndefined();
    const d = derivarProgresoEstaticoEnOrden(estadoInicialVuelta('s'), ruta);
    expect(d.puntos).toHaveLength(5);
  });

  it('reiniciar el recorrido vuelve a ida', () => {
    const e = paso(nueva, estadoInicialVuelta('s'), ['sr', 'h']);
    expect(faseDe(reiniciarVuelta(e))).toBe('ida');
  });
});

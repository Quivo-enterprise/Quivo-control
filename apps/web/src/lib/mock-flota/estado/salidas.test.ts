import { describe, expect, it } from 'vitest';
import { colaDe, horariosCola } from './salidas';
import { estadoInicial, reducer } from './index';

/** Ítems 2 y 8 del guion delegado. */

describe('horariosCola (ítem 8)', () => {
  it('el próximo horario de la cabeza de cola nunca queda en el pasado respecto de `now`', () => {
    // `now` bien entrada la mañana — el historial sembrado (que termina antes de las 12:00)
    // quedó "viejo"; antes del fix, `proximaProgramadaDe` podía devolver una hora ya pasada.
    const ahora = new Date('2026-09-27T10:45:00-04:00');
    const estado = estadoInicial(ahora);
    const horarios = horariosCola(estado, 'z12', ahora);
    for (const h of horarios) {
      expect(Date.parse(h.programada)).toBeGreaterThanOrEqual(ahora.getTime());
    }
  });

  it('devuelve una entrada por trufi en cola, en el MISMO orden que `colaDe`', () => {
    const ahora = new Date('2026-09-27T10:45:00-04:00');
    const estado = estadoInicial(ahora);
    const horarios = horariosCola(estado, 'z12', ahora);
    expect(horarios.map((h) => h.trufiId)).toEqual(colaDe(estado, 'z12'));
  });

  it('cada entrada de la cola sale DESPUÉS que la anterior (respeta la frecuencia)', () => {
    const ahora = new Date('2026-09-27T10:45:00-04:00');
    const estado = estadoInicial(ahora);
    const horarios = horariosCola(estado, 'z12', ahora);
    for (let i = 1; i < horarios.length; i++) {
      expect(Date.parse(horarios[i]!.programada)).toBeGreaterThan(Date.parse(horarios[i - 1]!.programada));
    }
  });
});

describe('reposicionarCola (ítem 2)', () => {
  it('en la escena inicial, los trufis en cola de una misma línea NO comparten la misma posición', () => {
    const estado = estadoInicial(new Date('2026-09-27T10:45:00-04:00'));
    for (const lineaId of ['z12', 'l120'] as const) {
      const cola = colaDe(estado, lineaId);
      const posiciones = cola.map((id) => `${estado.trufis[id]!.lat},${estado.trufis[id]!.lng}`);
      expect(new Set(posiciones).size).toBe(cola.length);
    }
  });

  it('el primero de la cola sigue con avance 0 (el origen de la línea)', () => {
    const estado = estadoInicial(new Date('2026-09-27T10:45:00-04:00'));
    const cola = colaDe(estado, 'z12');
    expect(cola.length).toBeGreaterThan(0);
    const cabeza = estado.trufis[cola[0]!]!;
    expect(cabeza.avance).toBe(0);
  });

  it('después de `despacharSiguiente`, el resto de la cola se reacomoda (el 2° pasa a ser el 1°, en su posición)', () => {
    let estado = estadoInicial(new Date('2026-09-27T10:45:00-04:00'));
    const colaAntes = colaDe(estado, 'z12');
    expect(colaAntes.length).toBeGreaterThanOrEqual(2);
    const segundo = colaAntes[1]!;
    const posSegundoAntes = { lat: estado.trufis[segundo]!.lat, lng: estado.trufis[segundo]!.lng };

    estado = reducer(estado, {
      type: 'despachar-siguiente',
      lineaId: 'z12',
      now: new Date('2026-09-27T10:45:00-04:00').toISOString(),
      salidaId: 'sal-repos-1',
      recorridoId: 'rec-repos-1',
    });

    const posSegundoDespues = { lat: estado.trufis[segundo]!.lat, lng: estado.trufis[segundo]!.lng };
    expect(posSegundoDespues).not.toEqual(posSegundoAntes);
    // Y la cola sigue sin posiciones repetidas.
    const cola = colaDe(estado, 'z12');
    const posiciones = cola.map((id) => `${estado.trufis[id]!.lat},${estado.trufis[id]!.lng}`);
    expect(new Set(posiciones).size).toBe(cola.length);
  });

  it('después de `moverEnCola`, los dos trufis que intercambiaron posición actualizan su marcador', () => {
    let estado = estadoInicial(new Date('2026-09-27T10:45:00-04:00'));
    const cola = colaDe(estado, 'z12');
    expect(cola.length).toBeGreaterThanOrEqual(2);
    const [primero, segundo] = cola;
    const posPrimeroAntes = { lat: estado.trufis[primero!]!.lat, lng: estado.trufis[primero!]!.lng };
    const posSegundoAntes = { lat: estado.trufis[segundo!]!.lat, lng: estado.trufis[segundo!]!.lng };

    estado = reducer(estado, { type: 'mover-en-cola', trufiId: segundo!, delta: -1 });

    expect({ lat: estado.trufis[segundo!]!.lat, lng: estado.trufis[segundo!]!.lng }).toEqual(posPrimeroAntes);
    expect({ lat: estado.trufis[primero!]!.lat, lng: estado.trufis[primero!]!.lng }).toEqual(posSegundoAntes);
  });
});

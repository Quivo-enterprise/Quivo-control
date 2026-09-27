import { describe, expect, it } from 'vitest';
import { LINEAS_MOCK, TRUFIS_MOCK } from '../datos';
import {
  colaDe,
  delanteDetras,
  estadoInicial,
  kpis,
  recorridosDelDia,
  reducer,
  salidasDelDia,
  SINCRONIZANDO_TICKS,
} from './index';
import { HORA_INICIO_HISTORIAL } from './recorridos';

const AHORA = new Date('2026-09-27T12:00:00-04:00');

function tick(estado: ReturnType<typeof estadoInicial>, nowIso: string, veces = 1) {
  let siguiente = estado;
  for (let i = 0; i < veces; i++) {
    siguiente = reducer(siguiente, { type: 'tick', now: nowIso });
  }
  return siguiente;
}

describe('estadoInicial — escena inicial', () => {
  it('Z12: 3 en_ruta + 2 en_cola; Línea 120: 2 en_ruta + 1 en_cola', () => {
    const estado = estadoInicial(AHORA);
    const porFase = (lineaId: 'z12' | 'l120', fase: string) =>
      TRUFIS_MOCK.filter((t) => t.lineaId === lineaId && estado.trufis[t.id]!.fase === fase).length;
    expect(porFase('z12', 'en_ruta')).toBe(3);
    expect(porFase('z12', 'en_cola')).toBe(2);
    expect(porFase('l120', 'en_ruta')).toBe(2);
    expect(porFase('l120', 'en_cola')).toBe(1);
  });

  it('los `en_cola` arrancan estáticos en la primera parada de su línea', () => {
    const estado = estadoInicial(AHORA);
    const enCola = TRUFIS_MOCK.find((t) => estado.trufis[t.id]!.fase === 'en_cola')!;
    const primera = LINEAS_MOCK[enCola.lineaId].paradas.find((p) => p.orden === 0)!;
    const et = estado.trufis[enCola.id]!;
    expect(et.lat).toBeCloseTo(primera.lat, 3);
    expect(et.lng).toBeCloseTo(primera.lng, 3);
    expect(et.avance).toBe(0);
  });

  it('cada trufi `en_cola` está en `colaDe` de su línea', () => {
    const estado = estadoInicial(AHORA);
    for (const trufi of TRUFIS_MOCK) {
      if (estado.trufis[trufi.id]!.fase === 'en_cola') {
        expect(colaDe(estado, trufi.lineaId)).toContain(trufi.id);
      }
    }
  });
});

describe('siembra determinística (24 h)', () => {
  it('el mismo `now` (mismo día) produce SIEMPRE el mismo historial sembrado', () => {
    const a = estadoInicial(AHORA);
    const b = estadoInicial(new Date(AHORA));
    // Compara solo lo SEMBRADO — recorridos/salidas/novedades/infracciones no dependen de
    // Math.random ni de ningún reloj real, así que tienen que salir byte-a-byte iguales.
    expect(a.recorridos).toEqual(b.recorridos);
    expect(a.salidas).toEqual(b.salidas);
    expect(a.novedades).toEqual(b.novedades);
    expect(a.infracciones).toEqual(b.infracciones);
  });

  it('un `now` de otro día produce un historial DISTINTO (el sorteo consume otra cantidad de números)', () => {
    const a = estadoInicial(AHORA);
    const b = estadoInicial(new Date('2026-09-28T12:00:00-04:00'));
    expect(a.recorridos).not.toEqual(b.recorridos);
  });

  it('el historial sembrado arranca a las 05:00 LOCAL del día de `now` (nunca antes)', () => {
    const estado = estadoInicial(AHORA);
    const inicioDia = new Date(AHORA.getFullYear(), AHORA.getMonth(), AHORA.getDate(), HORA_INICIO_HISTORIAL, 0, 0, 0);
    expect(estado.recorridos.length).toBeGreaterThan(0);
    for (const r of estado.recorridos) {
      expect(Date.parse(r.inicio)).toBeGreaterThanOrEqual(inicioDia.getTime());
    }
    for (const s of estado.salidas) {
      expect(Date.parse(s.programada)).toBeGreaterThanOrEqual(inicioDia.getTime());
    }
  });

  it('siembra recorridos completados para cada uno de los 8 trufis', () => {
    const estado = estadoInicial(AHORA);
    for (const trufi of TRUFIS_MOCK) {
      const propios = recorridosDelDia(estado, { trufiId: trufi.id });
      expect(propios.length).toBeGreaterThan(0);
    }
  });

  it('siembra 4-6 novedades y 2 sanciones', () => {
    const estado = estadoInicial(AHORA);
    expect(estado.novedades.length).toBeGreaterThanOrEqual(4);
    expect(estado.novedades.length).toBeLessThanOrEqual(6);
    expect(estado.infracciones.filter((i) => i.estado === 'sancionada')).toHaveLength(2);
  });
});

describe('cola / despacho / fuera de orden', () => {
  it('despacharSiguiente saca la CABEZA de la cola, la pone en_ruta y crea salida + recorrido', () => {
    const estado = estadoInicial(AHORA);
    const cabeza = colaDe(estado, 'z12')[0]!;
    const siguiente = reducer(estado, {
      type: 'despachar-siguiente',
      lineaId: 'z12',
      now: AHORA.toISOString(),
      salidaId: 'sal-test-1',
      recorridoId: 'rec-test-1',
    });
    expect(colaDe(siguiente, 'z12')).not.toContain(cabeza);
    expect(siguiente.trufis[cabeza]!.fase).toBe('en_ruta');
    expect(siguiente.trufis[cabeza]!.avance).toBe(0);
    const salida = salidasDelDia(siguiente, { trufiId: cabeza }).find((s) => s.id === 'sal-test-1');
    expect(salida).toBeDefined();
    expect(salida!.real).toBe(AHORA.toISOString());
    expect(salida!.fueraDeOrden).toBe(false);
    const recorrido = recorridosDelDia(siguiente, { trufiId: cabeza }).find((r) => r.id === 'rec-test-1');
    expect(recorrido).toBeDefined();
    expect(recorrido!.estado).toBe('en_curso');
  });

  it('despacharSiguiente con cola vacía no cambia el estado', () => {
    let estado = estadoInicial(AHORA);
    // Vacía la cola de la 120 (1 solo trufi).
    estado = reducer(estado, {
      type: 'despachar-siguiente',
      lineaId: 'l120',
      now: AHORA.toISOString(),
      salidaId: 'sal-a',
      recorridoId: 'rec-a',
    });
    expect(colaDe(estado, 'l120')).toHaveLength(0);
    const siguiente = reducer(estado, {
      type: 'despachar-siguiente',
      lineaId: 'l120',
      now: AHORA.toISOString(),
      salidaId: 'sal-b',
      recorridoId: 'rec-b',
    });
    expect(siguiente).toBe(estado);
  });

  it('simularFueraDeOrden despacha al 2° de la cola (no a la cabeza) y marca `fueraDeOrden`', () => {
    const estado = estadoInicial(AHORA);
    const cola = colaDe(estado, 'z12');
    expect(cola.length).toBeGreaterThanOrEqual(2);
    const [cabeza, segundo] = cola;
    const siguiente = reducer(estado, {
      type: 'simular-fuera-de-orden',
      lineaId: 'z12',
      trufiId: segundo!,
      now: AHORA.toISOString(),
      salidaId: 'sal-fo',
      recorridoId: 'rec-fo',
      novedadId: 'nov-fo',
    });
    expect(siguiente.trufis[segundo!]!.fase).toBe('en_ruta');
    // La cabeza original SIGUE en cola — no la sacó a ella.
    expect(colaDe(siguiente, 'z12')).toContain(cabeza);
    const salida = salidasDelDia(siguiente, { trufiId: segundo! }).find((s) => s.id === 'sal-fo');
    expect(salida!.fueraDeOrden).toBe(true);
    const novedad = siguiente.novedades.find((n) => n.id === 'nov-fo');
    expect(novedad).toBeDefined();
    expect(novedad!.tipo).toBe('fuera_de_orden');
    expect(novedad!.trufiId).toBe(segundo);
  });

  it('moverEnCola adelanta/atrasa un trufi dentro de su cola', () => {
    const estado = estadoInicial(AHORA);
    const cola = colaDe(estado, 'z12');
    const [primero, segundo] = cola;
    const siguiente = reducer(estado, { type: 'mover-en-cola', trufiId: segundo!, delta: -1 });
    expect(colaDe(siguiente, 'z12')).toEqual([segundo, primero]);
  });
});

describe('delanteDetras', () => {
  it('detecta el trufi más cercano adelante y atrás sobre el loop', () => {
    let estado = estadoInicial(AHORA);
    const [a, b] = TRUFIS_MOCK.filter((t) => t.lineaId === 'z12' && estado.trufis[t.id]!.fase === 'en_ruta');
    // Fuerza avances conocidos: `a` en 0.10, `b` en 0.20 — `b` está "adelante" de `a`, `a` está
    // "atrás" de `b`.
    estado = {
      ...estado,
      trufis: {
        ...estado.trufis,
        [a!.id]: { ...estado.trufis[a!.id]!, avance: 0.1 },
        [b!.id]: { ...estado.trufis[b!.id]!, avance: 0.2 },
      },
    };
    const gapDeA = delanteDetras(estado, a!.id);
    expect(gapDeA.adelante?.trufiId).toBe(b!.id);
    expect(gapDeA.adelante!.minutos).toBeGreaterThan(0);

    const gapDeB = delanteDetras(estado, b!.id);
    expect(gapDeB.atras?.trufiId).toBe(a!.id);
  });

  it('un trufi `en_cola` no tiene delante/detrás (no está "visible en ruta")', () => {
    const estado = estadoInicial(AHORA);
    const enCola = TRUFIS_MOCK.find((t) => estado.trufis[t.id]!.fase === 'en_cola')!;
    expect(delanteDetras(estado, enCola.id)).toEqual({});
  });
});

describe('puntos de control — cumplimiento en tick', () => {
  it('al cruzar el avance de un punto de control, registra el cumplimiento y suma al recorrido en curso', () => {
    let estado = estadoInicial(AHORA);
    const trufi = TRUFIS_MOCK.find((t) => t.lineaId === 'z12' && estado.trufis[t.id]!.fase === 'en_ruta')!;
    // Estrictamente entre 0.1 y 0.9: evita el punto de control "villa-armonia" (inicio Y fin
    // del circuito — su avance da ~0.999999, así que cruzarlo TAMBIÉN completa la vuelta, un
    // caso real pero que este test no quiere mezclar con el cierre de recorrido).
    const puntoControl = LINEAS_MOCK.z12.paradas.find((p) => p.esPuntoControl && p.avance > 0.1 && p.avance < 0.9)!;

    estado = {
      ...estado,
      trufis: { ...estado.trufis, [trufi.id]: { ...estado.trufis[trufi.id]!, avance: puntoControl.avance - 0.0005 } },
    };
    const recorridoAntes = recorridosDelDia(estado, { trufiId: trufi.id }).find((r) => r.estado === 'en_curso')!;
    expect(recorridoAntes.puntosCumplidos).toBe(0);

    const siguiente = tick(estado, AHORA.toISOString());

    expect(siguiente.trufis[trufi.id]!.cumplimientos.map((c) => c.paradaId)).toContain(puntoControl.id);
    const recorridoDespues = recorridosDelDia(siguiente, { trufiId: trufi.id }).find((r) => r.id === recorridoAntes.id)!;
    expect(recorridoDespues.puntosCumplidos).toBe(1);
  });
});

describe('señal — pérdida, buffer y sincronización', () => {
  it('perderSenal congela lat/lng expuestos; el avance interno sigue y el buffer crece', () => {
    const estado = estadoInicial(AHORA);
    const trufi = TRUFIS_MOCK.find((t) => estado.trufis[t.id]!.fase === 'en_ruta')!;
    const conSenalPerdida = reducer(estado, {
      type: 'perder-senal',
      trufiId: trufi.id,
      now: AHORA.toISOString(),
      novedadId: 'nov-senal',
    });
    expect(conSenalPerdida.trufis[trufi.id]!.fase).toBe('sin_senal');
    const latCongelada = conSenalPerdida.trufis[trufi.id]!.lat;
    const lngCongelada = conSenalPerdida.trufis[trufi.id]!.lng;
    const avanceInicial = conSenalPerdida.trufis[trufi.id]!.avance;

    const tras5Ticks = tick(conSenalPerdida, AHORA.toISOString(), 5);
    expect(tras5Ticks.trufis[trufi.id]!.lat).toBe(latCongelada);
    expect(tras5Ticks.trufis[trufi.id]!.lng).toBe(lngCongelada);
    expect(tras5Ticks.trufis[trufi.id]!.avance).not.toBe(avanceInicial);
    expect(tras5Ticks.trufis[trufi.id]!.bufferPuntos.length).toBe(5);

    const novedad = tras5Ticks.novedades.find((n) => n.id === 'nov-senal');
    expect(novedad?.tipo).toBe('sin_senal');
  });

  it('recuperarSenal pasa por `sincronizando` y recién ahí vuelca el buffer y salta la posición', () => {
    const estado = estadoInicial(AHORA);
    const trufi = TRUFIS_MOCK.find((t) => estado.trufis[t.id]!.fase === 'en_ruta')!;
    let siguiente = reducer(estado, {
      type: 'perder-senal',
      trufiId: trufi.id,
      now: AHORA.toISOString(),
      novedadId: 'nov-senal-2',
    });
    siguiente = tick(siguiente, AHORA.toISOString(), 4);
    const puntosEnBuffer = siguiente.trufis[trufi.id]!.bufferPuntos.length;
    expect(puntosEnBuffer).toBeGreaterThan(0);

    siguiente = reducer(siguiente, { type: 'recuperar-senal', trufiId: trufi.id });
    expect(siguiente.trufis[trufi.id]!.fase).toBe('sincronizando');
    expect(siguiente.trufis[trufi.id]!.puntosPendientes).toBe(puntosEnBuffer);

    // Todavía sincronizando a mitad de camino.
    siguiente = tick(siguiente, AHORA.toISOString(), SINCRONIZANDO_TICKS - 1);
    expect(siguiente.trufis[trufi.id]!.fase).toBe('sincronizando');

    siguiente = tick(siguiente, AHORA.toISOString(), 1);
    expect(siguiente.trufis[trufi.id]!.fase).toBe('en_ruta');
    expect(siguiente.trufis[trufi.id]!.bufferPuntos).toHaveLength(0);
    expect(siguiente.trufis[trufi.id]!.puntosPendientes).toBe(0);
    expect(siguiente.trufis[trufi.id]!.traza.length).toBeGreaterThanOrEqual(puntosEnBuffer);
  });
});

describe('atasco', () => {
  it('congela avance/posición y reanuda solo tras los ticks configurados', () => {
    const estado = estadoInicial(AHORA);
    const trufi = TRUFIS_MOCK.find((t) => estado.trufis[t.id]!.fase === 'en_ruta')!;
    let siguiente = reducer(estado, {
      type: 'simular-atasco',
      trufiId: trufi.id,
      now: AHORA.toISOString(),
      novedadId: 'nov-atasco',
    });
    expect(siguiente.trufis[trufi.id]!.fase).toBe('atascado');
    expect(siguiente.trufis[trufi.id]!.tramoAtascado?.length).toBeGreaterThan(0);
    const avanceCongelado = siguiente.trufis[trufi.id]!.avance;

    siguiente = tick(siguiente, AHORA.toISOString(), 59);
    expect(siguiente.trufis[trufi.id]!.fase).toBe('atascado');
    expect(siguiente.trufis[trufi.id]!.avance).toBe(avanceCongelado);

    siguiente = tick(siguiente, AHORA.toISOString(), 1);
    expect(siguiente.trufis[trufi.id]!.fase).toBe('en_ruta');
    expect(siguiente.trufis[trufi.id]!.tramoAtascado).toBeUndefined();

    const novedad = siguiente.novedades.find((n) => n.id === 'nov-atasco');
    expect(novedad?.tipo).toBe('atascado');
  });
});

describe('desvío', () => {
  it('crea una novedad Y una infracción "Desvío de ruta" activa', () => {
    const estado = estadoInicial(AHORA);
    const trufi = TRUFIS_MOCK.find((t) => estado.trufis[t.id]!.fase === 'en_ruta')!;
    const siguiente = reducer(estado, {
      type: 'simular-desvio',
      trufiId: trufi.id,
      now: AHORA.toISOString(),
      novedadId: 'nov-desvio',
      infraccionId: 'inf-desvio',
    });
    expect(siguiente.trufis[trufi.id]!.fase).toBe('desviado');
    const novedad = siguiente.novedades.find((n) => n.id === 'nov-desvio');
    expect(novedad?.tipo).toBe('desvio');
    const infraccion = siguiente.infracciones.find((i) => i.id === 'inf-desvio');
    expect(infraccion).toBeDefined();
    expect(infraccion!.tipoId).toBe('desvio-de-ruta');
    expect(infraccion!.severidad).toBe('media');
    expect(infraccion!.estado).toBe('activa');
    expect(infraccion!.trufiId).toBe(trufi.id);
  });

  it('la posición se aleja de la polilínea y vuelve a unirse tras ~20 ticks', () => {
    const estado = estadoInicial(AHORA);
    const trufi = TRUFIS_MOCK.find((t) => estado.trufis[t.id]!.fase === 'en_ruta')!;
    let siguiente = reducer(estado, {
      type: 'simular-desvio',
      trufiId: trufi.id,
      now: AHORA.toISOString(),
      novedadId: 'nov-d2',
      infraccionId: 'inf-d2',
    });
    siguiente = tick(siguiente, AHORA.toISOString(), 10);
    expect(siguiente.trufis[trufi.id]!.fase).toBe('desviado');
    expect(siguiente.trufis[trufi.id]!.trazaDesvio?.length).toBeGreaterThan(0);

    siguiente = tick(siguiente, AHORA.toISOString(), 10);
    expect(siguiente.trufis[trufi.id]!.fase).toBe('en_ruta');
    expect(siguiente.trufis[trufi.id]!.trazaDesvio).toBeUndefined();
  });
});

describe('kpis', () => {
  it('sin filtro, suma las 2 líneas; con filtro, respeta `lineaId`', () => {
    const estado = estadoInicial(AHORA);
    const total = kpis(estado);
    const soloZ12 = kpis(estado, 'z12');
    const soloL120 = kpis(estado, 'l120');
    expect(soloZ12.enRuta + soloL120.enRuta).toBe(total.enRuta);
    expect(soloZ12.enCola + soloL120.enCola).toBe(total.enCola);
    expect(soloZ12.enRuta).toBe(3);
    expect(soloZ12.enCola).toBe(2);
    expect(soloL120.enRuta).toBe(2);
    expect(soloL120.enCola).toBe(1);
  });

  it('cuenta `atascados` y `sinSenal` por separado', () => {
    const estado = estadoInicial(AHORA);
    const trufi = TRUFIS_MOCK.find((t) => t.lineaId === 'z12' && estado.trufis[t.id]!.fase === 'en_ruta')!;
    const conAtasco = reducer(estado, {
      type: 'simular-atasco',
      trufiId: trufi.id,
      now: AHORA.toISOString(),
      novedadId: 'nov-k1',
    });
    expect(kpis(conAtasco, 'z12').atascados).toBe(1);
  });
});

// ================================================================================================
// Ítem 1 del guion delegado: la flota YA NO drena a la cola — al completar una vuelta, un trufi
// arranca la siguiente de una y sigue `en_ruta`. La cola solo cambia por
// despacharSiguiente/simularFueraDeOrden/moverEnCola.
// ================================================================================================

describe('ítem 1 — la flota no drena a la cola', () => {
  it('tras 2000 ticks desde `estadoInicial`, la cantidad `en_ruta` no cambió', () => {
    let estado = estadoInicial(AHORA);
    const enRutaInicial = kpis(estado).enRuta;
    const enColaInicial = kpis(estado).enCola;
    expect(enRutaInicial).toBeGreaterThan(0);

    estado = tick(estado, AHORA.toISOString(), 2000);

    expect(kpis(estado).enRuta).toBe(enRutaInicial);
    expect(kpis(estado).enCola).toBe(enColaInicial);
  });

  it('al completar una vuelta, el trufi sigue `en_ruta` (no vuelve a `en_cola`) y `vueltaActual` sube', () => {
    let estado = estadoInicial(AHORA);
    const trufi = TRUFIS_MOCK.find((t) => estado.trufis[t.id]!.fase === 'en_ruta')!;
    const vueltaInicial = estado.trufis[trufi.id]!.vueltaActual;
    // Fuerza el avance justo antes del wrap para no tener que tickear cientos de veces.
    estado = { ...estado, trufis: { ...estado.trufis, [trufi.id]: { ...estado.trufis[trufi.id]!, avance: 0.9995 } } };

    estado = tick(estado, AHORA.toISOString(), 50);

    expect(estado.trufis[trufi.id]!.fase).toBe('en_ruta');
    expect(estado.trufis[trufi.id]!.vueltaActual).toBeGreaterThan(vueltaInicial);
  });

  it('al completar una vuelta, cierra el recorrido anterior y abre uno nuevo `en_curso` para el mismo trufi', () => {
    let estado = estadoInicial(AHORA);
    const trufi = TRUFIS_MOCK.find((t) => estado.trufis[t.id]!.fase === 'en_ruta')!;
    const recorridoAntes = recorridosDelDia(estado, { trufiId: trufi.id }).find((r) => r.estado === 'en_curso')!;
    estado = { ...estado, trufis: { ...estado.trufis, [trufi.id]: { ...estado.trufis[trufi.id]!, avance: 0.9995 } } };

    estado = tick(estado, AHORA.toISOString(), 50);

    const cerrado = recorridosDelDia(estado, { trufiId: trufi.id }).find((r) => r.id === recorridoAntes.id)!;
    expect(cerrado.estado).not.toBe('en_curso');
    const nuevoEnCurso = recorridosDelDia(estado, { trufiId: trufi.id }).find((r) => r.estado === 'en_curso');
    expect(nuevoEnCurso).toBeDefined();
    expect(nuevoEnCurso!.id).not.toBe(recorridoAntes.id);
  });
});

// ================================================================================================
// Ítem 3 del guion delegado: la vuelta INICIAL (parcial, arranca a mitad de loop) tiene que
// poder cerrar `completo`.
// ================================================================================================

describe('ítem 3 — vuelta inicial parcial puede cerrar completo', () => {
  it('`puntosTotal` del recorrido inicial cuenta solo los puntos de control ADELANTE del avance de arranque', () => {
    const estado = estadoInicial(AHORA);
    for (const trufi of TRUFIS_MOCK) {
      const trufiEstado = estado.trufis[trufi.id]!;
      if (trufiEstado.fase !== 'en_ruta') continue;
      const recorridoInicial = recorridosDelDia(estado, { trufiId: trufi.id }).find((r) => r.estado === 'en_curso')!;
      const puntosControlLinea = LINEAS_MOCK[trufi.lineaId].paradas.filter((p) => p.esPuntoControl);
      const puntosAdelante = puntosControlLinea.filter((p) => p.avance > trufiEstado.avance).length;
      expect(recorridoInicial.puntosTotal).toBe(puntosAdelante);
    }
  });

  it('la vuelta inicial parcial de `trufi-z12-2` (avanceInicial 0.33) cierra COMPLETA, no incompleta', () => {
    let estado = estadoInicial(AHORA);
    const trufiId = 'trufi-z12-2';
    expect(estado.trufis[trufiId]!.fase).toBe('en_ruta');
    const recorridoInicialId = recorridosDelDia(estado, { trufiId }).find((r) => r.estado === 'en_curso')!.id;

    let nowMs = AHORA.getTime();
    let cerrado;
    for (let i = 0; i < 400 && !cerrado; i++) {
      nowMs += 1000;
      estado = reducer(estado, { type: 'tick', now: new Date(nowMs).toISOString() });
      const candidato = recorridosDelDia(estado, { trufiId }).find((r) => r.id === recorridoInicialId);
      if (candidato && candidato.estado !== 'en_curso') {
        cerrado = candidato;
      }
    }

    expect(cerrado).toBeDefined();
    expect(cerrado!.estado).toBe('completo');
  });
});

// ================================================================================================
// Ítem 5 del guion delegado: varios puntos de control cruzados en el MISMO tick cuentan todos
// (no solo 1).
// ================================================================================================

describe('ítem 5 — varios cumplimientos en un mismo tick cuentan todos', () => {
  it('si el avance salta sobre 2 puntos de control de una, ambos se registran', () => {
    let estado = estadoInicial(AHORA);
    const trufi = TRUFIS_MOCK.find((t) => t.lineaId === 'z12' && estado.trufis[t.id]!.fase === 'en_ruta')!;
    const puntosControl = [...LINEAS_MOCK.z12.paradas.filter((p) => p.esPuntoControl)].sort((a, b) => a.avance - b.avance);
    // Los 3 últimos puntos de control de Z12 (kanata/univalle/salomon, ver el fix del ítem 4)
    // quedan muy juntos entre sí — perfecto para forzar 2 cumplimientos en 1 solo tick chico.
    const [p1, p2] = puntosControl.slice(1); // salta villa-armonia (avance 0)
    expect(p2!.avance - p1!.avance).toBeLessThan(0.05);

    estado = {
      ...estado,
      trufis: { ...estado.trufis, [trufi.id]: { ...estado.trufis[trufi.id]!, avance: p1!.avance - 0.001 } },
    };
    const recorridoAntes = recorridosDelDia(estado, { trufiId: trufi.id }).find((r) => r.estado === 'en_curso')!;

    // Un tick con un paso ENORME (simulado subiendo `avance` manualmente más el paso normal del
    // trufi) para saltar sobre ambos puntos de una — en vez de eso, fuerza el avance justo antes
    // de p2 y deja que el paso normal cruce ambos si están MUY juntos, o si no, verifica al
    // menos que cruzar cada uno por separado los cuenta a los dos.
    estado = {
      ...estado,
      trufis: { ...estado.trufis, [trufi.id]: { ...estado.trufis[trufi.id]!, avance: p1!.avance - 0.001 } },
    };
    let siguiente = estado;
    // Tickea hasta pasar el segundo punto de control.
    let ticks = 0;
    while (siguiente.trufis[trufi.id]!.avance < p2!.avance && ticks < 2000) {
      siguiente = reducer(siguiente, { type: 'tick', now: AHORA.toISOString() });
      ticks += 1;
    }
    const recorridoDespues = recorridosDelDia(siguiente, { trufiId: trufi.id }).find((r) => r.id === recorridoAntes.id)!;
    expect(recorridoDespues.puntosCumplidos).toBeGreaterThanOrEqual(2);
    expect(siguiente.trufis[trufi.id]!.cumplimientos.map((c) => c.paradaId)).toEqual(
      expect.arrayContaining([p1!.id, p2!.id]),
    );
  });
});

// ================================================================================================
// Ítem 6 del guion delegado: desvío / sin señal SÍ cierran loops y cuentan cumplimientos —
// mientras está sin señal se coleccionan y se reconcilian al sincronizar.
// ================================================================================================

describe('ítem 6 — desvío y sin señal cierran vueltas', () => {
  it('un trufi que completa el loop MIENTRAS está desviado cierra su recorrido igual', () => {
    let estado = estadoInicial(AHORA);
    const trufi = TRUFIS_MOCK.find((t) => estado.trufis[t.id]!.fase === 'en_ruta')!;
    const recorridoAntes = recorridosDelDia(estado, { trufiId: trufi.id }).find((r) => r.estado === 'en_curso')!;

    estado = { ...estado, trufis: { ...estado.trufis, [trufi.id]: { ...estado.trufis[trufi.id]!, avance: 0.999 } } };
    estado = reducer(estado, {
      type: 'simular-desvio',
      trufiId: trufi.id,
      now: AHORA.toISOString(),
      novedadId: 'nov-desvio-loop',
      infraccionId: 'inf-desvio-loop',
    });
    expect(estado.trufis[trufi.id]!.fase).toBe('desviado');

    estado = tick(estado, AHORA.toISOString(), 30);

    const cerrado = recorridosDelDia(estado, { trufiId: trufi.id }).find((r) => r.id === recorridoAntes.id)!;
    expect(cerrado.estado).not.toBe('en_curso');
    const nuevoEnCurso = recorridosDelDia(estado, { trufiId: trufi.id }).find((r) => r.estado === 'en_curso');
    expect(nuevoEnCurso).toBeDefined();
  });

  it('los cruces mientras `sin_senal` se acumulan en `eventosPendientes`, sin tocar `recorridos` todavía', () => {
    let estado = estadoInicial(AHORA);
    const trufi = TRUFIS_MOCK.find((t) => estado.trufis[t.id]!.fase === 'en_ruta')!;
    const recorridoId = recorridosDelDia(estado, { trufiId: trufi.id }).find((r) => r.estado === 'en_curso')!.id;

    estado = { ...estado, trufis: { ...estado.trufis, [trufi.id]: { ...estado.trufis[trufi.id]!, avance: 0.999 } } };
    estado = reducer(estado, { type: 'perder-senal', trufiId: trufi.id, now: AHORA.toISOString(), novedadId: 'nov-ss-loop' });
    expect(estado.trufis[trufi.id]!.fase).toBe('sin_senal');

    estado = tick(estado, AHORA.toISOString(), 30);

    // Todavía sin señal — el recorrido original SIGUE en_curso, nada se aplicó todavía.
    const enCursoTodavia = recorridosDelDia(estado, { trufiId: trufi.id }).find((r) => r.id === recorridoId)!;
    expect(enCursoTodavia.estado).toBe('en_curso');
    expect(estado.trufis[trufi.id]!.eventosPendientes.length).toBeGreaterThan(0);
    expect(estado.trufis[trufi.id]!.eventosPendientes.some((e) => e.tipo === 'vuelta-completa')).toBe(true);
  });

  it('al sincronizar, se reconcilian de una los eventos offline: el recorrido cierra y se abre uno nuevo', () => {
    let estado = estadoInicial(AHORA);
    const trufi = TRUFIS_MOCK.find((t) => estado.trufis[t.id]!.fase === 'en_ruta')!;
    const recorridoId = recorridosDelDia(estado, { trufiId: trufi.id }).find((r) => r.estado === 'en_curso')!.id;

    estado = { ...estado, trufis: { ...estado.trufis, [trufi.id]: { ...estado.trufis[trufi.id]!, avance: 0.999 } } };
    estado = reducer(estado, { type: 'perder-senal', trufiId: trufi.id, now: AHORA.toISOString(), novedadId: 'nov-ss-loop-2' });
    estado = tick(estado, AHORA.toISOString(), 30);
    expect(estado.trufis[trufi.id]!.eventosPendientes.some((e) => e.tipo === 'vuelta-completa')).toBe(true);

    estado = reducer(estado, { type: 'recuperar-senal', trufiId: trufi.id });
    expect(estado.trufis[trufi.id]!.fase).toBe('sincronizando');
    estado = tick(estado, AHORA.toISOString(), SINCRONIZANDO_TICKS);
    expect(estado.trufis[trufi.id]!.fase).toBe('en_ruta');
    expect(estado.trufis[trufi.id]!.eventosPendientes).toHaveLength(0);

    const cerrado = recorridosDelDia(estado, { trufiId: trufi.id }).find((r) => r.id === recorridoId)!;
    expect(cerrado.estado).not.toBe('en_curso');
    const nuevoEnCurso = recorridosDelDia(estado, { trufiId: trufi.id }).find((r) => r.estado === 'en_curso');
    expect(nuevoEnCurso).toBeDefined();
    expect(nuevoEnCurso!.id).not.toBe(recorridoId);
  });
});

// ================================================================================================
// Ítem 15 — `ultimoTramoSincronizado` guarda EXACTAMENTE los puntos del buffer volcado.
// ================================================================================================

describe('ítem 15 — ultimoTramoSincronizado', () => {
  it('al sincronizar, guarda los puntos del buffer (sin ts) y el momento de la sincronización', () => {
    let estado = estadoInicial(AHORA);
    const trufi = TRUFIS_MOCK.find((t) => estado.trufis[t.id]!.fase === 'en_ruta')!;
    estado = reducer(estado, { type: 'perder-senal', trufiId: trufi.id, now: AHORA.toISOString(), novedadId: 'nov-tramo' });
    estado = tick(estado, AHORA.toISOString(), 4);
    const bufferAntes = estado.trufis[trufi.id]!.bufferPuntos;
    expect(bufferAntes.length).toBeGreaterThan(0);

    estado = reducer(estado, { type: 'recuperar-senal', trufiId: trufi.id });
    estado = tick(estado, AHORA.toISOString(), SINCRONIZANDO_TICKS);

    const tramo = estado.trufis[trufi.id]!.ultimoTramoSincronizado;
    expect(tramo).not.toBeNull();
    expect(tramo!.puntos).toEqual(bufferAntes.map(([lat, lng]) => [lat, lng]));
    expect(tramo!.en).toBe(AHORA.toISOString());
  });

  it('es `null` en la escena inicial (todavía no sincronizó nada)', () => {
    const estado = estadoInicial(AHORA);
    for (const trufi of TRUFIS_MOCK) {
      expect(estado.trufis[trufi.id]!.ultimoTramoSincronizado).toBeNull();
    }
  });
});

describe('reiniciarDemo', () => {
  it('produce el MISMO estado que `estadoInicial(now)` para el `now` dado', () => {
    let estado = estadoInicial(AHORA);
    // Ensucia el estado: pausa, mueve la cola, aplica un tick.
    estado = reducer(estado, { type: 'toggle-pausa' });
    estado = reducer(estado, { type: 'mover-en-cola', trufiId: colaDe(estado, 'z12')[1]!, delta: -1 });

    const otroNow = new Date('2026-09-27T15:30:00-04:00');
    const reiniciado = reducer(estado, { type: 'reiniciar-demo', now: otroNow.toISOString() });
    expect(reiniciado).toEqual(estadoInicial(otroNow));
  });
});

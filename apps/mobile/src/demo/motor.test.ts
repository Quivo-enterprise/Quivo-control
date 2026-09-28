import { describe, expect, it } from 'vitest';
import {
  acercarAdelante,
  adelanteAtras,
  colaDe,
  crearEstadoInicial,
  crearReporte,
  finalizarJornada,
  FRECUENCIA_MS,
  iniciarJornada,
  otrosVehiculos,
  perderSenal,
  posicionDe,
  proximaSalidaDe,
  recuperarSenal,
  reiniciar,
  saltarAlProximoPunto,
  tick,
  type EstadoMotorDemo,
} from './motor';
import { LINEAS_MOCK, TRUFIS_MOCK } from './datos/datos';
import { largoTotalM } from './datos/geometria';

const AHORA_0 = new Date('2026-09-27T07:00:00.000Z').getTime();
const TRUFI_PROPIO = 'trufi-z12-3'; // 3ª de 5 en Z12 — misma unidad jugable que `cuentas.ts`
const VELOCIDAD_NOMINAL_MPS_TEST = (20 * 1000) / 3600; // igual a la constante privada de motor.ts

/** Avanza el motor en pasos de 1s REAL (mismo cadencia que `demo-provider.tsx`) — nunca en
 * pasos más grandes que `DT_MAXIMO_S` (5s), que `tick()` clampa internamente. */
function avanzar(estado: EstadoMotorDemo, segundosReales: number): EstadoMotorDemo {
  let siguiente = estado;
  for (let t = 1; t <= segundosReales; t += 1) {
    siguiente = tick(siguiente, estado.ahora + t * 1000);
  }
  return siguiente;
}

describe('crearEstadoInicial', () => {
  it('arranca la unidad propia en_cola, al frente de la cola de su línea', () => {
    const estado = crearEstadoInicial(TRUFI_PROPIO, AHORA_0);
    expect(estado.unidades[TRUFI_PROPIO]?.fase).toBe('en_cola');
    expect(colaDe(estado, 'z12')[0]).toBe(TRUFI_PROPIO);
  });

  it('las unidades que salen antes (z12-1, z12-2) ya están en_ruta', () => {
    const estado = crearEstadoInicial(TRUFI_PROPIO, AHORA_0);
    expect(estado.unidades['trufi-z12-1']?.fase).toBe('en_ruta');
    expect(estado.unidades['trufi-z12-2']?.fase).toBe('en_ruta');
  });

  it('las unidades que salen después (z12-4, z12-5) quedan en_cola detrás', () => {
    const estado = crearEstadoInicial(TRUFI_PROPIO, AHORA_0);
    expect(colaDe(estado, 'z12')).toEqual([TRUFI_PROPIO, 'trufi-z12-4', 'trufi-z12-5']);
  });

  it('siempre hay una unidad adelante disponible en la línea propia', () => {
    const estado = iniciarJornada(crearEstadoInicial(TRUFI_PROPIO, AHORA_0), AHORA_0);
    const { adelante } = adelanteAtras(estado, TRUFI_PROPIO);
    expect(adelante).toBeDefined();
  });

  // FIX POST-REVISIÓN (hallazgo en teléfono real): antes la unidad más cercana adelante arrancaba
  // a ~11 km en Z12 (fracción arbitraria del largo total de la polilínea, ~38 km) — demasiado
  // lejos para verse en cámara. Ahora el espaciado sale de la FRECUENCIA de la línea × la
  // velocidad nominal (ver el docblock de `crearEstadoInicial`), así que la unidad más cercana
  // adelante queda dentro de un rango realista apenas arranca la jornada. Se prueban las DOS
  // líneas (Z12 con `TRUFI_PROPIO`, Línea 120 con la unidad jugable `trufi-l120-2` de
  // `cuentas.ts`) para no dejar sin cubrir la línea que ningún otro test ejercita como "propia".
  it('la unidad más cercana adelante arranca a una distancia realista (no a fracciones arbitrarias del largo total), en ambas líneas', () => {
    const estadoZ12 = iniciarJornada(crearEstadoInicial(TRUFI_PROPIO, AHORA_0), AHORA_0);
    const { adelante: adelanteZ12 } = adelanteAtras(estadoZ12, TRUFI_PROPIO);
    expect(adelanteZ12).toBeDefined();
    expect(adelanteZ12!.distanciaM).toBeGreaterThanOrEqual(1500);
    expect(adelanteZ12!.distanciaM).toBeLessThanOrEqual(4000);

    const TRUFI_PROPIO_L120 = 'trufi-l120-2'; // misma unidad jugable que `cuentas.ts`
    const estadoL120 = iniciarJornada(crearEstadoInicial(TRUFI_PROPIO_L120, AHORA_0), AHORA_0);
    const { adelante: adelanteL120 } = adelanteAtras(estadoL120, TRUFI_PROPIO_L120);
    expect(adelanteL120).toBeDefined();
    expect(adelanteL120!.distanciaM).toBeGreaterThanOrEqual(1500);
    expect(adelanteL120!.distanciaM).toBeLessThanOrEqual(4000);
  });

  it('preserva el orden: la unidad que salió antes queda siempre más avanzada que la que salió después', () => {
    const estado = crearEstadoInicial(TRUFI_PROPIO, AHORA_0);
    // z12-1 salió 2 períodos antes de la propia (z12-3); z12-2 salió 1 período antes — z12-1
    // tiene que quedar MÁS avanzada que z12-2, nunca al revés.
    expect(estado.unidades['trufi-z12-1']!.avance).toBeGreaterThan(estado.unidades['trufi-z12-2']!.avance);
  });
});

describe('iniciarJornada / finalizarJornada', () => {
  it('saca a la unidad propia de la cola y la pone en_ruta con tracking activo', () => {
    const inicial = crearEstadoInicial(TRUFI_PROPIO, AHORA_0);
    const estado = iniciarJornada(inicial, AHORA_0);
    expect(estado.tracking).toBe(true);
    expect(estado.unidades[TRUFI_PROPIO]?.fase).toBe('en_ruta');
    expect(colaDe(estado, 'z12')).not.toContain(TRUFI_PROPIO);
  });

  it('el próximo de la cola sale automáticamente unos minutos simulados después', () => {
    const inicial = crearEstadoInicial(TRUFI_PROPIO, AHORA_0);
    let estado = iniciarJornada(inicial, AHORA_0);
    const proximoId = colaDe(estado, 'z12')[0]!;
    expect(estado.unidades[proximoId]?.fase).toBe('en_cola');

    // Avanza hasta después de una frecuencia — debería haber despachado al próximo.
    estado = avanzar(estado, FRECUENCIA_MS.z12 / 1000 + 5);
    expect(estado.unidades[proximoId]?.fase).toBe('en_ruta');
  });

  it('finalizarJornada detiene tracking y marca finalizado', () => {
    const estado = finalizarJornada(iniciarJornada(crearEstadoInicial(TRUFI_PROPIO, AHORA_0), AHORA_0), AHORA_0 + 1000);
    expect(estado.tracking).toBe(false);
    expect(estado.unidades[TRUFI_PROPIO]?.fase).toBe('finalizado');
  });

  it('es no-op si la unidad propia no está en la fase esperada', () => {
    const inicial = crearEstadoInicial(TRUFI_PROPIO, AHORA_0);
    const sinIniciar = finalizarJornada(inicial, AHORA_0); // no está en_ruta todavía
    expect(sinIniciar.unidades[TRUFI_PROPIO]?.fase).toBe('en_cola');

    const enRuta = iniciarJornada(inicial, AHORA_0);
    const dobleIniciar = iniciarJornada(enRuta, AHORA_0 + 1000); // ya está en_ruta
    expect(dobleIniciar.unidades[TRUFI_PROPIO]).toEqual(enRuta.unidades[TRUFI_PROPIO]);
  });
});

describe('adelanteAtras', () => {
  it('la distancia adelante baja con acercarAdelante', () => {
    let estado = iniciarJornada(crearEstadoInicial(TRUFI_PROPIO, AHORA_0), AHORA_0);
    const antes = adelanteAtras(estado, TRUFI_PROPIO).adelante!;
    estado = acercarAdelante(estado);
    const despues = adelanteAtras(estado, TRUFI_PROPIO).adelante!;
    expect(despues.distanciaM).toBeLessThan(antes.distanciaM);
  });

  it('atrás cae a la cola (enCola + saleA) cuando nadie salió detrás todavía', () => {
    const estado = iniciarJornada(crearEstadoInicial(TRUFI_PROPIO, AHORA_0), AHORA_0);
    const { atras } = adelanteAtras(estado, TRUFI_PROPIO);
    expect(atras?.enCola).toBe(true);
    expect(atras?.saleA).toBeTypeOf('number');
  });

  it('atrás pasa a ser una unidad en_ruta real una vez que el próximo sale', () => {
    let estado = iniciarJornada(crearEstadoInicial(TRUFI_PROPIO, AHORA_0), AHORA_0);
    estado = avanzar(estado, FRECUENCIA_MS.z12 / 1000 + 5);
    const { atras } = adelanteAtras(estado, TRUFI_PROPIO);
    expect(atras?.enCola).toBeUndefined();
  });

  it('vacío si la unidad no está en_ruta', () => {
    const estado = crearEstadoInicial(TRUFI_PROPIO, AHORA_0);
    expect(adelanteAtras(estado, TRUFI_PROPIO)).toEqual({});
  });
});

describe('cola / horarios', () => {
  it('colaDe respeta el orden de TRUFIS_MOCK', () => {
    const estado = crearEstadoInicial(TRUFI_PROPIO, AHORA_0);
    expect(colaDe(estado, 'z12')).toEqual([TRUFI_PROPIO, 'trufi-z12-4', 'trufi-z12-5']);
  });

  it('proximaSalidaDe crece por posición en la cola, separado por la frecuencia de la línea', () => {
    const estado = crearEstadoInicial(TRUFI_PROPIO, AHORA_0);
    const salidaPropia = proximaSalidaDe(estado, TRUFI_PROPIO)!;
    const salidaSiguiente = proximaSalidaDe(estado, 'trufi-z12-4')!;
    expect(salidaSiguiente - salidaPropia).toBe(FRECUENCIA_MS.z12);
  });

  it('proximaSalidaDe es null para una unidad que ya está en ruta', () => {
    const estado = crearEstadoInicial(TRUFI_PROPIO, AHORA_0);
    expect(proximaSalidaDe(estado, 'trufi-z12-1')).toBeNull();
  });
});

describe('señal / buffer offline', () => {
  it('puntosPendientes solo sube con tracking activo Y sin señal', () => {
    const sinTracking = perderSenal(crearEstadoInicial(TRUFI_PROPIO, AHORA_0));
    const trasTickSinTracking = tick(sinTracking, AHORA_0 + 20_000);
    expect(trasTickSinTracking.puntosPendientes).toBe(0);

    let conTracking = iniciarJornada(crearEstadoInicial(TRUFI_PROPIO, AHORA_0), AHORA_0);
    conTracking = perderSenal(conTracking);
    conTracking = avanzar(conTracking, 20);
    expect(conTracking.puntosPendientes).toBeGreaterThan(0);
  });

  it('recuperarSenal pasa por sincronizando y vuelve a ok tras ~3s (escalado por velocidad)', () => {
    let estado = iniciarJornada(crearEstadoInicial(TRUFI_PROPIO, AHORA_0), AHORA_0);
    estado = perderSenal(estado);
    estado = avanzar(estado, 10);
    expect(estado.puntosPendientes).toBeGreaterThan(0);

    estado = recuperarSenal(estado, estado.ahora);
    expect(estado.senal).toBe('sincronizando');

    estado = tick(estado, estado.ahora + 1_000);
    expect(estado.senal).toBe('sincronizando'); // todavía no pasaron los 3s

    estado = tick(estado, estado.ahora + 3_000);
    expect(estado.senal).toBe('ok');
    expect(estado.puntosPendientes).toBe(0);
  });

  it('la sincronización marca los reportes pendientes como enviados', () => {
    let estado = iniciarJornada(crearEstadoInicial(TRUFI_PROPIO, AHORA_0), AHORA_0);
    estado = perderSenal(estado);
    estado = crearReporte(estado, { tipo: 'pinchazo' }, estado.ahora, 'reporte-1');
    expect(estado.reportes[0]?.estado).toBe('pendiente');

    estado = recuperarSenal(estado, estado.ahora);
    estado = tick(estado, estado.ahora + 5_000);
    expect(estado.reportes[0]?.estado).toBe('enviado');
  });

  it('un reporte creado con señal ok se marca enviado de inmediato', () => {
    const estado = crearReporte(
      iniciarJornada(crearEstadoInicial(TRUFI_PROPIO, AHORA_0), AHORA_0),
      { tipo: 'otro', nota: 'prueba' },
      AHORA_0,
      'reporte-2',
    );
    expect(estado.reportes[0]?.estado).toBe('enviado');
  });
});

describe('puntos de control', () => {
  // FIX POST-REVISIÓN: `iniciarJornada` ahora marca el punto de control del ORIGEN (avance 0,
  // `villa-armonia` en Z12) como cumplido de una — ver el describe "punto de control del origen"
  // más abajo. Por eso `puntosCumplidos` arranca en 1 (el origen) ANTES de que `saltarAlProximoPunto`
  // + `avanzar` sumen el segundo (`univalle`), no en 0.
  it('saltarAlProximoPunto + tick dispara ultimaDeteccion una sola vez por punto', () => {
    let estado = iniciarJornada(crearEstadoInicial(TRUFI_PROPIO, AHORA_0), AHORA_0);
    estado = saltarAlProximoPunto(estado);
    estado = avanzar(estado, 10);
    expect(estado.ultimaDeteccion).not.toBeNull();
    expect(estado.puntosCumplidos).toHaveLength(2); // origen (iniciarJornada) + univalle (este cruce)
    const primeraDeteccion = estado.ultimaDeteccion;

    // Seguir avanzando un poco más no debe volver a disparar el MISMO punto.
    estado = tick(estado, estado.ahora + 2_000);
    expect(estado.ultimaDeteccion).toEqual(primeraDeteccion);
  });

  it('la pasada del punto de control incrementa en una jornada nueva', () => {
    let estado = iniciarJornada(crearEstadoInicial(TRUFI_PROPIO, AHORA_0), AHORA_0);
    estado = saltarAlProximoPunto(estado);
    estado = avanzar(estado, 10);
    const primeraPasada = estado.ultimaDeteccion?.pasada;
    expect(primeraPasada).toBe(1);

    estado = finalizarJornada(estado, estado.ahora);
    // Simula que el motor completa otra vuelta manualmente para la prueba: forzar en_cola de
    // nuevo y reiniciar jornada sobre el mismo punto.
    estado = { ...estado, unidades: { ...estado.unidades, [TRUFI_PROPIO]: { ...estado.unidades[TRUFI_PROPIO]!, fase: 'en_cola', avance: 0 } } };
    estado = iniciarJornada(estado, estado.ahora);
    estado = saltarAlProximoPunto(estado);
    estado = avanzar(estado, 10);
    expect(estado.ultimaDeteccion?.pasada).toBe(2);
  });
});

describe('unidades ajenas', () => {
  it('una unidad que termina la vuelta (avance >= 1) recicla al fondo de la cola', () => {
    let estado = crearEstadoInicial(TRUFI_PROPIO, AHORA_0);
    const adelanteId = 'trufi-z12-1'; // la más avanzada al arrancar (avance inicial 0.6)
    const faltante = 1 - estado.unidades[adelanteId]!.avance;
    const largoTotal = largoTotalM(LINEAS_MOCK.z12.polilinea);
    const segundosParaCompletar = Math.ceil((faltante * largoTotal) / VELOCIDAD_NOMINAL_MPS_TEST) + 5;
    estado = avanzar(estado, segundosParaCompletar);
    expect(estado.unidades[adelanteId]?.fase).toBe('en_cola');
    expect(colaDe(estado, 'z12')).toContain(adelanteId);
  });
});

describe('posicionDe / otrosVehiculos', () => {
  it('devuelve una posición válida sobre la polilínea de la línea', () => {
    const estado = crearEstadoInicial(TRUFI_PROPIO, AHORA_0);
    const posicion = posicionDe(estado, 'trufi-z12-1');
    expect(posicion).not.toBeNull();
    expect(posicion!.lat).toBeCloseTo(LINEAS_MOCK.z12.polilinea[0]![0]!, 0);
  });

  it('otrosVehiculos excluye a la unidad propia y a las que no están en_ruta', () => {
    const estado = iniciarJornada(crearEstadoInicial(TRUFI_PROPIO, AHORA_0), AHORA_0);
    const otros = otrosVehiculos(estado, 'z12');
    expect(otros.some((v) => v.trufiId === TRUFI_PROPIO)).toBe(false);
    expect(otros.every((v) => TRUFIS_MOCK.find((t) => t.id === v.trufiId)?.lineaId === 'z12')).toBe(true);
  });
});

describe('reiniciar', () => {
  it('vuelve exactamente al escenario inicial para la misma unidad propia', () => {
    let estado = iniciarJornada(crearEstadoInicial(TRUFI_PROPIO, AHORA_0), AHORA_0);
    estado = perderSenal(estado);
    estado = avanzar(estado, 30);
    estado = crearReporte(estado, { tipo: 'bloqueo_via' }, estado.ahora, 'reporte-3');

    const reiniciado = reiniciar(estado, AHORA_0 + 60_000);
    expect(reiniciado).toEqual(crearEstadoInicial(TRUFI_PROPIO, AHORA_0 + 60_000));
  });
});

describe('velocidad demo', () => {
  it('acelera el avance de las unidades en_ruta', () => {
    const base = iniciarJornada(crearEstadoInicial(TRUFI_PROPIO, AHORA_0), AHORA_0);
    const normal = tick(base, base.ahora + 10_000);
    const rapido = tick({ ...base, velocidadDemo: 4 }, base.ahora + 10_000);
    expect(rapido.unidades[TRUFI_PROPIO]!.avance).toBeGreaterThan(normal.unidades[TRUFI_PROPIO]!.avance);
  });

  // FIX POST-REVISIÓN (hallazgo de revisión — "el espaciado de despacho no escala con la
  // velocidad"): antes `despacharPendientes` comparaba contra el `ahora` REAL — con velocidad ×4
  // las unidades avanzaban 4× más rápido por su polilínea pero la cola seguía tardando los mismos
  // minutos REALES de siempre en despachar al siguiente. `ahoraSimulado` (ver su docblock en
  // `EstadoMotorDemo`) corrige eso: a velocidad ×4, una frecuencia de línea tarda 1/4 del tiempo
  // REAL en cumplirse.
  it('a velocidad ×4 el próximo de la cola se despacha en 1/4 del tiempo real', () => {
    const inicial = crearEstadoInicial(TRUFI_PROPIO, AHORA_0);
    // índice 0 de `inicial` es la propia (todavía no arrancó) — el "próximo" real es el índice 1,
    // que queda en el índice 0 recién DESPUÉS de que `iniciarJornada` saca a la propia de la cola.
    const proximoId = colaDe(inicial, 'z12')[1]!;
    let estado: EstadoMotorDemo = { ...iniciarJornada(inicial, AHORA_0), velocidadDemo: 4 };

    // Justo antes de 1/4 de la frecuencia real: todavía no debería haber despachado.
    const segundosJustoAntes = Math.floor(FRECUENCIA_MS.z12 / 1000 / 4) - 2;
    estado = avanzar(estado, segundosJustoAntes);
    expect(estado.unidades[proximoId]?.fase).toBe('en_cola');

    // Pasado 1/4 del tiempo real (4 segundos reales más) — a ×4 eso equivale a una frecuencia
    // simulada completa — ya debería haber despachado.
    estado = avanzar(estado, 5);
    expect(estado.unidades[proximoId]?.fase).toBe('en_ruta');
  });

  it('cambiar de velocidad a mitad de la espera no re-escala lo ya recorrido (solo el tramo que falta)', () => {
    const inicial = crearEstadoInicial(TRUFI_PROPIO, AHORA_0);
    const proximoId = colaDe(inicial, 'z12')[1]!;
    let estado = iniciarJornada(inicial, AHORA_0);

    // Primera mitad de la frecuencia a velocidad ×1 (tiempo real == tiempo simulado).
    estado = avanzar(estado, FRECUENCIA_MS.z12 / 1000 / 2);
    expect(estado.unidades[proximoId]?.fase).toBe('en_cola');

    // Cambia a ×4 para lo que falta — la segunda mitad, ahora a 4×, debería alcanzar para
    // completar la frecuencia simulada completa (le faltaba medio tramo real, a ×4 alcanza de sobra).
    estado = { ...estado, velocidadDemo: 4 };
    estado = avanzar(estado, FRECUENCIA_MS.z12 / 1000 / 2 / 4 + 2);
    expect(estado.unidades[proximoId]?.fase).toBe('en_ruta');
  });
});

describe('iniciarJornada — punto de control del origen', () => {
  it('marca el punto de control del origen (avance 0) como cumplido de una, sin esperar un cruce', () => {
    const paradaOrigenZ12 = LINEAS_MOCK.z12.paradas.find((p) => p.avance === 0)!;
    expect(paradaOrigenZ12.esPuntoControl).toBe(true); // confirma el fixture de datos usado por el test

    const estado = iniciarJornada(crearEstadoInicial(TRUFI_PROPIO, AHORA_0), AHORA_0);
    expect(estado.puntosCumplidos).toEqual([paradaOrigenZ12.id]);
    expect(estado.ultimaDeteccion).toEqual({
      puntoControlId: paradaOrigenZ12.id,
      distanciaM: 0,
      pasada: 1,
      en: AHORA_0,
    });
  });

  it('la pasada del punto de control del origen incrementa en cada jornada nueva', () => {
    const paradaOrigenZ12 = LINEAS_MOCK.z12.paradas.find((p) => p.avance === 0)!;
    let estado = iniciarJornada(crearEstadoInicial(TRUFI_PROPIO, AHORA_0), AHORA_0);
    expect(estado.ultimaDeteccion?.pasada).toBe(1);

    estado = finalizarJornada(estado, estado.ahora);
    estado = {
      ...estado,
      unidades: { ...estado.unidades, [TRUFI_PROPIO]: { ...estado.unidades[TRUFI_PROPIO]!, fase: 'en_cola', avance: 0 } },
    };
    estado = iniciarJornada(estado, estado.ahora + 1000);
    expect(estado.ultimaDeteccion?.puntoControlId).toBe(paradaOrigenZ12.id);
    expect(estado.ultimaDeteccion?.pasada).toBe(2);
  });
});

describe('iniciarJornada — no libera un backlog de salidas si el chofer tardó en arrancar', () => {
  // `demo-provider.tsx` tickea cada 1 s real SIEMPRE (tracking o no) — se simula esa espera con
  // `avanzar()` (ticks de a 1 s, sin el clamp de `DT_MAXIMO_S` que tendría un único tick grande)
  // para que `ahoraSimulado` quede realmente desactualizado antes de tocar "Iniciar", igual que
  // en la app real.
  it('un chofer que tarda varias frecuencias en arrancar no dispara una ráfaga de despachos en el próximo tick', () => {
    const inicial = crearEstadoInicial(TRUFI_PROPIO, AHORA_0);
    const segundosEspera = (FRECUENCIA_MS.z12 * 3) / 1000; // tardó ~3 frecuencias en arrancar
    const esperando = avanzar(inicial, segundosEspera);
    let estado = iniciarJornada(esperando, esperando.ahora);

    // Un solo tick más, inmediatamente después de arrancar: con el bug (Math.min dejando
    // `salidaBase` en el pasado) este único tick despachaba TODA la cola pendiente de una.
    estado = tick(estado, estado.ahora + 1_000);
    expect(estado.unidades['trufi-z12-4']?.fase).toBe('en_cola');
    expect(estado.unidades['trufi-z12-5']?.fase).toBe('en_cola');
  });

  it('el próximo de la cola sigue saliendo con normalidad, una frecuencia después de arrancar', () => {
    const inicial = crearEstadoInicial(TRUFI_PROPIO, AHORA_0);
    const segundosEspera = (FRECUENCIA_MS.z12 * 3) / 1000;
    const esperando = avanzar(inicial, segundosEspera);
    let estado = iniciarJornada(esperando, esperando.ahora);
    estado = avanzar(estado, FRECUENCIA_MS.z12 / 1000 + 5);
    expect(estado.unidades['trufi-z12-4']?.fase).toBe('en_ruta');
    expect(estado.unidades['trufi-z12-5']?.fase).toBe('en_cola');
  });
});

describe('iniciarJornada — reubica a las unidades adelante tras esperar en cola (hallazgo de revisión)', () => {
  // FIX POST-REVISIÓN (hallazgo de revisión — "el espaciado inicial solo vale si se toca 'Iniciar'
  // de inmediato"): mientras el chofer espera en la cola, las unidades ADELANTE (ya `en_ruta`) se
  // siguen moviendo a ~333 m/min (`VELOCIDAD_NOMINAL_MPS`). La espera de cada línea se elige para
  // que la más cercana SUPERE los 4.000 m sin llegar a completar una vuelta (lo que la reciclaría
  // de vuelta a la cola y invalidaría el test): 5 min en Z12 (2.667 + 1.667 = 4.333 m, muy por
  // debajo de sus 38 km de circuito) y 2 min en L120 (4.000 + 667 = 4.667 m — el ejemplo exacto del
  // hallazgo, "a 2 min L120 ahead is at 4.7 km" — todavía lejos de sus ~5 km de circuito completo).
  // `iniciarJornada` tiene que reubicarla al arrancar, no solo al crear el estado inicial.
  it('la más cercana adelante vuelve a quedar en [1.500, 4.000] m aunque el chofer tarde varios minutos, en Z12 y L120', () => {
    const esperaZ12 = avanzar(crearEstadoInicial(TRUFI_PROPIO, AHORA_0), 5 * 60);
    const estadoZ12 = iniciarJornada(esperaZ12, esperaZ12.ahora);
    const { adelante: adelanteZ12 } = adelanteAtras(estadoZ12, TRUFI_PROPIO);
    expect(adelanteZ12).toBeDefined();
    expect(adelanteZ12!.distanciaM).toBeGreaterThanOrEqual(1500);
    expect(adelanteZ12!.distanciaM).toBeLessThanOrEqual(4000);

    const TRUFI_PROPIO_L120 = 'trufi-l120-2'; // misma unidad jugable que `cuentas.ts`
    const esperaL120 = avanzar(crearEstadoInicial(TRUFI_PROPIO_L120, AHORA_0), 2 * 60);
    const estadoL120 = iniciarJornada(esperaL120, esperaL120.ahora);
    const { adelante: adelanteL120 } = adelanteAtras(estadoL120, TRUFI_PROPIO_L120);
    expect(adelanteL120).toBeDefined();
    expect(adelanteL120!.distanciaM).toBeGreaterThanOrEqual(1500);
    expect(adelanteL120!.distanciaM).toBeLessThanOrEqual(4000);
  });

  // FIX POST-REVISIÓN (hallazgo de revisión — "el clamp por unidad apila varias en el mismo
  // avance"): con varias unidades adelante, cada una tiene que quedar en un `avance` ESTRICTAMENTE
  // mayor que la anterior — nunca dos apiladas en el mismo punto. Se ejercita con la unidad propia
  // en la ÚLTIMA posición de cada línea (todas las demás quedan adelante, en orden de salida) para
  // maximizar la cantidad de unidades reubicadas de una sola vez. Ojo con el orden esperado: la que
  // salió MÁS temprano (menor `posicion`) es la que tiene MÁS avance (va más adelante en su vuelta).
  it('preserva el orden estrictamente creciente entre varias unidades adelante, sin apilar ninguna, en Z12 y L120', () => {
    const estadoZ12 = iniciarJornada(crearEstadoInicial('trufi-z12-5', AHORA_0), AHORA_0);
    // Ascendente por avance = descendente por antigüedad de salida: z12-4 (nearest ahead) ...
    // z12-1 (salió primero, la más avanzada).
    const avancesZ12 = ['trufi-z12-4', 'trufi-z12-3', 'trufi-z12-2', 'trufi-z12-1'].map(
      (id) => estadoZ12.unidades[id]!.avance,
    );
    for (let i = 1; i < avancesZ12.length; i++) {
      expect(avancesZ12[i]).toBeGreaterThan(avancesZ12[i - 1]!);
    }

    const estadoL120 = iniciarJornada(crearEstadoInicial('trufi-l120-3', AHORA_0), AHORA_0);
    const avancesL120 = ['trufi-l120-2', 'trufi-l120-1'].map((id) => estadoL120.unidades[id]!.avance);
    expect(avancesL120[1]).toBeGreaterThan(avancesL120[0]!);
  });
});

describe('proximaSalidaDe — enrollado hacia adelante mientras la propia espera en cola', () => {
  it('nunca devuelve una hora en el pasado, aunque el chofer tarde mucho en arrancar', () => {
    const inicial = crearEstadoInicial(TRUFI_PROPIO, AHORA_0);
    const segundosEspera = (FRECUENCIA_MS.z12 * 3) / 1000 + 30; // bien pasada la salida "cruda"
    const estado = avanzar(inicial, segundosEspera);

    const salidaCruda = estado.salidaBase.z12; // índice 0: la propia sigue al frente de su cola
    expect(salidaCruda).toBeLessThan(estado.ahoraSimulado); // precondición: sí está en el pasado

    const salida = proximaSalidaDe(estado, TRUFI_PROPIO);
    expect(salida).not.toBeNull();
    expect(salida!).toBeGreaterThan(salidaCruda); // se enrolló hacia adelante
    expect(salida!).toBeGreaterThanOrEqual(estado.ahoraSimulado); // nunca en el pasado
  });
});

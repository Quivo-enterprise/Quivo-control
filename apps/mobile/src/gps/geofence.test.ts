import { describe, expect, it } from 'vitest';
import { RADIO_AVISO_M, type PuntoControlPaquete } from '@quivo/shared';
import {
  claveCumplimiento,
  confirmarVisitasVencidas,
  detectarPuntosControlCercanos,
  filtrarNuevosCumplimientos,
  FACTOR_REARME_RADIO,
  FIXES_FALLBACK_CONFIRMACION_SIN_MINIMO,
  PASADA_MIN_MS,
  UMBRAL_ANTIGUEDAD_CANDIDATO_MS,
  type DeteccionPuntoControl,
  type EstadoPuntoControl,
} from './geofence';

function puntoControl(id: string, coord: [number, number], radioToleranciaM = 30): PuntoControlPaquete {
  return {
    id,
    orden: 0,
    coord: { type: 'Point', coordinates: coord },
    radioToleranciaM,
    obligatorio: true,
  };
}

/** Detección sintética con el radio de tolerancia de la Z12 (150 m, ver plan §2.3) por
 * default, así los números de las pruebas de histéresis (200/225/300 m) se leen igual que en
 * el plan. */
function deteccion(
  distanciaM: number,
  radioToleranciaM = 150,
  puntoControlId = 'pc-1',
  accuracyM?: number,
): DeteccionPuntoControl {
  return {
    puntoControlId,
    distanciaM,
    cumplido: distanciaM <= radioToleranciaM,
    radioToleranciaM,
    accuracyM,
  };
}

function aplicarTransiciones(
  estados: Map<string, EstadoPuntoControl>,
  transiciones: ReadonlyMap<string, EstadoPuntoControl>,
): void {
  for (const [clave, estado] of transiciones) estados.set(clave, estado);
}

/**
 * ENTREGA 6 — helper de tests: recorre una secuencia de `{ distanciaM, tsFixMs }` para UN
 * punto de control, aplicando cada tick a `estados` en orden, y devuelve el resultado
 * COMPLETO acumulado (todos los `emitir` y `avisosPrecision` de la secuencia, en orden). Sirve
 * para no repetir el boilerplate de "entrar, dejar pasar unos fixes, confirmar" en cada test:
 * bajo el modelo nuevo, confirmar una pasada YA NO es un solo call — hace falta, como mínimo,
 * el fix de ENTRADA más un fix que muestre que la distancia volvió a crecer (o
 * `FIXES_FALLBACK_CONFIRMACION_SIN_MINIMO` fixes sin crecer, ver el fallback).
 */
function correrSecuencia(
  estados: Map<string, EstadoPuntoControl>,
  sesionId: string,
  fixes: { distanciaM: number; tsFixMs: number; radioToleranciaM?: number; accuracyM?: number }[],
  puntoControlId = 'pc-1',
) {
  const emitir: ReturnType<typeof filtrarNuevosCumplimientos>['emitir'] = [];
  const avisosPrecision: ReturnType<typeof filtrarNuevosCumplimientos>['avisosPrecision'] = [];
  for (const fix of fixes) {
    const resultado = filtrarNuevosCumplimientos(
      estados,
      [deteccion(fix.distanciaM, fix.radioToleranciaM ?? 150, puntoControlId, fix.accuracyM)],
      sesionId,
      fix.tsFixMs,
    );
    emitir.push(...resultado.emitir);
    avisosPrecision.push(...resultado.avisosPrecision);
    aplicarTransiciones(estados, resultado.transiciones);
  }
  return { emitir, avisosPrecision };
}

/**
 * Establece una PRIMERA pasada ya confirmada sobre `pc-1` (entrada a `distanciaEntradaM` +
 * un fix de crecimiento que confirma en el mínimo) — punto de partida de casi todos los tests
 * de re-armado/piso de abajo, que antes de la ENTREGA 6 arrancaban con un solo call emitiendo
 * de entrada. Devuelve el resultado de la confirmación (para poder inspeccionar `pasada`,
 * `distanciaMinAproximacionM`, etc. si hace falta) y dejó `estados` ya actualizado.
 */
function confirmarPrimeraPasada(
  estados: Map<string, EstadoPuntoControl>,
  sesionId = 'sesion-1',
  tsEntradaMs = 0,
) {
  const { emitir } = correrSecuencia(estados, sesionId, [
    { distanciaM: 10, tsFixMs: tsEntradaMs },
    { distanciaM: 15, tsFixMs: tsEntradaMs + 1_000 }, // crece desde 10 ⇒ confirma con mínimo 10
  ]);
  return emitir[0]!;
}

describe('detectarPuntosControlCercanos', () => {
  it('marca cumplido un punto de control dentro de su radio de tolerancia', () => {
    const pc = puntoControl('pc-1', [-63.18, -17.78], 30);
    const [deteccion] = detectarPuntosControlCercanos([-63.18, -17.78], [pc]);
    expect(deteccion?.cumplido).toBe(true);
    expect(deteccion?.distanciaM).toBeCloseTo(0, 3);
    expect(deteccion?.radioToleranciaM).toBe(30);
  });

  it('no marca cumplido un punto de control fuera de su radio', () => {
    const pc = puntoControl('pc-1', [-63.18, -17.78], 30);
    // ~500m de distancia
    const [deteccion] = detectarPuntosControlCercanos([-63.18, -17.775], [pc]);
    expect(deteccion?.cumplido).toBe(false);
  });

  it('evalúa cada punto de control de la lista de forma independiente', () => {
    const cerca = puntoControl('pc-cerca', [-63.18, -17.78], 30);
    const lejos = puntoControl('pc-lejos', [-63.2, -17.8], 30);
    const detecciones = detectarPuntosControlCercanos([-63.18, -17.78], [cerca, lejos]);
    expect(detecciones.find((d) => d.puntoControlId === 'pc-cerca')?.cumplido).toBe(true);
    expect(detecciones.find((d) => d.puntoControlId === 'pc-lejos')?.cumplido).toBe(false);
  });
});

describe('filtrarNuevosCumplimientos — entrada, SIN emitir todavía (ENTREGA 6)', () => {
  it('primera detección cumplida: arranca el seguimiento del mínimo local, no emite en el mismo tick', () => {
    const { emitir, transiciones } = filtrarNuevosCumplimientos(
      new Map(),
      [deteccion(10)],
      'sesion-1',
      1_000,
    );
    expect(emitir).toHaveLength(0);
    const estado = transiciones.get(claveCumplimiento('sesion-1', 'pc-1'));
    expect(estado).toMatchObject({
      dentro: true,
      confirmado: false,
      minDistanciaM: 10,
      distanciaEntradaM: 10,
      // Arranca en 0, no 1: el fix de ENTRADA establece el mínimo inicial, no "falla en
      // mejorarlo" — recién el PRÓXIMO fix que no logre bajar el mínimo suma el primer punto
      // al contador del fallback (ver el comentario de `FIXES_FALLBACK_CONFIRMACION_SIN_MINIMO`
      // y el de esta rama en `filtrarNuevosCumplimientos`, `geofence.ts`).
      fixesDentroSinConfirmar: 0,
      ultimoEmitidoMs: -Infinity, // no confirmó todavía: sigue "sin emisión previa"
      pasadas: 0,
    });
    expect(estado?.ultimoFixMs).toBe(1_000);
  });

  it('es pura: no muta el Map de estados que recibe', () => {
    const estados = new Map<string, EstadoPuntoControl>();
    filtrarNuevosCumplimientos(estados, [deteccion(10)], 'sesion-1', 0);
    expect(estados.size).toBe(0);
  });
});

describe('filtrarNuevosCumplimientos — mínimo local (ENTREGA 6, "el corazón del arreglo")', () => {
  it('confirma en el MÍNIMO real, no en la distancia de entrada (la propia cita del piloto: nada de 134 m)', () => {
    // Trayectoria recta: un punto de control a 20 m de perpendicular de la ruta, radio 150 m,
    // muestreado cada 15 m constantes (distanceFilter de producción). Simulado directo en
    // distancias (la geometría lat/lng ya la cubre `detectarPuntosControlCercanos`): la
    // detección ENTRA en el radio bien lejos del mínimo real (~148 m, geometría determinista
    // — no un bug, ver el plan) y el mínimo real (~20 m) se alcanza varios fixes después.
    const distancias = [148, 130, 100, 60, 30, 21, 20, 21.5, 30, 60]; // mínimo real: fix índice 6 (20 m)
    const estados = new Map<string, EstadoPuntoControl>();
    const { emitir } = correrSecuencia(
      estados,
      'sesion-1',
      distancias.map((distanciaM, i) => ({ distanciaM, tsFixMs: i * 10_000 })),
    );
    expect(emitir).toHaveLength(1);
    // El evento sale con distanciaMinAproximacionM ≈ 20 (el mínimo REAL), NO ≈134/148 (la
    // distancia de ENTRADA al radio) — esa es la verificación explícita del plan.
    expect(emitir[0]?.distanciaMinAproximacionM).toBeCloseTo(20, 1);
    expect(emitir[0]?.distanciaEntradaM).toBe(148);
    expect(emitir[0]?.pasada).toBe(1);
    // La `deteccion` emitida también refleja el mínimo, no el fix que disparó la confirmación.
    expect(emitir[0]?.deteccion.distanciaM).toBeCloseTo(20, 1);
    expect(emitir[0]?.deteccion.fase).toBe('confirmado');
  });

  it('cumplido:true en el evento confirmado aunque el fix que dispara la confirmación ya esté fuera del radio de detección', () => {
    // El fix que muestra el crecimiento puede, él mismo, haber superado `radioToleranciaM` —
    // la confirmación no depende de que ESE fix puntual cumpla, depende de que la visita YA
    // pasó por el mínimo. Ver el comentario de `cumplido: true` en `filtrarNuevosCumplimientos`.
    const estados = new Map<string, EstadoPuntoControl>();
    const { emitir } = correrSecuencia(estados, 'sesion-1', [
      { distanciaM: 30, tsFixMs: 0 }, // entra, radio 150
      { distanciaM: 20, tsFixMs: 10_000 }, // mínimo real
      { distanciaM: 160, tsFixMs: 20_000 }, // creciendo, YA fuera del radio de detección (>150)
    ]);
    expect(emitir).toHaveLength(1);
    expect(emitir[0]?.deteccion.cumplido).toBe(true);
    expect(emitir[0]?.distanciaMinAproximacionM).toBe(20);
  });

  it('no confirma dos veces dentro de la MISMA visita aunque la distancia siga oscilando tras confirmar', () => {
    const estados = new Map<string, EstadoPuntoControl>();
    const { emitir } = correrSecuencia(estados, 'sesion-1', [
      { distanciaM: 30, tsFixMs: 0 },
      { distanciaM: 20, tsFixMs: 10_000 },
      { distanciaM: 25, tsFixMs: 20_000 }, // confirma acá (creció de 20 a 25)
      { distanciaM: 22, tsFixMs: 30_000 }, // sigue dentro del radio de re-armado: jitter
      { distanciaM: 28, tsFixMs: 40_000 }, // más jitter, todavía dentro de 150*1.5
    ]);
    expect(emitir).toHaveLength(1);
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.confirmado).toBe(true);
  });
});

describe('filtrarNuevosCumplimientos — FALLBACK OBLIGATORIO (ENTREGA 6)', () => {
  it('vehículo detenido DENTRO del radio (el mínimo nunca crece): confirma igual tras N fixes, no se pierde evidencia', () => {
    const estados = new Map<string, EstadoPuntoControl>();
    // Vehículo parado a 30 m del punto, sin moverse un centímetro — la distancia NUNCA crece,
    // así que el mínimo local por crecimiento no dispararía jamás. Sin el fallback, este
    // cumplimiento no se emitiría NUNCA (evidencia perdida, lo único inaceptable del plan).
    const fixes = Array.from({ length: FIXES_FALLBACK_CONFIRMACION_SIN_MINIMO + 4 }, (_, i) => ({
      distanciaM: 30,
      tsFixMs: i * 10_000,
    }));
    const { emitir } = correrSecuencia(estados, 'sesion-1', fixes);
    expect(emitir).toHaveLength(1); // confirma UNA vez, no revienta en cada fix tras el piso
    expect(emitir[0]?.distanciaMinAproximacionM).toBe(30);
    expect(emitir[0]?.distanciaEntradaM).toBe(30);
    // Confirma exactamente cuando el contador de "fixes sin mejorar" ALCANZA el umbral: el fix
    // de ENTRADA arranca el contador en 0 (establece el mínimo, no "falla en mejorarlo" — ver
    // el comentario de esa rama en `filtrarNuevosCumplimientos`), así que hacen falta
    // `FIXES_FALLBACK_CONFIRMACION_SIN_MINIMO` fixes MÁS, todos sin mejorar el mínimo, para
    // disparar el fallback. Con 4 fixes de margen sobre ese umbral en la fixture, ya disparó.
    expect(emitir[0]?.pasada).toBe(1);
  });

  it('si la distancia mejora un poco antes del umbral del fallback, el mínimo real gana igual', () => {
    const estados = new Map<string, EstadoPuntoControl>();
    const fixes = [
      { distanciaM: 30, tsFixMs: 0 }, // entra: mínimo inicial 30, contador en 0
      { distanciaM: 30, tsFixMs: 10_000 }, // no mejora, no crece: contador del fallback a 1
      { distanciaM: 12, tsFixMs: 20_000 }, // mejora (no "crece"): nuevo mínimo, contador vuelve a 0
      // `FIXES_FALLBACK_CONFIRMACION_SIN_MINIMO` fixes MÁS sin mejorar el nuevo mínimo (12) ni
      // hacer crecer la distancia ⇒ el último de esta tanda dispara el fallback igual, pero con
      // el mínimo REAL (12), no con el de la entrada (30) — esa es la verificación del test.
      ...Array.from({ length: FIXES_FALLBACK_CONFIRMACION_SIN_MINIMO }, (_, i) => ({
        distanciaM: 12,
        tsFixMs: 30_000 + i * 10_000,
      })),
    ];
    const { emitir } = correrSecuencia(estados, 'sesion-1', fixes);
    expect(emitir).toHaveLength(1);
    expect(emitir[0]?.distanciaMinAproximacionM).toBe(12);
  });
});

describe('filtrarNuevosCumplimientos — histéresis de re-armado (multi-vuelta), sobre una visita ya confirmada', () => {
  it('devuelve la nueva visita SIN emitir; una detección de otro punto de control no interfiere', () => {
    const estados = new Map<string, EstadoPuntoControl>();
    confirmarPrimeraPasada(estados, 'sesion-1', 0);
    aplicarTransiciones(
      estados,
      filtrarNuevosCumplimientos(estados, [deteccion(600)], 'sesion-1', 10_000).transiciones,
    );
    aplicarTransiciones(
      estados,
      filtrarNuevosCumplimientos(estados, [deteccion(600)], 'sesion-1', 20_000).transiciones,
    );
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.dentro).toBe(false);

    const detecciones = [
      deteccion(5, 150, 'pc-1'), // re-entra, pero PASADA_MIN_MS no venció ⇒ B5, sin emitir
      deteccion(500, 150, 'pc-2'), // lejos, no cumplido: nada
      deteccion(2, 150, 'pc-3'), // nuevo punto, cumplido: arranca seguimiento, SIN emitir todavía
    ];
    const { emitir, transiciones } = filtrarNuevosCumplimientos(estados, detecciones, 'sesion-1', 25_000);
    expect(emitir).toHaveLength(0);
    expect(transiciones.get(claveCumplimiento('sesion-1', 'pc-3'))).toMatchObject({
      dentro: true,
      confirmado: false,
      minDistanciaM: 2,
    });
  });

  it('no re-emite DENTRO DE LA MISMA PASADA aunque el punto siga cumplido en fixes sucesivos', () => {
    // Reemplaza al viejo comportamiento "solo la primera vez": la propiedad que se sigue
    // garantizando es que NO hay una segunda emisión mientras sigue siendo la misma pasada
    // (dentro:true, ya confirmada, sin haber re-armado por distancia).
    const estados = new Map([
      [
        claveCumplimiento('sesion-1', 'pc-1'),
        { dentro: true, ultimoEmitidoMs: 0, pasadas: 1, confirmado: true } as EstadoPuntoControl,
      ],
    ]);
    const { emitir } = filtrarNuevosCumplimientos(estados, [deteccion(5)], 'sesion-1', 1_000);
    expect(emitir).toHaveLength(0);
  });

  it('NO suprime el cumplimiento de otra sesión sobre el mismo punto de control', () => {
    // Turno del día siguiente sobre la misma ruta recurrente, con el contexto JS headless
    // todavía vivo: `pc-1` ya está "dentro" y CONFIRMADO en el Map, pero con la clave de la
    // sesión anterior.
    const estados = new Map([
      [
        claveCumplimiento('sesion-1', 'pc-1'),
        { dentro: true, ultimoEmitidoMs: 0, pasadas: 1, confirmado: true } as EstadoPuntoControl,
      ],
    ]);
    const { emitir } = confirmarPrimeraPasadaEnSesion(estados, 'sesion-2');
    expect(emitir).toHaveLength(1);
    expect(emitir[0]?.deteccion.puntoControlId).toBe('pc-1');
    expect(emitir[0]?.pasada).toBe(1); // pasadas de sesion-2, independiente de sesion-1
  });

  it('dwell largo dentro del radio (layover) ⇒ UNA sola confirmación sin importar cuántos fixes', () => {
    let estados = new Map<string, EstadoPuntoControl>();
    let totalEmitidos = 0;
    // 20 fixes cada 10s (~3.3 min de espera en la terminal), todos bien adentro del radio y sin
    // moverse — dispara el fallback (no el crecimiento) UNA sola vez.
    for (let i = 0; i < 20; i++) {
      const tsFixMs = i * 10_000;
      const { emitir, transiciones } = filtrarNuevosCumplimientos(
        estados,
        [deteccion(10)],
        'sesion-1',
        tsFixMs,
      );
      totalEmitidos += emitir.length;
      const nuevoEstado = new Map(estados);
      aplicarTransiciones(nuevoEstado, transiciones);
      estados = nuevoEstado;
    }
    expect(totalEmitidos).toBe(1);
  });

  it('salida a 200 m y regreso: NO re-arma (200 < radio*1.5=225) ⇒ sin segunda confirmación', () => {
    const estados = new Map<string, EstadoPuntoControl>();
    confirmarPrimeraPasada(estados, 'sesion-1', 0);

    // Se aleja a 200 m: no cumplido (>150), pero <= 225 (radio * FACTOR_REARME_RADIO) — no re-arma.
    expect(150 * FACTOR_REARME_RADIO).toBe(225);
    const paso2 = filtrarNuevosCumplimientos(estados, [deteccion(200)], 'sesion-1', 60_000);
    expect(paso2.emitir).toHaveLength(0);
    aplicarTransiciones(estados, paso2.transiciones);
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.dentro).toBe(true);

    // Vuelve a estar cumplido, mucho después del piso — pero como nunca re-armó, sigue sin emitir.
    const paso3 = filtrarNuevosCumplimientos(estados, [deteccion(10)], 'sesion-1', PASADA_MIN_MS * 5);
    expect(paso3.emitir).toHaveLength(0);
  });

  it('salida a 300 m y regreso: SÍ re-arma tras 2 fixes seguidos fuera de 225 m (A2) y, tras el piso, confirma pasada 2', () => {
    const estados = new Map<string, EstadoPuntoControl>();
    confirmarPrimeraPasada(estados, 'sesion-1', 0);

    expect(150 * FACTOR_REARME_RADIO).toBe(225);

    // A2: un solo fix fuera de 225 m NO alcanza para re-armar — hace falta un segundo fix
    // CONSECUTIVO (FIXES_REARME_CONSECUTIVOS) fuera del radio de re-armado.
    const paso2a = filtrarNuevosCumplimientos(estados, [deteccion(300)], 'sesion-1', 60_000);
    expect(paso2a.emitir).toHaveLength(0);
    aplicarTransiciones(estados, paso2a.transiciones);
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.dentro).toBe(true);

    const paso2b = filtrarNuevosCumplimientos(estados, [deteccion(300)], 'sesion-1', 70_000);
    expect(paso2b.emitir).toHaveLength(0); // el re-armado en sí no emite
    aplicarTransiciones(estados, paso2b.transiciones);
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.dentro).toBe(false);

    // Regresa bien pasado el piso de 2 min desde la ÚLTIMA CONFIRMACIÓN (ts=1000, no desde el
    // re-armado): entra (sin emitir) y confirma en el siguiente fix que crece.
    const { emitir } = correrSecuencia(estados, 'sesion-1', [
      { distanciaM: 10, tsFixMs: PASADA_MIN_MS + 1_000 },
      { distanciaM: 20, tsFixMs: PASADA_MIN_MS + 2_000 },
    ]);
    expect(emitir).toHaveLength(1);
    expect(emitir[0]?.pasada).toBe(2);
  });

  it('jitter de UN fix a 400 m: un outlier aislado NO re-arma (A2), y el regreso inmediato sigue sin confirmar de nuevo', () => {
    const estados = new Map<string, EstadoPuntoControl>();
    confirmarPrimeraPasada(estados, 'sesion-1', 0);

    // Jitter de un solo fix, bien lejos (400 > 225): NO alcanza para re-armar por sí solo. Como
    // la visita YA está confirmada, este fix tampoco dispara una confirmación nueva.
    const paso2 = filtrarNuevosCumplimientos(estados, [deteccion(400)], 'sesion-1', 5_000);
    expect(paso2.emitir).toHaveLength(0);
    aplicarTransiciones(estados, paso2.transiciones);
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.dentro).toBe(true);
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.fixesFueraRadioRearme).toBe(1);

    // Vuelta inmediata: sigue siendo la misma pasada (nunca re-armó), sin confirmar de nuevo.
    const paso3 = filtrarNuevosCumplimientos(estados, [deteccion(10)], 'sesion-1', 10_000);
    expect(paso3.emitir).toHaveLength(0);
    aplicarTransiciones(estados, paso3.transiciones);
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.fixesFueraRadioRearme).toBe(0);
  });

  it('tras un re-armado REAL (2 fixes seguidos fuera de 225 m), el piso de 2 min bloquea la reemisión inmediata', () => {
    // Complementa el test anterior: acá el vehículo SÍ re-arma de verdad (dos outliers
    // seguidos, no uno), y lo que evita la pasada fantasma es el piso de tiempo
    // (PASADA_MIN_MS) sobre la última CONFIRMACIÓN, no el re-armado por distancia.
    const estados = new Map<string, EstadoPuntoControl>();
    confirmarPrimeraPasada(estados, 'sesion-1', 0);

    aplicarTransiciones(
      estados,
      filtrarNuevosCumplimientos(estados, [deteccion(400)], 'sesion-1', 5_000).transiciones,
    );
    aplicarTransiciones(
      estados,
      filtrarNuevosCumplimientos(estados, [deteccion(400)], 'sesion-1', 6_000).transiciones,
    );
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.dentro).toBe(false);

    // Vuelve a los 7s (muy por debajo de PASADA_MIN_MS=2min desde la última CONFIRMACIÓN real
    // en ts=1000): re-armó de verdad, pero el piso bloquea la reemisión.
    const paso3 = filtrarNuevosCumplimientos(estados, [deteccion(10)], 'sesion-1', 7_000);
    expect(paso3.emitir).toHaveLength(0);
  });

  it('descarta un fix cuyo tsFixMs llega igual o anterior al último ya aceptado (A3, buffering headless)', () => {
    const estados = new Map<string, EstadoPuntoControl>();
    const paso1 = filtrarNuevosCumplimientos(estados, [deteccion(10)], 'sesion-1', 10_000);
    aplicarTransiciones(estados, paso1.transiciones);
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.ultimoFixMs).toBe(10_000);

    // Un fix bufferado que "llega" después pero con tsFixMs ANTERIOR al último ya aceptado se
    // descarta por completo — ni transición ni emisión — aunque cumpla el radio.
    const pasoAnterior = filtrarNuevosCumplimientos(estados, [deteccion(300)], 'sesion-1', 9_999);
    expect(pasoAnterior.emitir).toHaveLength(0);
    expect(pasoAnterior.transiciones.size).toBe(0);

    // Con tsFixMs IGUAL al último aceptado también se descarta (`<=`, no `<`).
    const pasoIgual = filtrarNuevosCumplimientos(estados, [deteccion(300)], 'sesion-1', 10_000);
    expect(pasoIgual.emitir).toHaveLength(0);
    expect(pasoIgual.transiciones.size).toBe(0);

    // Un fix realmente posterior sí se procesa normalmente.
    const pasoPosterior = filtrarNuevosCumplimientos(estados, [deteccion(10)], 'sesion-1', 10_001);
    expect(pasoPosterior.transiciones.size).toBe(1);
  });

  it('B5: una reentrada antes del piso de 2 min marca dentro:true SIN emitir (misma visita), en vez de emitir tarde', () => {
    // Escenario del hallazgo: el vehículo re-arma de verdad (2 fixes más allá de 225 m), vuelve
    // a entrar ANTES de que venza el piso y se queda ahí. Antes de este fix la rama dejaba
    // `dentro: false`, así que el piso RETRASABA la emisión en vez de atribuirla a la visita en
    // curso: no se emitía nada al entrar y se emitía justo al vencer el piso, con un `ts` de
    // minutos DESPUÉS de la llegada real — un timestamp equivocado en el registro que sustenta
    // una sanción.
    const estados = new Map<string, EstadoPuntoControl>();
    const confirmacion1 = confirmarPrimeraPasada(estados, 'sesion-1', 0);
    const tsConfirmacion1 = estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.ultimoEmitidoMs;
    expect(confirmacion1.pasada).toBe(1);

    // Re-armado real: dos fixes seguidos fuera de 225 m.
    aplicarTransiciones(
      estados,
      filtrarNuevosCumplimientos(estados, [deteccion(300)], 'sesion-1', 10_000).transiciones,
    );
    aplicarTransiciones(
      estados,
      filtrarNuevosCumplimientos(estados, [deteccion(300)], 'sesion-1', 20_000).transiciones,
    );
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.dentro).toBe(false);

    // Vuelve a entrar a los 30 s (piso de 2 min NO vencido): no emite, pero queda `dentro:true`
    // atado a la visita en curso, YA confirmada (B5) — no hay nada pendiente que seguir.
    const reentrada = filtrarNuevosCumplimientos(estados, [deteccion(10)], 'sesion-1', 30_000);
    expect(reentrada.emitir).toHaveLength(0);
    aplicarTransiciones(estados, reentrada.transiciones);
    const estadoTrasReentrada = estados.get(claveCumplimiento('sesion-1', 'pc-1'));
    expect(estadoTrasReentrada?.dentro).toBe(true);
    expect(estadoTrasReentrada?.confirmado).toBe(true);
    // La confirmación anterior sigue siendo la que manda: el piso no se "reinicia" desde la
    // reentrada.
    expect(estadoTrasReentrada?.ultimoEmitidoMs).toBe(tsConfirmacion1);
    expect(estadoTrasReentrada?.pasadas).toBe(1);

    // Y se queda ahí: al vencer el piso NO aparece una confirmación tardía con el ts equivocado.
    for (const tsFixMs of [60_000, 90_000, PASADA_MIN_MS + 1_000, PASADA_MIN_MS + 30_000]) {
      const paso = filtrarNuevosCumplimientos(estados, [deteccion(10)], 'sesion-1', tsFixMs);
      expect(paso.emitir).toHaveLength(0);
      aplicarTransiciones(estados, paso.transiciones);
    }
  });

  it('B5: una pasada genuina posterior (sale de verdad y vuelve pasado el piso) SIGUE confirmando', () => {
    // Contracara del test anterior: marcar `dentro:true` en el fix suprimido no puede suprimir
    // evidencia real — con una salida real y un regreso pasado el piso, la pasada 2 confirma.
    const estados = new Map<string, EstadoPuntoControl>();
    confirmarPrimeraPasada(estados, 'sesion-1', 0);
    aplicarTransiciones(
      estados,
      filtrarNuevosCumplimientos(estados, [deteccion(300)], 'sesion-1', 10_000).transiciones,
    );
    aplicarTransiciones(
      estados,
      filtrarNuevosCumplimientos(estados, [deteccion(300)], 'sesion-1', 20_000).transiciones,
    );
    // Reentrada temprana suprimida (B5): vuelve a `dentro: true`, ya confirmada.
    aplicarTransiciones(
      estados,
      filtrarNuevosCumplimientos(estados, [deteccion(10)], 'sesion-1', 30_000).transiciones,
    );

    // Sale de nuevo, de verdad, y vuelve bien pasado el piso: entra sin emitir y confirma
    // pasada 2 en el siguiente fix que crece.
    aplicarTransiciones(
      estados,
      filtrarNuevosCumplimientos(estados, [deteccion(300)], 'sesion-1', 40_000).transiciones,
    );
    aplicarTransiciones(
      estados,
      filtrarNuevosCumplimientos(estados, [deteccion(300)], 'sesion-1', 50_000).transiciones,
    );
    const { emitir } = correrSecuencia(estados, 'sesion-1', [
      { distanciaM: 10, tsFixMs: PASADA_MIN_MS + 1_000 },
      { distanciaM: 20, tsFixMs: PASADA_MIN_MS + 2_000 },
    ]);
    expect(emitir).toHaveLength(1);
    expect(emitir[0]?.pasada).toBe(2);
    // Y el `ts` de la pasada es el de SU PROPIA confirmación, no un instante arrastrado.
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.ultimoEmitidoMs).toBe(
      PASADA_MIN_MS + 2_000,
    );
  });

  it('el contador de pasadas continúa desde el estado previo, no reinicia en 1', () => {
    const estados = new Map<string, EstadoPuntoControl>([
      [claveCumplimiento('sesion-1', 'pc-1'), { dentro: false, ultimoEmitidoMs: 0, pasadas: 4 }],
    ]);
    const { emitir } = correrSecuencia(estados, 'sesion-1', [
      { distanciaM: 10, tsFixMs: PASADA_MIN_MS + 1 },
      { distanciaM: 20, tsFixMs: PASADA_MIN_MS + 2_000 },
    ]);
    expect(emitir[0]?.pasada).toBe(5);
  });
});

describe('filtrarNuevosCumplimientos — G1 (histéresis PROPIA de voz, independiente de la de detección)', () => {
  // Caso Codex verificado (verify-fix, ronda 3, gap G1): con `radioToleranciaM=30` (mucho más
  // chico que `RADIO_AVISO_M=150`), la histéresis de DETECCIÓN re-arma en cuanto el vehículo
  // supera `30 * FACTOR_REARME_RADIO = 45` m por `FIXES_REARME_CONSECUTIVOS` fixes — con el
  // vehículo TODAVÍA a 60-140 m, bien adentro de la zona de aviso. Antes de G1 ese re-armado de
  // DETECCIÓN (`puntosRearmados`) era la única señal que liberaba el dedupe de voz
  // (`aproximacionesAnunciadas`, `anuncio-punto-control.ts`) — usarla ahí re-anunciaba la
  // aproximación en el mismo tick del re-armado (60-80 m, adentro de `RADIO_AVISO_M`) y dejaba
  // la aproximación REAL de la vuelta siguiente en silencio (el dedupe "ya se había liberado y
  // vuelto a usar" antes de tiempo). G1 exige que la voz tenga su PROPIA histéresis, sobre
  // `RADIO_AVISO_M`, con el mismo umbral de fixes consecutivos.
  it('rearme de DETECCIÓN a 60/80 m (radioToleranciaM=30) NO libera puntosRearmadosVoz: el vehículo sigue dentro de RADIO_AVISO_M', () => {
    const estados = new Map<string, EstadoPuntoControl>();
    const radioToleranciaM = 30;

    // Entra y confirma la primera pasada bien cerca del punto.
    aplicarTransiciones(
      estados,
      filtrarNuevosCumplimientos(
        estados,
        [deteccion(10, radioToleranciaM)],
        'sesion-1',
        0,
      ).transiciones,
    );
    const confirmacion = filtrarNuevosCumplimientos(
      estados,
      [deteccion(15, radioToleranciaM)],
      'sesion-1',
      1_000,
    );
    expect(confirmacion.emitir).toHaveLength(1);
    aplicarTransiciones(estados, confirmacion.transiciones);
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.avisoVozDentro).toBe(true);

    // Fix 1 saliendo: 60 m > 45 (30*1.5) — cuenta para el re-armado de DETECCIÓN (1/2), pero
    // sigue bien adentro de RADIO_AVISO_M (150): la histéresis de voz ni se entera.
    const paso60 = filtrarNuevosCumplimientos(estados, [deteccion(60, radioToleranciaM)], 'sesion-1', 60_000);
    expect(paso60.puntosRearmados).toEqual([]);
    expect(paso60.puntosRearmadosVoz).toEqual([]);
    aplicarTransiciones(estados, paso60.transiciones);
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.avisoVozDentro).toBe(true);

    // Fix 2 saliendo: 80 m > 45, segundo consecutivo (FIXES_REARME_CONSECUTIVOS=2) — ACÁ
    // re-arma la DETECCIÓN (`puntosRearmados`), pero 80 m sigue <= RADIO_AVISO_M (150): la voz
    // NO debe re-armar (`puntosRearmadosVoz` vacío) — es exactamente el caso que Codex reportó
    // roto antes de G1.
    const paso80 = filtrarNuevosCumplimientos(estados, [deteccion(80, radioToleranciaM)], 'sesion-1', 70_000);
    expect(paso80.puntosRearmados).toEqual(['pc-1']);
    expect(paso80.puntosRearmadosVoz).toEqual([]);
    aplicarTransiciones(estados, paso80.transiciones);
    const estadoTrasRearmeDeteccion = estados.get(claveCumplimiento('sesion-1', 'pc-1'));
    expect(estadoTrasRearmeDeteccion?.dentro).toBe(false); // detección SÍ re-armó
    expect(estadoTrasRearmeDeteccion?.avisoVozDentro).toBe(true); // voz sigue "en zona de aviso"

    // El vehículo se sigue alejando, todavía dentro de RADIO_AVISO_M (90-140 m): la voz sigue
    // sin re-armar — sin esto, el bug original re-anunciaría acá mismo.
    const paso110 = filtrarNuevosCumplimientos(estados, [deteccion(110, radioToleranciaM)], 'sesion-1', 80_000);
    expect(paso110.puntosRearmadosVoz).toEqual([]);
    aplicarTransiciones(estados, paso110.transiciones);

    // Recién más allá de RADIO_AVISO_M * FACTOR_REARME_RADIO (225 m), `FIXES_REARME_CONSECUTIVOS`
    // fixes seguidos, re-arma la voz de verdad.
    expect(RADIO_AVISO_M * FACTOR_REARME_RADIO).toBe(225);
    const paso230 = filtrarNuevosCumplimientos(estados, [deteccion(230, radioToleranciaM)], 'sesion-1', 90_000);
    expect(paso230.puntosRearmadosVoz).toEqual([]); // 1er fix consecutivo: no alcanza todavía
    aplicarTransiciones(estados, paso230.transiciones);

    const paso235 = filtrarNuevosCumplimientos(estados, [deteccion(235, radioToleranciaM)], 'sesion-1', 100_000);
    expect(paso235.puntosRearmadosVoz).toEqual(['pc-1']); // 2do fix consecutivo: re-arma la voz
    aplicarTransiciones(estados, paso235.transiciones);
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.avisoVozDentro).toBe(false);
  });

  it('avisoVozDentro se reactiva (sin rearmar) si el vehículo vuelve a acercarse antes de completar FIXES_REARME_CONSECUTIVOS', () => {
    const estados = new Map<string, EstadoPuntoControl>();
    aplicarTransiciones(
      estados,
      filtrarNuevosCumplimientos(estados, [deteccion(10)], 'sesion-1', 0).transiciones,
    );

    // Un fix afuera de la zona de aviso con margen (cuenta 1/2)...
    const salida1 = filtrarNuevosCumplimientos(estados, [deteccion(230)], 'sesion-1', 10_000);
    expect(salida1.puntosRearmadosVoz).toEqual([]);
    aplicarTransiciones(estados, salida1.transiciones);
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.avisoVozFixesFueraRadioRearme).toBe(1);

    // ...pero un fix que vuelve a caer dentro de RADIO_AVISO_M resetea el contador — un
    // acercamiento real desmiente el outlier de alejamiento, igual que la histéresis de
    // detección (A2).
    const regreso = filtrarNuevosCumplimientos(estados, [deteccion(100)], 'sesion-1', 20_000);
    expect(regreso.puntosRearmadosVoz).toEqual([]);
    aplicarTransiciones(estados, regreso.transiciones);
    const estadoTrasRegreso = estados.get(claveCumplimiento('sesion-1', 'pc-1'));
    expect(estadoTrasRegreso?.avisoVozDentro).toBe(true);
    expect(estadoTrasRegreso?.avisoVozFixesFueraRadioRearme).toBe(0);
  });

});

describe('filtrarNuevosCumplimientos — M3 (precisión del fix), sobre una visita ya confirmada', () => {
  it('una accuracy PEOR que el radio no impide confirmar la pasada (solo la marca como degradada)', () => {
    // El gate anterior (en `location-task.ts`) descartaba la detección entera cuando
    // `accuracy > radioToleranciaM`: con radios de 100 m y una Android que reporta 100-500 m de
    // rutina, la pasada genuina desaparecía sin evento y sin telemetría.
    const estados = new Map<string, EstadoPuntoControl>();
    const { emitir, avisosPrecision } = correrSecuencia(estados, 'sesion-1', [
      { distanciaM: 20, radioToleranciaM: 100, accuracyM: 250, tsFixMs: 1_000 },
      { distanciaM: 25, radioToleranciaM: 100, accuracyM: 250, tsFixMs: 2_000 }, // crece ⇒ confirma
    ]);
    expect(emitir).toHaveLength(1);
    expect(emitir[0]?.pasada).toBe(1);
    expect(avisosPrecision).toEqual([
      {
        motivo: 'emision-con-precision-degradada',
        puntoControlId: 'pc-1',
        distanciaM: 20,
        radioToleranciaM: 100,
        accuracyM: 250,
      },
    ]);
  });

  it('un fix impreciso NO re-arma la histéresis (la accuracy se descuenta del radio de re-armado)', () => {
    // El re-armado es el único camino por el que un fix impreciso puede INVENTAR evidencia (una
    // pasada fantasma junto con el piso de tiempo), así que ahí sí se le exige margen.
    const estados = new Map<string, EstadoPuntoControl>();
    // Confirma la visita primero (radio 100), CERCA — para aislar el comportamiento de
    // re-armado del de confirmación (un salto directo a 200 m dispararía "creciendo" y
    // confirmaría antes de llegar a evaluar el re-armado impreciso, que es justo lo que este
    // test quiere ejercitar).
    correrSecuencia(estados, 'sesion-1', [
      { distanciaM: 10, radioToleranciaM: 100, tsFixMs: 0 },
      { distanciaM: 15, radioToleranciaM: 100, tsFixMs: 1_000 },
    ]);
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.confirmado).toBe(true);

    // Radio 100 ⇒ radio de re-armado 150. El fix mide 200 m (fuera), pero con accuracy 300 no
    // prueba nada: ni re-arma ni suma al contador de A2.
    for (const tsFixMs of [10_000, 20_000, 30_000]) {
      const paso = filtrarNuevosCumplimientos(
        estados,
        [deteccion(200, 100, 'pc-1', 300)],
        'sesion-1',
        tsFixMs,
      );
      expect(paso.avisosPrecision[0]?.motivo).toBe('rearme-postergado-por-precision');
      aplicarTransiciones(estados, paso.transiciones);
      expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.dentro).toBe(true);
      expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.fixesFueraRadioRearme ?? 0).toBe(0);
    }

    // Un fix que supera el radio de re-armado CON margen (600 - 300 = 300 > 150) sí cuenta: dos
    // seguidos re-arman.
    aplicarTransiciones(
      estados,
      filtrarNuevosCumplimientos(estados, [deteccion(600, 100, 'pc-1', 300)], 'sesion-1', 40_000)
        .transiciones,
    );
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.fixesFueraRadioRearme).toBe(1);
    aplicarTransiciones(
      estados,
      filtrarNuevosCumplimientos(estados, [deteccion(600, 100, 'pc-1', 300)], 'sesion-1', 50_000)
        .transiciones,
    );
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.dentro).toBe(false);
  });

  it('sin accuracy conocida el re-armado se comporta igual que antes (margen 0)', () => {
    const estados = new Map<string, EstadoPuntoControl>();
    confirmarPrimeraPasada(estados, 'sesion-1', 0);
    aplicarTransiciones(
      estados,
      filtrarNuevosCumplimientos(estados, [deteccion(300)], 'sesion-1', 10_000).transiciones,
    );
    const paso = filtrarNuevosCumplimientos(estados, [deteccion(300)], 'sesion-1', 20_000);
    expect(paso.avisosPrecision).toHaveLength(0);
    aplicarTransiciones(estados, paso.transiciones);
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.dentro).toBe(false);
  });
});

describe('filtrarNuevosCumplimientos — multi-vuelta (verificación del plan)', () => {
  it('3 pasadas completas (acercarse, confirmar, alejarse, re-armar, esperar el piso) ⇒ 3 eventos, pasada 1/2/3, sin duplicados', () => {
    const estados = new Map<string, EstadoPuntoControl>();
    const emitidos: number[] = [];

    function unaVuelta(tsBase: number) {
      const { emitir } = correrSecuencia(estados, 'sesion-1', [
        { distanciaM: 140, tsFixMs: tsBase }, // entra
        { distanciaM: 40, tsFixMs: tsBase + 10_000 }, // se acerca
        { distanciaM: 15, tsFixMs: tsBase + 20_000 }, // mínimo
        { distanciaM: 60, tsFixMs: tsBase + 30_000 }, // crece ⇒ confirma
        { distanciaM: 300, tsFixMs: tsBase + 40_000 }, // se va (1/2 rearme)
        { distanciaM: 300, tsFixMs: tsBase + 50_000 }, // se va (2/2 rearme ⇒ dentro:false)
      ]);
      for (const c of emitir) emitidos.push(c.pasada);
    }

    unaVuelta(0);
    unaVuelta(PASADA_MIN_MS + 60_000);
    unaVuelta(2 * (PASADA_MIN_MS + 60_000));

    expect(emitidos).toEqual([1, 2, 3]);
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.pasadas).toBe(3);
  });
});

/** Variante de `confirmarPrimeraPasada` que arranca desde un Map SIN semilla previa para la
 * clave de `sesionId` (usada en el test de aislamiento entre sesiones, donde el Map YA trae
 * una entrada de OTRA sesión sobre el mismo `puntoControlId`). */
function confirmarPrimeraPasadaEnSesion(estados: Map<string, EstadoPuntoControl>, sesionId: string) {
  return correrSecuencia(estados, sesionId, [
    { distanciaM: 10, tsFixMs: 0 },
    { distanciaM: 15, tsFixMs: 1_000 },
  ]);
}

/**
 * FIX POST-REVISIÓN (bug 2, "un vehículo detenido nunca confirma"): tests de
 * `confirmarVisitasVencidas` — la mitad "heartbeat"/"cierre de recorrido" del fix. Sin fixes
 * nuevos (el fallback existente, `FIXES_FALLBACK_CONFIRMACION_SIN_MINIMO`, cuenta FIXES, no
 * tiempo) un vehículo DETENIDO dentro del radio nunca confirmaba — el caso real es el ÚLTIMO
 * punto de control de la ruta, en la terminal, donde el chofer se estaciona y apaga el motor.
 */
describe('confirmarVisitasVencidas (FIX POST-REVISIÓN, bug 2)', () => {
  /** Entra a un punto de control (fix único, sin más fixes después — el escenario "vehículo
   * detenido") y devuelve la clave de esa visita. Pasa `posicionFix` siempre: sin eso el
   * candidato queda `undefined` y `confirmarVisitasVencidas` lo saltea (best-effort) — no es
   * el escenario que estos tests quieren ejercitar. */
  function entrarYDetenerse(
    estados: Map<string, EstadoPuntoControl>,
    opts: {
      sesionId?: string;
      puntoControlId?: string;
      distanciaM?: number;
      radioToleranciaM?: number;
      tsFixMs?: number;
      lat?: number;
      lng?: number;
    } = {},
  ): string {
    const {
      sesionId = 'sesion-1',
      puntoControlId = 'pc-1',
      distanciaM = 146,
      radioToleranciaM = 150,
      tsFixMs = 0,
      lat = -17.78,
      lng = -63.18,
    } = opts;
    const resultado = filtrarNuevosCumplimientos(
      estados,
      [deteccion(distanciaM, radioToleranciaM, puntoControlId)],
      sesionId,
      tsFixMs,
      { lat, lng },
    );
    aplicarTransiciones(estados, resultado.transiciones);
    return claveCumplimiento(sesionId, puntoControlId);
  }

  it('soloPuntoControlId confirma únicamente la visita de ese punto', () => {
    const estados = new Map<string, EstadoPuntoControl>();
    const claveA = entrarYDetenerse(estados, { puntoControlId: 'pc-a' });
    entrarYDetenerse(estados, { puntoControlId: 'pc-b' });
    const { emitir, transiciones } = confirmarVisitasVencidas(estados, 0, 0, 'pc-a');
    expect(emitir.map((e) => e.clave)).toEqual([claveA]);
    expect([...transiciones.keys()]).toEqual([claveA]);
  });

  it('vehículo detenido dentro del radio: un heartbeat ANTES de cumplirse UMBRAL_ANTIGUEDAD_CANDIDATO_MS todavía NO confirma', () => {
    const estados = new Map<string, EstadoPuntoControl>();
    entrarYDetenerse(estados, { tsFixMs: 0 });
    const { emitir } = confirmarVisitasVencidas(
      estados,
      UMBRAL_ANTIGUEDAD_CANDIDATO_MS - 1,
      UMBRAL_ANTIGUEDAD_CANDIDATO_MS,
    );
    expect(emitir).toHaveLength(0);
  });

  it('vehículo detenido dentro del radio: un heartbeat AL CUMPLIRSE (o superar) UMBRAL_ANTIGUEDAD_CANDIDATO_MS confirma con el candidato ya observado, SIN fix nuevo (caso "terminal, chofer estaciona")', () => {
    const estados = new Map<string, EstadoPuntoControl>();
    const clave = entrarYDetenerse(estados, { tsFixMs: 0, lat: -17.78, lng: -63.18, distanciaM: 146 });

    const { emitir, transiciones } = confirmarVisitasVencidas(
      estados,
      UMBRAL_ANTIGUEDAD_CANDIDATO_MS,
      UMBRAL_ANTIGUEDAD_CANDIDATO_MS,
    );

    expect(emitir).toHaveLength(1);
    const c = emitir[0]!;
    expect(c.clave).toBe(clave);
    expect(c.deteccion.fase).toBe('confirmado');
    expect(c.deteccion.pasada).toBe(1);
    // El candidato (fix de entrada, único fix de la visita) es lo que viaja — nunca una
    // posición inventada: el heartbeat no trae un fix nuevo del que fabricar evidencia.
    expect(c.candidatoLat).toBeCloseTo(-17.78, 6);
    expect(c.candidatoLng).toBeCloseTo(-63.18, 6);
    expect(c.candidatoTsFixMs).toBe(0);
    expect(c.distanciaMinAproximacionM).toBeCloseTo(146, 0);

    // La transición cierra la visita en curso (confirmado: true) pero NO re-arma `dentro` —
    // eso sigue exclusivamente en manos de fixes reales (histéresis de re-armado normal).
    const nuevoEstado = transiciones.get(clave);
    expect(nuevoEstado?.confirmado).toBe(true);
    expect(nuevoEstado?.dentro).toBe(true);
    expect(nuevoEstado?.pasadas).toBe(1);
    // `ultimoEmitidoMs` se sella con la hora del CANDIDATO (el paso real), no `ahoraMs` (cuándo
    // el heartbeat lo notó) — protege `PASADA_MIN_MS` de la PRÓXIMA pasada con el mismo
    // criterio que el camino de confirmación normal.
    expect(nuevoEstado?.ultimoEmitidoMs).toBe(0);
  });

  it('NO confirma una visita que ya está fuera del radio (dentro: false) — el heartbeat no reabre nada por su cuenta', () => {
    const estados = new Map<string, EstadoPuntoControl>();
    estados.set(claveCumplimiento('sesion-1', 'pc-1'), {
      dentro: false,
      ultimoEmitidoMs: -Infinity,
      pasadas: 0,
    });
    const { emitir } = confirmarVisitasVencidas(estados, 10_000_000);
    expect(emitir).toHaveLength(0);
  });

  it('NO confirma una visita YA confirmada (confirmado: true) — nunca duplica una pasada que ya salió por el camino normal', () => {
    const estados = new Map<string, EstadoPuntoControl>();
    const clave = entrarYDetenerse(estados, { tsFixMs: 0 });
    // Confirma por el camino normal (un fix que muestra que la distancia volvió a crecer).
    const paso2 = filtrarNuevosCumplimientos(
      estados,
      [deteccion(160, 150, 'pc-1')],
      'sesion-1',
      10_000,
      { lat: -17.7797, lng: -63.18 },
    );
    aplicarTransiciones(estados, paso2.transiciones);
    expect(estados.get(clave)?.confirmado).toBe(true);

    const { emitir } = confirmarVisitasVencidas(estados, 10_000 + UMBRAL_ANTIGUEDAD_CANDIDATO_MS);
    expect(emitir).toHaveLength(0);
  });

  it('best-effort: un EstadoPuntoControl sin candidato completo (semilla vieja / construido a mano en un test) se saltea en silencio, sin lanzar', () => {
    const estados = new Map<string, EstadoPuntoControl>();
    estados.set(claveCumplimiento('sesion-1', 'pc-1'), {
      dentro: true,
      confirmado: false,
      ultimoEmitidoMs: -Infinity,
      pasadas: 0,
      // Sin candidatoLat/candidatoLng/candidatoTsFixMs/minDistanciaM/puntoControlId/radioToleranciaM.
    });
    expect(() => confirmarVisitasVencidas(estados, 10_000_000)).not.toThrow();
    expect(confirmarVisitasVencidas(estados, 10_000_000).emitir).toHaveLength(0);
  });

  it('es pura: no muta el Map de estados que recibe — las transiciones viajan aparte para que el caller decida aplicarlas', () => {
    const estados = new Map<string, EstadoPuntoControl>();
    entrarYDetenerse(estados, { tsFixMs: 0 });
    const snapshot = new Map(estados);
    confirmarVisitasVencidas(estados, UMBRAL_ANTIGUEDAD_CANDIDATO_MS);
    expect(estados).toEqual(snapshot);
  });

  it('umbralMs: 0 (diseño B, "cierre del recorrido"): confirma CUALQUIER visita pendiente sin importar su antigüedad — "ante la duda, emitir"', () => {
    const estados = new Map<string, EstadoPuntoControl>();
    entrarYDetenerse(estados, { tsFixMs: 5_000 });

    // Con el umbral normal, un heartbeat 1 ms después de la entrada NO alcanza.
    const conUmbralNormal = confirmarVisitasVencidas(estados, 5_001, UMBRAL_ANTIGUEDAD_CANDIDATO_MS);
    expect(conUmbralNormal.emitir).toHaveLength(0);

    // Con `umbralMs: 0` (el que usa el cierre de recorrido al finalizar/detener) confirma
    // igual, con la MISMA edad — el chofer para el motor y aprieta "Finalizar" antes de que
    // pase ningún tiempo: la visita pendiente no puede quedar en el limbo.
    const conCierre = confirmarVisitasVencidas(estados, 5_001, 0);
    expect(conCierre.emitir).toHaveLength(1);
  });

  it('puntosRearmados, puntosRearmadosVoz y avisosPrecision siempre vacíos: confirmar por antigüedad/cierre nunca re-arma ninguna histéresis por sí solo', () => {
    const estados = new Map<string, EstadoPuntoControl>();
    entrarYDetenerse(estados, { tsFixMs: 0 });
    const resultado = confirmarVisitasVencidas(estados, UMBRAL_ANTIGUEDAD_CANDIDATO_MS);
    expect(resultado.puntosRearmados).toEqual([]);
    expect(resultado.puntosRearmadosVoz).toEqual([]);
    expect(resultado.avisosPrecision).toEqual([]);
  });

  it('múltiples visitas vencidas en puntos DISTINTOS: confirma TODAS en una sola llamada (el heartbeat no está atado a un único punto de control)', () => {
    const estados = new Map<string, EstadoPuntoControl>();
    entrarYDetenerse(estados, { puntoControlId: 'pc-1', tsFixMs: 0 });
    entrarYDetenerse(estados, { puntoControlId: 'pc-2', tsFixMs: 0 });
    const { emitir } = confirmarVisitasVencidas(estados, UMBRAL_ANTIGUEDAD_CANDIDATO_MS);
    expect(emitir.map((c) => c.deteccion.puntoControlId).sort()).toEqual(['pc-1', 'pc-2']);
  });
});


describe('segunda pasada por la terminal tras un recorrido largo (piloto 21/10, PIL f34d5d70)', () => {
  const M_POR_GRADO_LAT = 111_195;
  const LNG = -66.15;
  const LAT0 = -17.38;
  const alNorte = (m: number): [number, number] => [LNG, LAT0 + m / M_POR_GRADO_LAT];
  const pcs = [
    puntoControl('terminal', alNorte(0), 150),
    puntoControl('pc-2', alNorte(2_000), 150),
    puntoControl('pc-3', alNorte(4_000), 150),
  ];

  /** Un fix a `norteM` metros al norte de la terminal; devuelve los puntos de control emitidos. */
  function fix(estados: Map<string, EstadoPuntoControl>, norteM: number, tsFixMs: number) {
    const pos = alNorte(norteM);
    const { emitir, transiciones } = filtrarNuevosCumplimientos(
      estados,
      detectarPuntosControlCercanos(pos, pcs, 4),
      'sesion-1',
      tsFixMs,
      { lat: pos[1], lng: pos[0] },
    );
    aplicarTransiciones(estados, transiciones);
    return emitir.map((e) => e.deteccion.puntoControlId);
  }

  it('emite la terminal, se aleja >5 km por otros puntos, vuelve y estaciona a ~50 m: emite una 2ª pasada', () => {
    const estados = new Map<string, EstadoPuntoControl>();
    const emitidos: string[] = [];
    let ts = 0;
    // 1ª pasada: llega y sale de la terminal.
    for (const m of [200, 100, 50, 50, 60, 120, 200, 300, 500]) emitidos.push(...fix(estados, m, (ts += 12_000)));
    // Ida: 5,5 km al norte pasando por pc-2 y pc-3 (un fix cada 100 m, 10 s).
    for (let m = 600; m <= 5_500; m += 100) emitidos.push(...fix(estados, m, (ts += 10_000)));
    // Vuelta hasta 150 m de la terminal.
    for (let m = 5_400; m >= 200; m -= 100) emitidos.push(...fix(estados, m, (ts += 10_000)));
    // Estacionado a 48-51 m, 21 fixes cada ~12 s.
    for (let i = 0; i < 21; i++) emitidos.push(...fix(estados, 48 + (i % 4), (ts += 12_000)));

    expect(emitidos.filter((id) => id === 'terminal')).toHaveLength(2);
    expect(emitidos).toEqual(expect.arrayContaining(['pc-2', 'pc-3']));
  });
});

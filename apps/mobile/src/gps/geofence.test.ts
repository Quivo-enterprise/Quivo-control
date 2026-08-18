import { describe, expect, it } from 'vitest';
import type { PuntoControlPaquete } from '@quivo/shared';
import {
  claveCumplimiento,
  detectarPuntosControlCercanos,
  filtrarNuevosCumplimientos,
  FACTOR_REARME_RADIO,
  PASADA_MIN_MS,
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

describe('filtrarNuevosCumplimientos — máquina de estados con histéresis (multi-vuelta)', () => {
  it('primera pasada: sin estado previo, emite con pasada 1 y marca dentro:true', () => {
    const { emitir, transiciones } = filtrarNuevosCumplimientos(
      new Map(),
      [deteccion(10)],
      'sesion-1',
      1_000,
    );
    expect(emitir).toHaveLength(1);
    expect(emitir[0]?.pasada).toBe(1);
    expect(emitir[0]?.deteccion.puntoControlId).toBe('pc-1');
    // Aserciones sobre los campos que importan (no deep-equal del objeto entero): un campo
    // nuevo en `EstadoPuntoControl` (p. ej. `fixesFueraRadioRearme`/`ultimoFixMs`, A2/A3) no
    // debe romper este test — eso es justo lo que rompió el `toEqual` anterior.
    const estado = transiciones.get(claveCumplimiento('sesion-1', 'pc-1'));
    expect(estado).toMatchObject({ dentro: true, ultimoEmitidoMs: 1_000, pasadas: 1 });
    expect(estado?.fixesFueraRadioRearme).toBe(0);
    expect(estado?.ultimoFixMs).toBe(1_000);
  });

  it('es pura: no muta el Map de estados que recibe', () => {
    const estados = new Map<string, EstadoPuntoControl>();
    filtrarNuevosCumplimientos(estados, [deteccion(10)], 'sesion-1', 0);
    expect(estados.size).toBe(0);
  });

  it('devuelve solo los cumplidos que no estaban ya "dentro"', () => {
    const estados = new Map([
      [claveCumplimiento('sesion-1', 'pc-1'), { dentro: true, ultimoEmitidoMs: 0, pasadas: 1 }],
    ]);
    const detecciones = [
      deteccion(5, 150, 'pc-1'), // ya dentro, sigue dentro del radio de re-armado: nada
      deteccion(500, 150, 'pc-2'), // lejos, no cumplido: nada
      deteccion(2, 150, 'pc-3'), // nuevo, cumplido: emite
    ];
    const { emitir } = filtrarNuevosCumplimientos(estados, detecciones, 'sesion-1', 10_000);
    expect(emitir.map((e) => e.deteccion.puntoControlId)).toEqual(['pc-3']);
  });

  it('no re-emite DENTRO DE LA MISMA PASADA aunque el punto siga cumplido en fixes sucesivos', () => {
    // Reemplaza al viejo comportamiento "solo la primera vez": la propiedad que se sigue
    // garantizando es que NO hay una segunda emisión mientras sigue siendo la misma pasada
    // (dentro:true, sin haber re-armado por distancia).
    const estados = new Map([
      [claveCumplimiento('sesion-1', 'pc-1'), { dentro: true, ultimoEmitidoMs: 0, pasadas: 1 }],
    ]);
    const { emitir } = filtrarNuevosCumplimientos(estados, [deteccion(5)], 'sesion-1', 1_000);
    expect(emitir).toHaveLength(0);
  });

  it('NO suprime el cumplimiento de otra sesión sobre el mismo punto de control', () => {
    // Turno del día siguiente sobre la misma ruta recurrente, con el contexto JS headless
    // todavía vivo: `pc-1` ya está "dentro" en el Map, pero con la clave de la sesión anterior.
    const estados = new Map([
      [claveCumplimiento('sesion-1', 'pc-1'), { dentro: true, ultimoEmitidoMs: 0, pasadas: 1 }],
    ]);
    const { emitir } = filtrarNuevosCumplimientos(estados, [deteccion(5)], 'sesion-2', 1_000);
    expect(emitir.map((e) => e.deteccion.puntoControlId)).toEqual(['pc-1']);
    expect(emitir[0]?.pasada).toBe(1);
  });

  it('dwell largo dentro del radio (layover) ⇒ UNA sola emisión sin importar cuántos fixes', () => {
    let estados = new Map<string, EstadoPuntoControl>();
    let totalEmitidos = 0;
    // 20 fixes cada 10s (~3.3 min de espera en la terminal), todos bien adentro del radio.
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

  it('salida a 200 m y regreso: NO re-arma (200 < radio*1.5=225) ⇒ sin segunda emisión', () => {
    const estados = new Map<string, EstadoPuntoControl>();
    const paso1 = filtrarNuevosCumplimientos(estados, [deteccion(10)], 'sesion-1', 0);
    expect(paso1.emitir).toHaveLength(1);
    aplicarTransiciones(estados, paso1.transiciones);

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

  it('salida a 300 m y regreso: SÍ re-arma tras 2 fixes seguidos fuera de 225 m (A2) y, tras el piso, emite pasada 2', () => {
    const estados = new Map<string, EstadoPuntoControl>();
    const paso1 = filtrarNuevosCumplimientos(estados, [deteccion(10)], 'sesion-1', 0);
    aplicarTransiciones(estados, paso1.transiciones);

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

    // Regresa bien pasado el piso de 2 min desde la ÚLTIMA EMISIÓN (ts=0, no desde el re-armado).
    const paso3 = filtrarNuevosCumplimientos(
      estados,
      [deteccion(10)],
      'sesion-1',
      PASADA_MIN_MS + 1_000,
    );
    expect(paso3.emitir).toHaveLength(1);
    expect(paso3.emitir[0]?.pasada).toBe(2);
  });

  it('jitter de UN fix a 400 m: un outlier aislado NO re-arma (A2), y el regreso inmediato sigue sin emitir', () => {
    const estados = new Map<string, EstadoPuntoControl>();
    const paso1 = filtrarNuevosCumplimientos(estados, [deteccion(10)], 'sesion-1', 0);
    aplicarTransiciones(estados, paso1.transiciones);

    // Jitter de un solo fix, bien lejos (400 > 225): NO alcanza para re-armar por sí solo.
    const paso2 = filtrarNuevosCumplimientos(estados, [deteccion(400)], 'sesion-1', 5_000);
    expect(paso2.emitir).toHaveLength(0);
    aplicarTransiciones(estados, paso2.transiciones);
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.dentro).toBe(true);
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.fixesFueraRadioRearme).toBe(1);

    // Vuelta inmediata: sigue siendo la misma pasada (nunca re-armó), sin emitir.
    const paso3 = filtrarNuevosCumplimientos(estados, [deteccion(10)], 'sesion-1', 10_000);
    expect(paso3.emitir).toHaveLength(0);
    aplicarTransiciones(estados, paso3.transiciones);
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.fixesFueraRadioRearme).toBe(0);
  });

  it('tras un re-armado REAL (2 fixes seguidos fuera de 225 m), el piso de 2 min bloquea la reemisión inmediata', () => {
    // Complementa el test anterior: acá el vehículo SÍ re-arma de verdad (dos outliers seguidos,
    // no uno), y lo que evita la pasada fantasma es el piso de tiempo (PASADA_MIN_MS) sobre la
    // última EMISIÓN, no el re-armado por distancia.
    const estados = new Map<string, EstadoPuntoControl>();
    const paso1 = filtrarNuevosCumplimientos(estados, [deteccion(10)], 'sesion-1', 0);
    aplicarTransiciones(estados, paso1.transiciones);

    const paso2a = filtrarNuevosCumplimientos(estados, [deteccion(400)], 'sesion-1', 5_000);
    aplicarTransiciones(estados, paso2a.transiciones);
    const paso2b = filtrarNuevosCumplimientos(estados, [deteccion(400)], 'sesion-1', 6_000);
    aplicarTransiciones(estados, paso2b.transiciones);
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.dentro).toBe(false);

    // Vuelve a los 7s (muy por debajo de PASADA_MIN_MS=2min desde la última EMISIÓN real en
    // ts=0): re-armó de verdad, pero el piso bloquea la reemisión.
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
    const paso1 = filtrarNuevosCumplimientos(estados, [deteccion(10)], 'sesion-1', 0);
    expect(paso1.emitir).toHaveLength(1);
    aplicarTransiciones(estados, paso1.transiciones);

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
    // atado a la visita en curso.
    const reentrada = filtrarNuevosCumplimientos(estados, [deteccion(10)], 'sesion-1', 30_000);
    expect(reentrada.emitir).toHaveLength(0);
    aplicarTransiciones(estados, reentrada.transiciones);
    const estadoTrasReentrada = estados.get(claveCumplimiento('sesion-1', 'pc-1'));
    expect(estadoTrasReentrada?.dentro).toBe(true);
    // La emisión anterior sigue siendo la que manda: el piso no se "reinicia" desde la
    // reentrada.
    expect(estadoTrasReentrada?.ultimoEmitidoMs).toBe(0);
    expect(estadoTrasReentrada?.pasadas).toBe(1);

    // Y se queda ahí: al vencer el piso NO aparece una emisión tardía con el ts equivocado.
    for (const tsFixMs of [60_000, 90_000, PASADA_MIN_MS + 1_000, PASADA_MIN_MS + 30_000]) {
      const paso = filtrarNuevosCumplimientos(estados, [deteccion(10)], 'sesion-1', tsFixMs);
      expect(paso.emitir).toHaveLength(0);
      aplicarTransiciones(estados, paso.transiciones);
    }
  });

  it('B5: una pasada genuina posterior (sale de verdad y vuelve pasado el piso) SIGUE emitiendo', () => {
    // Contracara del test anterior: marcar `dentro:true` en el fix suprimido no puede suprimir
    // evidencia real — con una salida real y un regreso pasado el piso, la pasada 2 se emite.
    const estados = new Map<string, EstadoPuntoControl>();
    aplicarTransiciones(
      estados,
      filtrarNuevosCumplimientos(estados, [deteccion(10)], 'sesion-1', 0).transiciones,
    );
    aplicarTransiciones(
      estados,
      filtrarNuevosCumplimientos(estados, [deteccion(300)], 'sesion-1', 10_000).transiciones,
    );
    aplicarTransiciones(
      estados,
      filtrarNuevosCumplimientos(estados, [deteccion(300)], 'sesion-1', 20_000).transiciones,
    );
    // Reentrada temprana suprimida (B5): vuelve a `dentro: true`.
    aplicarTransiciones(
      estados,
      filtrarNuevosCumplimientos(estados, [deteccion(10)], 'sesion-1', 30_000).transiciones,
    );

    // Sale de nuevo, de verdad, y vuelve bien pasado el piso: pasada 2.
    aplicarTransiciones(
      estados,
      filtrarNuevosCumplimientos(estados, [deteccion(300)], 'sesion-1', 40_000).transiciones,
    );
    aplicarTransiciones(
      estados,
      filtrarNuevosCumplimientos(estados, [deteccion(300)], 'sesion-1', 50_000).transiciones,
    );
    const regreso = filtrarNuevosCumplimientos(
      estados,
      [deteccion(10)],
      'sesion-1',
      PASADA_MIN_MS + 1_000,
    );
    expect(regreso.emitir).toHaveLength(1);
    expect(regreso.emitir[0]?.pasada).toBe(2);
    // Y el `ts` de la pasada es el de SU PROPIA entrada, no un instante arrastrado.
    expect(regreso.transiciones.get(claveCumplimiento('sesion-1', 'pc-1'))?.ultimoEmitidoMs).toBe(
      PASADA_MIN_MS + 1_000,
    );
  });

  it('M3: una accuracy PEOR que el radio no impide emitir la pasada (solo la marca como degradada)', () => {
    // El gate anterior (en `location-task.ts`) descartaba la detección entera cuando
    // `accuracy > radioToleranciaM`: con radios de 100 m y una Android que reporta 100-500 m de
    // rutina, la pasada genuina desaparecía sin evento y sin telemetría.
    const { emitir, avisosPrecision } = filtrarNuevosCumplimientos(
      new Map(),
      [deteccion(20, 100, 'pc-1', 250)],
      'sesion-1',
      1_000,
    );
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

  it('M3: un fix impreciso NO re-arma la histéresis (la accuracy se descuenta del radio de re-armado)', () => {
    // El re-armado es el único camino por el que un fix impreciso puede INVENTAR evidencia (una
    // pasada fantasma junto con el piso de tiempo), así que ahí sí se le exige margen.
    const estados = new Map<string, EstadoPuntoControl>();
    aplicarTransiciones(
      estados,
      filtrarNuevosCumplimientos(estados, [deteccion(10, 100)], 'sesion-1', 0).transiciones,
    );

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

  it('M3: sin accuracy conocida el re-armado se comporta igual que antes (margen 0)', () => {
    const estados = new Map<string, EstadoPuntoControl>();
    aplicarTransiciones(
      estados,
      filtrarNuevosCumplimientos(estados, [deteccion(10)], 'sesion-1', 0).transiciones,
    );
    aplicarTransiciones(
      estados,
      filtrarNuevosCumplimientos(estados, [deteccion(300)], 'sesion-1', 10_000).transiciones,
    );
    const paso = filtrarNuevosCumplimientos(estados, [deteccion(300)], 'sesion-1', 20_000);
    expect(paso.avisosPrecision).toHaveLength(0);
    aplicarTransiciones(estados, paso.transiciones);
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.dentro).toBe(false);
  });

  it('el contador de pasadas continúa desde el estado previo, no reinicia en 1', () => {
    const estados = new Map([
      [claveCumplimiento('sesion-1', 'pc-1'), { dentro: false, ultimoEmitidoMs: 0, pasadas: 4 }],
    ]);
    const { emitir } = filtrarNuevosCumplimientos(
      estados,
      [deteccion(10)],
      'sesion-1',
      PASADA_MIN_MS + 1,
    );
    expect(emitir[0]?.pasada).toBe(5);
  });
});

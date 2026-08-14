/**
 * Lógica pura de análisis del spike GPS (QUI-216): sin dependencias de React Native,
 * testeable en Node/vitest. Consume timestamps de puntos GPS y muestras de batería
 * (tomadas del propio evento de ubicación de Transistorsoft, que incluye `battery`).
 */

const DOS_MINUTOS_MS = 2 * 60 * 1000;

/**
 * Piso de duración para que el veredicto sea significativo (hallazgo de revisión A5): por
 * debajo de esto, cualquier ratio extrapolado a una jornada de 8h es ruido — 2 minutos de
 * medición ya multiplica el consumo real por 240x. Escenario que esto cierra: el chofer
 * reabre la app a mitad de turno solo para mirar el mapa, la batería no bajó en esos 2
 * minutos, y sin este piso `evaluarCriteriosGo` daba un GO limpio sobre una medición que no
 * dice nada de una jornada de 8h. 1h es razonable para un criterio que mide 8h: alcanza para
 * amortiguar el ruido de arranque sin exigir la corrida completa para tener un veredicto.
 *
 * Se reusa como piso ABSOLUTO también para la ventana de batería (ver
 * `COBERTURA_MINIMA_BATERIA` más abajo): mismo razonamiento, aplicado a las muestras de
 * batería en vez de a los puntos GPS.
 */
const DURACION_MINIMA_HORAS_MEDICION = 1;

/**
 * Piso de COBERTURA para el criterio A (batería) — hallazgo de revisión A9 (QUI-216),
 * residuo del mismo defecto que A1 cerró para huecos. `detener()` ahora calcula
 * `duracionMedicionHoras` (huecos) desde el OUTBOX, así que cubre la corrida completa,
 * incluida la parte con la app terminada (headless). Pero `bateria.current` sigue siendo un
 * `useRef` que solo alimenta `onLocation`: no corre en el camino headless y no sobrevive a
 * que Android recicle el proceso si el chofer mata la app. Un piso ABSOLUTO (arriba) no
 * alcanza para atajar esto: en una corrida larga, una ventana de batería que lo supera puede
 * seguir siendo una fracción ínfima de la jornada real. Escenario: corrida de 8h, el chofer
 * mata la app a las 2h (criterio C) — el `useRef` se pierde con el proceso — y la reabre
 * recién a las 7h30. La ventana de batería (30 min) ya cae bajo el piso absoluto, pero en una
 * corrida de 16h (doble turno) una ventana de batería de 1h30 lo superaría sin representar ni
 * el 10% de la jornada. Exigir que la batería cubra al menos esta fracción de la ventana de
 * medición total evita que el spike reclame un número de batería — GO o NO-GO — sobre una
 * ventana que no muestreó.
 */
const COBERTURA_MINIMA_BATERIA = 0.5;

export interface MuestraBateria {
  ts: number;
  nivel: number; // 0-100
}

export interface Hueco {
  desdeTs: number;
  hastaTs: number;
  duracionMs: number;
}

export interface ReporteHuecos {
  cantidad: number;
  huecoMaximoMs: number;
  huecos: Hueco[];
}

/** Detecta huecos de tracking > `umbralMs` (criterio GO: ninguno > 2 min, doc técnico §12). */
export function detectarHuecos(timestamps: number[], umbralMs = DOS_MINUTOS_MS): ReporteHuecos {
  const ordenados = [...timestamps].sort((a, b) => a - b);
  const huecos: Hueco[] = [];

  for (let i = 1; i < ordenados.length; i += 1) {
    const anterior = ordenados[i - 1];
    const actual = ordenados[i];
    if (anterior === undefined || actual === undefined) continue;

    const duracionMs = actual - anterior;
    if (duracionMs > umbralMs) {
      huecos.push({ desdeTs: anterior, hastaTs: actual, duracionMs });
    }
  }

  return {
    cantidad: huecos.length,
    huecoMaximoMs: huecos.reduce((max, h) => Math.max(max, h.duracionMs), 0),
    huecos,
  };
}

/** % de batería consumido entre la primera y la última muestra. */
export function bateriaConsumidaPorcentaje(muestras: MuestraBateria[]): number {
  if (muestras.length < 2) return 0;

  const ordenadas = [...muestras].sort((a, b) => a.ts - b.ts);
  const primera = ordenadas[0];
  const ultima = ordenadas[ordenadas.length - 1];
  if (!primera || !ultima) return 0;

  return Math.max(0, primera.nivel - ultima.nivel);
}

/**
 * Duración de la ventana que realmente muestreó batería (última muestra menos primera, en
 * horas) — hallazgo de revisión A9 (QUI-216 criterio A). Antes `evaluarCriteriosGo`
 * extrapolaba el consumo de batería usando la duración de la ventana de HUECOS
 * (`duracionMedicionHoras`), que ahora sale del outbox y cubre la corrida completa incluida
 * la parte headless (ver A1 en `use-gps-operativo.ts`) — pero las muestras de batería siguen
 * viniendo de un `useRef` que se pierde si Android recicla el proceso. Usar la ventana de
 * huecos como denominador de la batería mezclaba un numerador corto (poca batería muestreada)
 * con un denominador largo (la corrida completa), lo que DEPRIME la estimación en vez de
 * exponerla. Esta función le da a `evaluarCriteriosGo` el denominador correcto.
 */
export function duracionVentanaBateriaHoras(muestras: MuestraBateria[]): number {
  if (muestras.length < 2) return 0;

  const ordenadas = [...muestras].sort((a, b) => a.ts - b.ts);
  const primera = ordenadas[0];
  const ultima = ordenadas[ordenadas.length - 1];
  if (!primera || !ultima) return 0;

  return Math.max(0, ultima.ts - primera.ts) / 3_600_000;
}

export interface ResultadoGoNoGo {
  go: boolean;
  motivos: string[];
  bateriaEstimadaPorJornada8h: number;
  duracionBateriaHoras: number;
}

/**
 * Normaliza el consumo medido a una jornada de 8h y aplica los criterios GO del issue:
 * < 5% batería/jornada y cero huecos > 2 min.
 *
 * `duracionMedicionHoras` (ventana de huecos, desde el outbox) y `duracionBateriaHoras`
 * (ventana de batería, desde las `MuestraBateria[]`) son DOS ventanas DISTINTAS a propósito
 * (hallazgo de revisión A9): la batería no viaja en el outbox — el payload de `gps_point` es
 * evidencia legal, no instrumentación de spike — y su `useRef` no sobrevive a que Android
 * recicle el proceso con la app terminada. La extrapolación de batería usa su propia ventana
 * como denominador, no la de huecos (ver `duracionVentanaBateriaHoras`).
 *
 * `erroresEscrituraOutbox` es opcional y por defecto 0 (no cambia el veredicto de un caller
 * que no lo pase). Cuenta las ubicaciones que el SDK entregó pero que NO se pudieron
 * persistir en el outbox: sin esto, un fallo de SQLite dejaba la corrida "parcialmente
 * limpia" en vez de fallar ruidosamente, con el contador de puntos desviado por debajo de
 * las ubicaciones realmente recibidas. Cualquier evidencia perdida es NO-GO.
 */
export function evaluarCriteriosGo(params: {
  bateriaConsumidaPorcentaje: number;
  reporteHuecos: ReporteHuecos;
  duracionMedicionHoras: number;
  duracionBateriaHoras: number;
  erroresEscrituraOutbox?: number;
}): ResultadoGoNoGo {
  const motivos: string[] = [];
  const bateriaEstimadaPorJornada8h =
    params.duracionBateriaHoras > 0
      ? (params.bateriaConsumidaPorcentaje / params.duracionBateriaHoras) * 8
      : 0;

  if (params.duracionMedicionHoras < DURACION_MINIMA_HORAS_MEDICION) {
    // NO CONCLUYENTE — distinto de "falló un criterio": acá no hay evidencia suficiente para
    // afirmar nada, ni siquiera que la batería esté bien. `go` es `false` en ambos casos (el
    // caller no debe poder tratar esto como un GO), pero el texto tiene que dejar claro que
    // no es lo mismo no medir que medir y que salga mal.
    motivos.push(
      `Medición no concluyente: ${params.duracionMedicionHoras.toFixed(2)}h medidas, se ` +
        `requiere al menos ${DURACION_MINIMA_HORAS_MEDICION}h para un veredicto válido`,
    );
    return {
      go: false,
      motivos,
      bateriaEstimadaPorJornada8h,
      duracionBateriaHoras: params.duracionBateriaHoras,
    };
  }

  // A9 (hallazgo de revisión): piso de la ventana de batería, independiente del de arriba —
  // puede ser corta (proceso reciclado a mitad de corrida) aunque la ventana de huecos sea
  // larga. Cualquiera de las dos condiciones basta para "no concluyente": piso ABSOLUTO
  // (mismo de arriba — 2 minutos de batería siguen siendo ruido aunque la corrida dure 8h) o
  // piso de COBERTURA (la batería tiene que cubrir al menos la mitad de la medición total, o
  // el número que salga no representa la jornada real — ver `COBERTURA_MINIMA_BATERIA`).
  const coberturaBateria =
    params.duracionMedicionHoras > 0
      ? params.duracionBateriaHoras / params.duracionMedicionHoras
      : 0;
  if (
    params.duracionBateriaHoras < DURACION_MINIMA_HORAS_MEDICION ||
    coberturaBateria < COBERTURA_MINIMA_BATERIA
  ) {
    motivos.push(
      `Batería no concluyente: ${params.duracionBateriaHoras.toFixed(2)}h con muestras de ` +
        `batería sobre ${params.duracionMedicionHoras.toFixed(2)}h de medición total ` +
        `(${(coberturaBateria * 100).toFixed(0)}% de cobertura, se requiere ≥` +
        `${(COBERTURA_MINIMA_BATERIA * 100).toFixed(0)}% y ≥${DURACION_MINIMA_HORAS_MEDICION}h) — ` +
        `la app estuvo terminada buena parte de la corrida y no hay muestras de batería para ` +
        `esa ventana`,
    );
    return {
      go: false,
      motivos,
      bateriaEstimadaPorJornada8h,
      duracionBateriaHoras: params.duracionBateriaHoras,
    };
  }

  if (bateriaEstimadaPorJornada8h >= 5) {
    motivos.push(
      `Batería estimada por jornada de 8h: ${bateriaEstimadaPorJornada8h.toFixed(1)}% (debe ser < 5%)`,
    );
  }
  if (params.reporteHuecos.cantidad > 0) {
    motivos.push(`${params.reporteHuecos.cantidad} hueco(s) de tracking > 2 min detectados`);
  }
  const erroresEscritura = params.erroresEscrituraOutbox ?? 0;
  if (erroresEscritura > 0) {
    motivos.push(
      `${erroresEscritura} ubicación(es) recibidas que no se pudieron escribir en el outbox`,
    );
  }

  return {
    go: motivos.length === 0,
    motivos,
    bateriaEstimadaPorJornada8h,
    duracionBateriaHoras: params.duracionBateriaHoras,
  };
}

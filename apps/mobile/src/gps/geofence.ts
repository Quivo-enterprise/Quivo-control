import { haversineMetros, type PuntoControlPaquete } from '@quivo/shared';

export interface DeteccionPuntoControl {
  puntoControlId: string;
  distanciaM: number;
  cumplido: boolean;
  /** Radio de tolerancia (metros) del punto de control evaluado. Viaja acá (no solo en
   * `PuntoControlPaquete`) porque `filtrarNuevosCumplimientos` lo necesita para el re-armado
   * por histéresis (`radio * FACTOR_REARME_RADIO`, ver más abajo) sin tener que volver a
   * buscar el punto de control por id. */
  radioToleranciaM: number;
  /** Precisión horizontal (metros) del fix GPS que originó esta detección, tal como la reporta
   * el dispositivo (`location.coords.accuracy`). Opcional: hay dispositivos que no la entregan
   * o la entregan no finita — ausente se trata como "sin margen de error conocido" (0), que es
   * el comportamiento previo a este campo.
   *
   * Se usa SOLO para el re-armado de la histéresis (ver `filtrarNuevosCumplimientos`), nunca
   * para bloquear una emisión — ver el comentario de `MARGEN_ACCURACY_SOLO_REARME` abajo. */
  accuracyM?: number;
  /** B4 (hallazgo de revisión): número de pasada de ESTA detección, cuando corresponde a un
   * cumplimiento recién emitido — lo llena `construirEventosDeUbicacion` (`location-task.ts`)
   * desde `CumplimientoAEmitir.pasada`, y `simularDeteccion` (`use-gps-operativo.ts`) desde el
   * mismo contador que escribe en el Map de estados. `gps-provider.tsx` lo usa para distinguir
   * dos pasadas CONSECUTIVAS del MISMO punto de control (multi-vuelta) al decidir si repetir
   * el aviso por voz — comparar solo `puntoControlId` dejaba la segunda pasada muda. Ausente
   * (`undefined`) para una `DeteccionPuntoControl` que no viene de una emisión real.
   */
  pasada?: number;
}

/**
 * Evalúa una posición contra todos los puntos de control de la ruta activa (RF-64..66,
 * QUI-239). La fuente de verdad auditada es el worker server-side (RF-39, `ST_DWithin`
 * contra `puntos_control.coord`, QUI-241) — esto es detección offline con feedback
 * inmediato al chofer; discrepancias entre lo que detecta la app y lo que valida el worker
 * quedan como observación (RNF-37), no se resuelven acá.
 */
export function detectarPuntosControlCercanos(
  posicion: [number, number],
  puntosControl: PuntoControlPaquete[],
  accuracyM?: number,
): DeteccionPuntoControl[] {
  // `accuracy` cruza el bridge nativo y no hay garantía de que respete el `.d.ts` en todos los
  // dispositivos: se normaliza acá una sola vez (no finito, negativo o ausente ⇒ `undefined`,
  // "sin margen de error conocido") para que `filtrarNuevosCumplimientos` no tenga que repetir
  // la validación por cada detección.
  const accuracyNormalizada =
    typeof accuracyM === 'number' && Number.isFinite(accuracyM) && accuracyM >= 0
      ? accuracyM
      : undefined;
  return puntosControl.map((pc) => {
    const distanciaM = haversineMetros(posicion, pc.coord.coordinates);
    return {
      puntoControlId: pc.id,
      distanciaM,
      cumplido: distanciaM <= pc.radioToleranciaM,
      radioToleranciaM: pc.radioToleranciaM,
      accuracyM: accuracyNormalizada,
    };
  });
}

/**
 * Clave con la que se recuerda el ESTADO (histéresis dentro/fuera + contador de pasadas) de
 * un punto de control. Va scopeada por sesión a propósito: el Map del headless task vive a
 * nivel de módulo del contexto JS headless (`headless-task.ts`), que NO se reinicia al
 * cambiar de sesión — sin el `sesionId` en la clave, un punto de control registrado en la
 * ruta A arrastraría su estado para siempre a la ruta B o al turno del día siguiente sobre la
 * misma ruta recurrente, y nada lo re-deriva server-side (el worker solo valida los eventos
 * que recibe): la evidencia de cumplimiento se perdería o se contaría mal.
 */
export function claveCumplimiento(sesionId: string, puntoControlId: string): string {
  return `${sesionId}:${puntoControlId}`;
}

/**
 * Factor de re-armado de la histéresis (multi-vuelta, plan §2.3): una vez que un punto de
 * control se marca `dentro: true`, hace falta alejarse a `radio * FACTOR_REARME_RADIO` — NO
 * al radio propio del punto — antes de que una entrada nueva cuente como una pasada distinta.
 *
 * Con precisión urbana típica de 10-30 m, un vehículo detenido cerca del borde del radio
 * (p. ej. a 145 m de un punto con radio 150 m) entraría y saldría del radio en CADA fix solo
 * por el jitter del GPS — sin este margen, un layover se contaría como decenas de pasadas
 * falsas (6 eventos por minuto de espera en la terminal). 1.5x (225 m con el radio de 150 m
 * de la Z12) es lo bastante grande para absorber ese jitter y lo bastante chico para re-armar
 * mucho antes de la vuelta siguiente: a 20 km/h esos 225 m se cubren en ~40 s (2-4 fixes a
 * `locationUpdateInterval: 10_000`).
 */
export const FACTOR_REARME_RADIO = 1.5;

/**
 * A2 (hallazgo de revisión, alto): cuántos fixes CONSECUTIVOS fuera del radio de re-armado
 * (`radio * FACTOR_REARME_RADIO`) hacen falta para re-armar la histéresis de un punto de
 * control (pasar `dentro` de `true` a `false`). UN solo fix no alcanza: un outlier de un
 * fix aislado — jitter de GPS urbano, hasta 400 m visto en producción — no debe re-armar por
 * sí solo, porque el piso de tiempo (`PASADA_MIN_MS`) solo DEMORA la reemisión, no la
 * suprime: con un vehículo parado indefinidamente cerca de un punto, un solo outlier que
 * re-arma + el piso que después deja pasar produce una pasada fantasma en cuanto se cumplen
 * los `PASADA_MIN_MS` desde la última emisión, sin que el vehículo se haya movido nunca de
 * verdad. Exigir DOS fixes consecutivos fuera del radio antes de re-armar filtra ese outlier
 * sin perder ninguna salida real: a 20 km/h, dos fixes a `locationUpdateInterval: 10_000` ya
 * cubren ~55 m, de sobra para confirmar que el vehículo realmente se está alejando.
 */
export const FIXES_REARME_CONSECUTIVOS = 2;

/*
 * M3 (hallazgo de revisión, medio — reemplaza al gate de accuracy de `location-task.ts`): la
 * precisión del fix (`accuracyM`) se aplica **solo al RE-ARMADO**, nunca a la ENTRADA.
 *
 * El gate anterior descartaba de la máquina de estados TODA detección cuyo fix tuviera
 * `accuracy > radioToleranciaM`. Con los radios sembrados de la Z12 (100 m,
 * `packages/db/prisma/seed.ts`) y una Android que reporta 100-500 m de rutina en calles
 * encajonadas o cuando cae a localización por red, ese gate **borraba pasadas reales**: la
 * pasada no se emitía, no quedaba telemetría, y la evidencia de esa vuelta simplemente no
 * existía. Un criterio que "entra" solo con `distanciaM + accuracy <= radio` tiene el mismo
 * defecto: con `accuracy` crónicamente peor que el radio, NINGÚN fix puede satisfacerlo.
 *
 * La asimetría es deliberada porque los dos errores no cuestan lo mismo y las distancias en
 * juego tampoco son del mismo orden:
 * - **Entrar** (emitir una pasada) ocurre a distancias MENORES que el radio (0-100 m). Exigirle
 *   un margen del tamaño del propio error de medición lo vuelve inalcanzable. Además la fuente
 *   de verdad auditada es el worker server-side (`ST_DWithin`, RF-39), que revalida cada
 *   cumplimiento con la coordenada real: una emisión dudosa es detectable y corregible;
 *   una pasada nunca emitida es evidencia perdida para siempre.
 * - **Re-armar** ocurre a distancias GRANDES (el vehículo se fue del punto: cientos de metros o
 *   kilómetros), así que descontarle el error de medición no impide re-armar de verdad — y sí
 *   evita el daño que A2 identificó: un re-armado espurio por jitter habilita, junto con
 *   `PASADA_MIN_MS`, una **pasada fantasma** con el vehículo parado. Ese es el único camino por
 *   el que un fix impreciso puede INVENTAR evidencia, y es el que se blinda acá.
 *
 * Corolario importante: con la histéresis, un fix impreciso ya no puede emitir por sí solo
 * estando el vehículo quieto — para volver a emitir hace falta primero un re-armado, que ahora
 * exige `FIXES_REARME_CONSECUTIVOS` fixes CONCLUYENTEMENTE fuera del radio de re-armado.
 */

/** Motivo por el que la precisión del fix condicionó una decisión de la máquina de estados.
 * Viaja hasta `registrarPuntoGps` (`headless-task.ts`), que lo convierte en un breadcrumb de
 * Sentry: sin esto, la precisión degradada seguiría siendo invisible en producción, que es
 * justo cómo el gate anterior pudo borrar pasadas durante toda una jornada sin dejar rastro. */
export type MotivoAvisoPrecision =
  /** Se emitió una pasada con un fix cuya `accuracy` es PEOR que el radio del punto: la
   *  evidencia vale (se emite igual, ver arriba) pero queda marcada como degradada. */
  | 'emision-con-precision-degradada'
  /** El fix cae fuera del radio de re-armado MEDIDO, pero no lo supera con margen suficiente
   *  para descontar su propio error: no re-arma ni suma al contador de A2 (no aporta
   *  información), solo se reporta. */
  | 'rearme-postergado-por-precision';

export interface AvisoPrecision {
  motivo: MotivoAvisoPrecision;
  puntoControlId: string;
  distanciaM: number;
  radioToleranciaM: number;
  accuracyM: number;
}

/**
 * Piso de tiempo mínimo, en milisegundos, entre dos emisiones consecutivas del MISMO punto de
 * control (misma clave `sesionId:puntoControlId`) — medido SIEMPRE sobre `tsFix` (el instante
 * del fix GPS real), NUNCA sobre `Date.now()` (el instante en que se evalúa el fix).
 *
 * El re-armado por distancia (`FACTOR_REARME_RADIO`) ya resuelve el layover: un vehículo
 * parado no re-emite mientras no se aleje. Este piso cubre el otro caso — un salto de reloj
 * del FIX (túnel, cambio de torre) — no una segunda pasada real.
 *
 * 2 minutos, no 5 (el valor usado en el replay SQL de huecos): a 20 km/h un punto de control a
 * 1 km de la terminal se pisa de ida y de vuelta con ~6 min de separación real (menos con
 * tráfico) — 5 min borraría esa pasada genuina. Y tiene que medirse sobre `tsFix`, no
 * `Date.now()`: una ráfaga de salida de Doze entrega en el mismo instante real 20 fixes con
 * `tsFix` de minutos distintos — evaluarlos contra el reloj de la evaluación (todos casi
 * simultáneos) los colapsaría en una sola pasada, exactamente la deformación que `tsFix`
 * existe para evitar en el resto del pipeline.
 */
export const PASADA_MIN_MS = 2 * 60 * 1000;

/** Estado de histéresis de UN punto de control para UNA sesión (clave `claveCumplimiento`). */
export interface EstadoPuntoControl {
  /** `true` mientras el vehículo sigue "dentro" de la pasada actual — no re-armó todavía. */
  dentro: boolean;
  /** `tsFix` (epoch ms) de la última emisión de este punto de control. `-Infinity` si nunca
   * se emitió, para que `PASADA_MIN_MS` nunca bloquee la primera pasada. */
  ultimoEmitidoMs: number;
  /** Cuántas pasadas de este punto de control se emitieron hasta ahora — arranca en 1 con la
   * primera emisión, nunca se reinicia mientras haya semilla del outbox (ver
   * `clavesCumplimientoDesdePayloads` en `location-task.ts`). */
  pasadas: number;
  /** A2 (hallazgo de revisión): cuántos fixes CONSECUTIVOS se vienen viendo fuera del radio de
   * re-armado (`radio * FACTOR_REARME_RADIO`) mientras `dentro: true` — hacen falta
   * `FIXES_REARME_CONSECUTIVOS` para re-armar de verdad (ver su comentario). Se resetea a 0
   * en cuanto un fix cae de nuevo DENTRO del radio de re-armado, y también al re-armar
   * (`dentro` pasa a `false`), para arrancar la cuenta de cero la próxima vez que el punto
   * vuelva a estar `dentro: true`. Opcional para no romper los `EstadoPuntoControl`
   * construidos a mano (tests, semillas anteriores a este campo) — ausente se trata como 0.
   */
  fixesFueraRadioRearme?: number;
  /** A3 (hallazgo de revisión, alto): `tsFixMs` del último fix ACEPTADO (no descartado por
   * desorden) para este punto de control. El SDK entrega ubicaciones BUFFERADAS en ráfaga al
   * salir de Doze — el orden de LLEGADA no garantiza el orden real de los `tsFix` — así que
   * un fix cuyo `tsFixMs` sea menor o igual a este valor se descarta de las transiciones de
   * estado (`filtrarNuevosCumplimientos`), aunque se siga encolando su `gps_point` (eso pasa
   * en `location-task.ts`, fuera de esta función: la traza cruda es la evidencia y no se
   * toca). Opcional por el mismo motivo que `fixesFueraRadioRearme`: ausente se trata como
   * `-Infinity` (nunca descarta el primer fix real).
   */
  ultimoFixMs?: number;
}

/** B1 (hallazgo de revisión, bajo): `Object.freeze` en vez de un objeto de módulo mutable —
 * nadie muta este literal hoy (toda transición nueva es un objeto fresco vía spread), pero un
 * descuido futuro que sí lo hiciera corrompería el estado inicial de TODOS los puntos de
 * control a la vez, ya que `?? ESTADO_INICIAL` devuelve la MISMA referencia compartida. */
const ESTADO_INICIAL: Readonly<EstadoPuntoControl> = Object.freeze({
  dentro: false,
  ultimoEmitidoMs: -Infinity,
  pasadas: 0,
});

/** Un cumplimiento que corresponde emitir en este tick, con el número de pasada que le toca. */
export interface CumplimientoAEmitir {
  deteccion: DeteccionPuntoControl;
  clave: string;
  pasada: number;
}

export interface ResultadoFiltrado {
  /** Cumplimientos nuevos a encolar en este tick (nueva pasada detectada). */
  emitir: CumplimientoAEmitir[];
  /**
   * Transiciones de estado a aplicar — una entrada por cada detección de este tick cuyo fix
   * fue ACEPTADO (no descartado por desorden, ver `ultimoFixMs`/A3 más abajo), sin importar si
   * `dentro`/`pasadas` cambiaron: todo fix aceptado tiene que dejar registrado su `tsFixMs` en
   * `ultimoFixMs`, así que ya no alcanza con emitir transición SOLO cuando algo "visible"
   * cambia (antes de A3, un tick sin novedad no generaba entrada acá). Esta función sigue
   * siendo PURA y no muta nada: a propósito, el caller (`construirEventosDeUbicacion` en
   * `location-task.ts`, y en última instancia `registrarPuntoGps` en `headless-task.ts`) debe
   * aplicar estas transiciones SOLO DESPUÉS de confirmar que los eventos correspondientes
   * quedaron persistidos en el outbox. Si `encolarEvento` falla, el estado tiene que seguir
   * reflejando lo que realmente se escribió, no lo que se intentó escribir (plan §2.4,
   * hallazgo de revisión: "el Set se muta antes de confirmar la escritura").
   */
  transiciones: Map<string, EstadoPuntoControl>;
  /** M3: decisiones de este tick condicionadas por la precisión del fix — ver `AvisoPrecision`.
   * Vacío en el caso normal (fix preciso, o sin `accuracyM` conocida). */
  avisosPrecision: AvisoPrecision[];
}

/**
 * Máquina de estados con histéresis (multi-vuelta, plan §2.3): decide, para cada detección de
 * este tick, si corresponde EMITIR un cumplimiento nuevo (pasada nueva) según el estado
 * previo de cada punto de control — reemplaza al supresor "solo la primera vez" (un
 * `Set<string>` que nunca dejaba pasar una segunda pasada).
 *
 * | Estado actual   | Condición                                                            | Acción                                          |
 * |-----------------|-------------------------------------------------------------------------|--------------------------------------------------|
 * | (cualquiera)    | `tsFixMs <= ultimoFixMs` (fix fuera de orden, A3)                      | descarta el fix (sin transición)                 |
 * | `dentro: false` | `cumplido` y `tsFix - ultimoEmitidoMs >= PASADA_MIN_MS`                | **emitir**, `dentro = true`                      |
 * | `dentro: false` | `cumplido` pero NO pasó `PASADA_MIN_MS` (B5)                          | `dentro = true` SIN emitir (misma visita)        |
 * | `dentro: true`  | `distanciaM <= radio * FACTOR_REARME_RADIO`                            | nada (misma pasada), resetea el contador de A2   |
 * | `dentro: true`  | fuera del radio de re-armado pero dentro del margen de `accuracy` (M3)  | nada (fix no concluyente), solo aviso de precisión |
 * | `dentro: true`  | `distanciaM - accuracy > radio * FACTOR_REARME_RADIO`, < `FIXES_REARME_CONSECUTIVOS` fixes seguidos | suma un fix al contador de A2, no re-arma todavía |
 * | `dentro: true`  | `distanciaM - accuracy > radio * FACTOR_REARME_RADIO`, ya van `FIXES_REARME_CONSECUTIVOS` seguidos  | `dentro = false` (re-arma, NO emite)             |
 */
export function filtrarNuevosCumplimientos(
  estados: ReadonlyMap<string, EstadoPuntoControl>,
  detecciones: DeteccionPuntoControl[],
  sesionId: string,
  tsFixMs: number,
): ResultadoFiltrado {
  const emitir: CumplimientoAEmitir[] = [];
  const transiciones = new Map<string, EstadoPuntoControl>();
  const avisosPrecision: AvisoPrecision[] = [];

  for (const deteccion of detecciones) {
    const clave = claveCumplimiento(sesionId, deteccion.puntoControlId);
    const estado = estados.get(clave) ?? ESTADO_INICIAL;

    // A3 (hallazgo de revisión, alto): un fix bufferado que llega DESPUÉS pero con un tsFix
    // ANTERIOR (o igual) al último ya aceptado para este punto de control se descarta por
    // completo de las transiciones de estado — procesarlo desordenado puede re-armar o emitir
    // con información vieja. El SDK entrega bufferado en ráfaga tras Doze, así que `tsFixMs`
    // yendo hacia atrás es el caso real, no el raro. El `gps_point` correspondiente se sigue
    // encolando siempre (eso pasa en `construirEventosDeUbicacion`, `location-task.ts`, fuera
    // de esta función — es la evidencia cruda y no se toca).
    const ultimoFixMs = estado.ultimoFixMs ?? -Infinity;
    if (tsFixMs <= ultimoFixMs) continue;

    // M3: margen de error del fix. Solo descuenta en el RE-ARMADO — ver el comentario largo de
    // `MotivoAvisoPrecision`/M3 arriba para el porqué de la asimetría.
    const margenM = deteccion.accuracyM ?? 0;

    if (!estado.dentro) {
      if (deteccion.cumplido && tsFixMs - estado.ultimoEmitidoMs >= PASADA_MIN_MS) {
        const pasada = estado.pasadas + 1;
        emitir.push({ deteccion, clave, pasada });
        transiciones.set(clave, {
          dentro: true,
          ultimoEmitidoMs: tsFixMs,
          pasadas: pasada,
          fixesFueraRadioRearme: 0,
          ultimoFixMs: tsFixMs,
        });
        if (margenM > deteccion.radioToleranciaM) {
          // La pasada se emite igual (M3), pero queda marcada: el fix que la sustenta tiene un
          // error de medición mayor que el propio radio del punto de control.
          avisosPrecision.push({
            motivo: 'emision-con-precision-degradada',
            puntoControlId: deteccion.puntoControlId,
            distanciaM: deteccion.distanciaM,
            radioToleranciaM: deteccion.radioToleranciaM,
            accuracyM: margenM,
          });
        }
      } else if (deteccion.cumplido) {
        // B5 (hallazgo de revisión, bajo): CUMPLE pero todavía no pasó `PASADA_MIN_MS` desde la
        // última emisión. Antes esta rama dejaba `dentro: false`, así que el piso no atribuía
        // la entrada a la visita en curso sino que RETRASABA la emisión: el vehículo que
        // re-arma, vuelve a entrar antes de los 2 min y se queda, no emitía nada al entrar y
        // emitía recién al vencer el piso — con un `ts` de minutos DESPUÉS de la llegada real,
        // en el registro que sustenta una sanción. `PASADA_MIN_MS` existe justo para declarar
        // que una reentrada tan pegada a la emisión anterior es la MISMA visita (cubre el salto
        // de reloj del fix, no una vuelta nueva; ver su comentario), así que lo correcto es
        // marcarla como visita en curso — `dentro: true`, sin emitir — en vez de dejar armado
        // un gatillo que dispara tarde y con el timestamp equivocado.
        //
        // No pierde ninguna pasada real: `ultimoEmitidoMs` no se toca (la pasada ya emitida
        // sigue siendo la que manda) y una vuelta genuina posterior tiene que re-armar por
        // distancia igual que siempre, ahí sí emitiendo con el `tsFix` de su propia entrada.
        transiciones.set(clave, {
          ...estado,
          dentro: true,
          fixesFueraRadioRearme: 0,
          ultimoFixMs: tsFixMs,
        });
      } else {
        // No cumple todavía: sin cambios de fondo, pero el fix SÍ se aceptó — hay que dejar
        // `ultimoFixMs` al día para que un fix más viejo que llegue después se descarte (A3).
        transiciones.set(clave, { ...estado, ultimoFixMs: tsFixMs });
      }
      continue;
    }

    const radioRearme = deteccion.radioToleranciaM * FACTOR_REARME_RADIO;
    if (deteccion.distanciaM - margenM > radioRearme) {
      // A2 (hallazgo de revisión, alto): hacen falta `FIXES_REARME_CONSECUTIVOS` fixes
      // SEGUIDOS fuera del radio de re-armado para re-armar de verdad — un outlier de un solo
      // fix (jitter de GPS) suma al contador pero no re-arma por sí solo (ver el comentario de
      // la constante). M3: además el fix tiene que estar fuera CON MARGEN, descontando su
      // propia `accuracy`, para que un fix impreciso no habilite una pasada fantasma.
      const consecutivos = (estado.fixesFueraRadioRearme ?? 0) + 1;
      if (consecutivos >= FIXES_REARME_CONSECUTIVOS) {
        transiciones.set(clave, {
          ...estado,
          dentro: false,
          fixesFueraRadioRearme: 0,
          ultimoFixMs: tsFixMs,
        });
      } else {
        transiciones.set(clave, {
          ...estado,
          fixesFueraRadioRearme: consecutivos,
          ultimoFixMs: tsFixMs,
        });
      }
    } else if (deteccion.distanciaM > radioRearme) {
      // M3: medido fuera del radio de re-armado, pero no lo supera descontando su propio error
      // de medición — el fix NO es concluyente. Ni re-arma ni suma al contador de A2 (no
      // aporta información en ninguna dirección) y tampoco lo resetea; solo deja el aviso para
      // que la precisión degradada sea visible en Sentry.
      avisosPrecision.push({
        motivo: 'rearme-postergado-por-precision',
        puntoControlId: deteccion.puntoControlId,
        distanciaM: deteccion.distanciaM,
        radioToleranciaM: deteccion.radioToleranciaM,
        accuracyM: margenM,
      });
      transiciones.set(clave, { ...estado, ultimoFixMs: tsFixMs });
    } else {
      // Sigue dentro del radio de re-armado: misma pasada. Si venía acumulando outliers, este
      // fix los desmiente — resetea el contador de A2.
      transiciones.set(clave, { ...estado, fixesFueraRadioRearme: 0, ultimoFixMs: tsFixMs });
    }
  }

  return { emitir, transiciones, avisosPrecision };
}

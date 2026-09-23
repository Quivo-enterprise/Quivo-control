import { RADIO_AVISO_M, haversineMetros, type PuntoControlPaquete } from '@quivo/shared';

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
  /**
   * ENTREGA 6 (plan post-piloto 2026-09-09, "separar detección de anuncio"): distingue el
   * AVISO informativo de aproximación (voz, mientras el vehículo se acerca — se calcula FUERA
   * de esta máquina de estados, ver `construirEventosDeUbicacion` en `location-task.ts`, sobre
   * TODAS las detecciones sin importar `cumplido`) de la CONFIRMACIÓN de paso (sonido +
   * vibración + toast, emitida acá en `filtrarNuevosCumplimientos` recién en el "mínimo local"
   * de la visita — ver el comentario largo de esa función). `undefined` para una
   * `DeteccionPuntoControl` cruda de `detectarPuntosControlCercanos` que todavía no pasó por
   * ninguna de las dos decisiones.
   *
   * DECISIÓN CTO 2026-09-23 (`RADIO_CONFIRMACION_M`, `@quivo/shared`): `'confirmado-proximidad'`
   * distingue el anuncio de "llegaste" en TIEMPO REAL — apenas un fix mide `distanciaM <=
   * RADIO_CONFIRMACION_M` (40 m) durante una visita YA activa (`dentro && confirmado === false`,
   * ver `deteccionConfirmacionProximidad` en `construirEventosDeUbicacion`,
   * `location-task.ts`) — de `'confirmado'` (arriba), que es la confirmación LIGADA A LA
   * EVIDENCIA (mínimo local / fallback), que puede tardar varios fixes más en llegar (recién
   * cuando la distancia empieza a CRECER). Deliberadamente NO toca la detección/registro del
   * cumplimiento (que sigue exactamente igual): es una señal puramente de UX, calculada por
   * fuera de esta máquina de estados, igual que `'aproximacion'`.
   */
  fase?: 'aproximacion' | 'confirmado' | 'confirmado-proximidad';
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

/**
 * ENTREGA 6 (plan post-piloto 2026-09-09, FALLBACK OBLIGATORIO): cuántos fixes ACEPTADOS
 * dentro del radio de detección, durante una visita que TODAVÍA no confirmó por "mínimo
 * local" (ver el comentario largo de `filtrarNuevosCumplimientos`), fuerzan la confirmación
 * igual — con el mínimo que se haya visto hasta ese momento, aunque la distancia nunca haya
 * empezado a crecer.
 *
 * Sin este piso, un vehículo que se detiene EXACTO en su punto más cercano (semáforo, cola,
 * layover) nunca vería la distancia crecer dentro de esa visita: el "mínimo local" no se
 * detectaría jamás y el cumplimiento NO SE EMITIRÍA NUNCA — evidencia perdida para siempre,
 * justo lo que este plan declara inaceptable sin excepción (aunque el vehículo esté, de
 * hecho, exactamente sobre el punto de control). Valor PROVISIONAL, sin validar contra datos
 * reales (pendiente de la Entrega 18 del plan, replay SQL): 6 fixes da margen para no
 * confirmar sobre un primer fix ruidoso sin demorar la evidencia más de lo razonable.
 */
export const FIXES_FALLBACK_CONFIRMACION_SIN_MINIMO = 6;

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
  /**
   * ENTREGA 6 ("mínimo local"): distancia MÍNIMA observada durante la visita en curso,
   * mientras `dentro === true` y todavía NO se confirmó esta visita (`confirmado` abajo, en
   * `false`) — el candidato a `distanciaMinAproximacionM` del próximo cumplimiento que se
   * emita. `undefined` cuando no hay visita sin confirmar en curso: recién re-armado, o ya
   * confirmada (ver `confirmado`).
   */
  minDistanciaM?: number;
  /**
   * ENTREGA 6: distancia del fix que hizo `cumplido = true` por primera vez en la visita en
   * curso — viaja en el payload emitido como `distanciaEntradaM`, junto al mínimo real
   * (`distanciaMinAproximacionM`), para que quede registro de AMBOS números: el que decía la
   * voz vieja (distancia de entrada, 104-150 m en el piloto del 09-09) y el que dice el
   * mínimo local nuevo. Mismo ciclo de vida que `minDistanciaM`.
   */
  distanciaEntradaM?: number;
  /**
   * ENTREGA 6 (insumo del FALLBACK OBLIGATORIO, ver `FIXES_FALLBACK_CONFIRMACION_SIN_MINIMO`):
   * cuántos fixes ACEPTADOS lleva la visita en curso sin haber confirmado todavía. Mismo
   * ciclo de vida que `minDistanciaM` — se limpia (`undefined`) al confirmar o al re-armar.
   */
  fixesDentroSinConfirmar?: number;
  /**
   * ENTREGA 6: ya se confirmó (emitió) el cumplimiento de la visita en curso — por
   * crecimiento genuino de la distancia o por el fallback de fixes sin mínimo claro. Evita
   * una segunda confirmación si la distancia sigue oscilando (jitter) dentro de la MISMA
   * visita, sin depender de que `minDistanciaM` quede `undefined` (que también pasa al
   * re-armar). Se resetea a `false` recién en la PRÓXIMA entrada (nueva visita, ver el primer
   * bloque de `filtrarNuevosCumplimientos`). Opcional por el mismo motivo que los campos de
   * arriba: ausente se trata como `false` para no romper `EstadoPuntoControl` construidos a
   * mano (tests, semillas anteriores a esta entrega) — un estado sin este campo nunca tiene
   * una visita en curso sin confirmar de todos modos (`dentro: false` implícito).
   */
  confirmado?: boolean;
  /**
   * FIX POST-REVISIÓN (bug 1, "el servidor puede rechazar el paso"): identidad del punto de
   * control de ESTA visita — necesaria para que `confirmarVisitasVencidas` (heartbeat, ver más
   * abajo) pueda reconstruir una `DeteccionPuntoControl` completa sin tener un fix nuevo a
   * mano (el heartbeat no trae posición: "The heartbeat event does not actively engage
   * location-services", doc del SDK). Se fija en la rama de ENTRADA y no se limpia al
   * confirmar (no hace falta: `confirmado === false` ya gatea todo lo que la lee).
   */
  puntoControlId?: string;
  /** Mismo motivo que `puntoControlId` — copia de `deteccion.radioToleranciaM` al momento de
   * ENTRAR, para reconstruir la detección sin un fix nuevo. */
  radioToleranciaM?: number;
  /**
   * FIX POST-REVISIÓN (bug 1): coordenadas del fix CANDIDATO — el más cercano visto durante la
   * visita en curso — NO las del fix que finalmente dispara la confirmación. El bug: el evento
   * `cumplimiento_punto_control` viajaba con `location.coords` del fix que confirma (el que
   * muestra que la distancia volvió a crecer), que puede estar YA FUERA del radio de
   * tolerancia (ejemplo real: radio 150, entra a 146 m, el fix que confirma está a 158 m) — el
   * worker revalida con `ST_DWithin` exactamente esas coordenadas contra `radioToleranciaM`
   * (`ingesta-worker.service.ts`) y las rechaza (`cumplido=false`), perdiendo evidencia de un
   * paso real. Con el candidato, el evento SIEMPRE lleva una posición DENTRO del radio (por
   * construcción: es el mínimo observado) — la revalidación server-side pasa siempre.
   * Se fija en la rama de ENTRADA (con el fix de entrada) y se actualiza cada vez que un fix
   * nuevo mejora el mínimo (`mejoraElMinimo`, ver el cuerpo de la función) — mismo ciclo de
   * vida que `minDistanciaM`, con el que viaja siempre en sincronía.
   */
  candidatoLat?: number;
  /** Ver `candidatoLat`. */
  candidatoLng?: number;
  /** `tsFixMs` (epoch ms) del fix candidato — igual razón que `candidatoLat`/`candidatoLng`: el
   * evento tiene que llevar la HORA del fix más cercano, no la del fix que confirma (que puede
   * ser varios fixes y minutos después en un vehículo lento). */
  candidatoTsFixMs?: number;
  /**
   * FIX POST-REVISIÓN (G1, "la voz se re-anuncia dentro del radio de aviso"): histéresis PROPIA
   * de la marca de voz de aproximación, TOTALMENTE INDEPENDIENTE de `dentro`/
   * `fixesFueraRadioRearme` (la histéresis de DETECCIÓN, sobre `radioToleranciaM`). El bug: con
   * `radioToleranciaM` (30 m) mucho más chico que `RADIO_AVISO_M` (150 m), la detección re-arma
   * en cuanto el vehículo supera `radioToleranciaM * FACTOR_REARME_RADIO` (45 m) por
   * `FIXES_REARME_CONSECUTIVOS` fixes — con el vehículo TODAVÍA a 60-140 m, bien adentro de
   * `RADIO_AVISO_M`. Antes de este fix, ese re-armado de DETECCIÓN era lo único que limpiaba
   * `aproximacionesAnunciadas` (`anuncio-punto-control.ts`), así que el próximo fix dentro de
   * `RADIO_AVISO_M` (que sigue habiendo, el vehículo no se fue) volvía a pasar por
   * `fase: 'aproximacion'` con el dedupe YA libre → segunda voz anunciando una "aproximación" de
   * un punto del que en realidad se está alejando.
   *
   * `true` mientras el vehículo sigue "dentro" del ciclo de aviso actual (entró a
   * `RADIO_AVISO_M` en algún fix reciente y todavía no se alejó lo suficiente) — se pone en
   * `true` cada vez que un fix cae `<= RADIO_AVISO_M` (sin importar `cumplido`/`dentro` de
   * detección) y se resetea a `false` recién cuando el fix se aleja más allá de
   * `RADIO_AVISO_M * FACTOR_REARME_RADIO` (225 m con el default) por `FIXES_REARME_CONSECUTIVOS`
   * fixes SEGUIDOS — misma constante de histéresis que la detección, pero sobre el radio de
   * AVISO, no el de detección. Optional por el mismo motivo que el resto de los campos de
   * histéresis: ausente se trata como `false` (nunca se anunció, nada que rearmar).
   */
  avisoVozDentro?: boolean;
  /** Contador de fixes CONSECUTIVOS vistos más allá de `RADIO_AVISO_M * FACTOR_REARME_RADIO`
   * mientras `avisoVozDentro: true` — mismo rol que `fixesFueraRadioRearme` pero para la
   * histéresis de voz (ver `avisoVozDentro`). Se resetea a 0 en cuanto un fix vuelve a caer
   * `<= RADIO_AVISO_M`, y también al rearmar (`avisoVozDentro` pasa a `false`). Ausente se trata
   * como 0. */
  avisoVozFixesFueraRadioRearme?: number;
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
  /** ENTREGA 6: distancia del fix de ENTRADA de esta visita (lo que antes era, sin más,
   * `deteccion.distanciaM` de la emisión). */
  distanciaEntradaM: number;
  /** ENTREGA 6: distancia MÍNIMA real observada durante la visita — por qué se confirma AHORA
   * (la distancia empezó a crecer desde acá) o, en el caso del fallback, el mínimo visto hasta
   * el momento de forzar la confirmación. Ver `FIXES_FALLBACK_CONFIRMACION_SIN_MINIMO`. */
  distanciaMinAproximacionM: number;
  /**
   * FIX POST-REVISIÓN (bug 1): coordenadas/hora del fix CANDIDATO (el mínimo real de la
   * visita) — lo que el evento `cumplimiento_punto_control` debe llevar en `lat`/`lng`/`tsFix`,
   * NO la posición/hora del fix que disparó esta confirmación. Ver el comentario largo de
   * `EstadoPuntoControl.candidatoLat`. Opcional solo porque `filtrarNuevosCumplimientos` recibe
   * `posicionFix` como parámetro OPCIONAL (para no romper las decenas de call sites de
   * `geofence.test.ts` que no lo necesitan) — todo caller real (`location-task.ts`,
   * `confirmarVisitasVencidas`) los deja siempre definidos.
   */
  candidatoLat?: number;
  /** Ver `candidatoLat` de arriba. */
  candidatoLng?: number;
  /** Ver `candidatoLat` de arriba. */
  candidatoTsFixMs?: number;
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
  /**
   * FIX POST-REVISIÓN (bug 4, "un vehículo detenido nunca confirma" — en realidad, hallazgo
   * mellizo de bug 4: "la voz vuelve a anunciar la aproximación al alejarse"): `puntoControlId`
   * de los puntos que ESTE tick re-armó DE VERDAD (`dentro: true → false`, tras
   * `FIXES_REARME_CONSECUTIVOS` fixes concluyentes fuera de `radio * FACTOR_REARME_RADIO`) —
   * el único momento en que corresponde reabrir el aviso de aproximación por voz
   * (`limpiarAproximacionesAnunciadas`, `features/operacion/anuncio-punto-control.ts`).
   * Confirmar (`fase: 'confirmado'`) NO va acá: el vehículo puede seguir a <150 m, todavía
   * alejándose del punto, mucho antes de que el re-armado real ocurra — reabrir ahí es
   * exactamente el bug (la voz repite la aproximación mientras se aleja, y la aproximación
   * REAL de la vuelta siguiente queda en silencio porque el ciclo ya estaba "usado"). Vacío en
   * el caso normal (ningún punto re-armó en este tick).
   *
   * FIX POST-REVISIÓN (G1): desde ese fix, este campo YA NO alimenta
   * `limpiarAproximacionesAnunciadas` — ver `puntosRearmadosVoz` abajo, que tiene su propia
   * histéresis sobre `RADIO_AVISO_M` en vez de la de detección. Se conserva igual porque sigue
   * siendo el único lugar que expone la transición real de `dentro` (detección), útil para
   * telemetría/depuración aunque hoy no tenga otro consumidor.
   */
  puntosRearmados: string[];
  /**
   * FIX POST-REVISIÓN (G1, "la voz se re-anuncia dentro del radio de aviso"): `puntoControlId`
   * de los puntos cuya histéresis de VOZ (`avisoVozDentro`/`avisoVozFixesFueraRadioRearme`, ver
   * `EstadoPuntoControl`) re-armó DE VERDAD este tick — el único momento en que corresponde
   * reabrir `aproximacionesAnunciadas` (`limpiarAproximacionesAnunciadas`,
   * `anuncio-punto-control.ts`). Deliberadamente independiente de `puntosRearmados` (arriba, la
   * histéresis de DETECCIÓN): con `radioToleranciaM` mucho más chico que `RADIO_AVISO_M`, la
   * detección re-arma mucho antes de que el vehículo realmente salga de la zona de aviso — usar
   * esa señal para la voz es justo el bug que este campo existe para cerrar. Vacío en el caso
   * normal (ningún punto re-armó su voz en este tick).
   */
  puntosRearmadosVoz: string[];
}

/**
 * Máquina de estados con histéresis (multi-vuelta, plan §2.3): decide, para cada detección de
 * este tick, si corresponde EMITIR un cumplimiento nuevo (pasada nueva) según el estado
 * previo de cada punto de control — reemplaza al supresor "solo la primera vez" (un
 * `Set<string>` que nunca dejaba pasar una segunda pasada).
 *
 * ENTREGA 6 (plan post-piloto 2026-09-09, "el corazón del arreglo") — MÍNIMO LOCAL: la
 * detección (`radioToleranciaM`, histéresis de re-armado, `PASADA_MIN_MS`) sigue exactamente
 * igual, pero la EMISIÓN del cumplimiento ya no ocurre en el instante de ENTRADA al radio
 * (donde la distancia real al punto es cualquier valor entre ~104 y 150 m, según la
 * perpendicular de paso — geometría determinista, no ruido). Ahora se DIFIERE hasta el
 * "mínimo local": el fix más cercano al punto real de la visita en curso, detectado quien
 * primero muestra que la distancia volvió a CRECER. Costo: ~1 fix de latencia (~15 m con el
 * muestreo constante de producción) — imperceptible. Beneficio: `distanciaMinAproximacionM`
 * queda cerca del paso real en vez de cerca del borde del radio de detección.
 *
 * FALLBACK OBLIGATORIO (`FIXES_FALLBACK_CONFIRMACION_SIN_MINIMO`): si el vehículo se detiene
 * DENTRO del radio (semáforo, cola, layover), la distancia nunca vuelve a crecer y el mínimo
 * local nunca se detectaría por sí solo — sin este piso, la evidencia de esa pasada NUNCA se
 * emitiría. Perder evidencia es inaceptable, así que tras N fixes sin confirmar se confirma
 * igual con el mínimo visto hasta ese momento.
 *
 * | Estado actual                    | Condición                                                                | Acción                                                    |
 * |-----------------------------------|---------------------------------------------------------------------------|------------------------------------------------------------|
 * | (cualquiera)                      | `tsFixMs <= ultimoFixMs` (fix fuera de orden, A3)                        | descarta el fix (sin transición)                            |
 * | `dentro: false`                   | `cumplido` y `tsFix - ultimoEmitidoMs >= PASADA_MIN_MS`                  | ENTRA: `dentro = true`, arranca seguimiento del mínimo local, **sin emitir todavía** |
 * | `dentro: false`                   | `cumplido` pero NO pasó `PASADA_MIN_MS` (B5)                            | `dentro = true` SIN emitir, `confirmado = true` (visita ya cerrada, ver B5) |
 * | `dentro: true`, `confirmado: false` | `distanciaM > mínimo visto hasta ahora` (creciendo) O ya van `FIXES_FALLBACK_CONFIRMACION_SIN_MINIMO` fixes sin confirmar | **CONFIRMA/emite** con el mínimo, `confirmado = true`, `pasadas += 1` |
 * | `dentro: true`, `confirmado: false` | ninguna de las de arriba                                                | actualiza el mínimo visto y el contador de fixes, sigue sin confirmar |
 * | `dentro: true`                    | `distanciaM <= radio * FACTOR_REARME_RADIO`                              | nada más (misma pasada), resetea el contador de A2          |
 * | `dentro: true`                    | fuera del radio de re-armado pero dentro del margen de `accuracy` (M3)   | nada (fix no concluyente), solo aviso de precisión           |
 * | `dentro: true`                    | `distanciaM - accuracy > radio * FACTOR_REARME_RADIO`, < `FIXES_REARME_CONSECUTIVOS` seguidos | suma un fix al contador de A2, no re-arma todavía            |
 * | `dentro: true`                    | `distanciaM - accuracy > radio * FACTOR_REARME_RADIO`, ya van `FIXES_REARME_CONSECUTIVOS` seguidos | `dentro = false` (re-arma). Si no había confirmado, confirma ANTES (ver nota) |
 *
 * Nota sobre el orden confirmación-antes-que-rearme: un vehículo que pasa RÁPIDO (sin
 * lingerear) puede saltar, de un fix al siguiente, de "cerca del punto" a "más allá del radio
 * de re-armado" sin pasar por un tick intermedio "todavía cerca pero ya alejándose" — la
 * condición de "creciendo" (arriba) sigue disparando en ESE MISMO tick porque compara contra
 * el mínimo GUARDADO, no contra el fix anterior, así que la confirmación siempre corre antes
 * de que el re-armado pueda cerrar la visita sin haber emitido nunca.
 */
export function filtrarNuevosCumplimientos(
  estados: ReadonlyMap<string, EstadoPuntoControl>,
  detecciones: DeteccionPuntoControl[],
  sesionId: string,
  tsFixMs: number,
  /**
   * FIX POST-REVISIÓN (bug 1): lat/lng del fix que produjo `detecciones` en este tick — el
   * mismo `location.coords` que ya usa el caller para construir el `gps_point` del tick
   * (`construirEventosDeUbicacion`, `location-task.ts`). OPCIONAL a propósito: las decenas de
   * call sites existentes de `geofence.test.ts` no lo necesitan (no verifican `candidatoLat`);
   * sin este parámetro, `candidatoLat`/`candidatoLng` quedan `undefined` y el caller real
   * (`location-task.ts`) cae a la posición del fix que confirma — el comportamiento previo a
   * este fix, nunca peor. `tsFixMs` (el 4º parámetro, siempre requerido) SÍ se registra como
   * `candidatoTsFixMs` sin depender de este parámetro: la hora del candidato no necesita
   * coordenadas para tener sentido.
   */
  posicionFix?: { lat: number; lng: number },
): ResultadoFiltrado {
  const emitir: CumplimientoAEmitir[] = [];
  const transiciones = new Map<string, EstadoPuntoControl>();
  const avisosPrecision: AvisoPrecision[] = [];
  const puntosRearmados: string[] = [];
  const puntosRearmadosVoz: string[] = [];

  for (const deteccion of detecciones) {
    const clave = claveCumplimiento(sesionId, deteccion.puntoControlId);
    // `let`, no `const`: el bloque de histéresis de voz de abajo la reasigna con los campos
    // `avisoVoz*` actualizados ANTES de que el resto de la función arme sus transiciones — así
    // cualquier `{...estado, ...}` de más abajo (entrada, re-armado de detección, etc.) arrastra
    // esos campos sin que cada rama tenga que saber de la histéresis de voz (G1).
    let estado = estados.get(clave) ?? ESTADO_INICIAL;

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

    // FIX POST-REVISIÓN (G1, "la voz se re-anuncia dentro del radio de aviso"): histéresis de la
    // marca de voz, TOTALMENTE INDEPENDIENTE de la de detección de abajo (`dentro`/
    // `fixesFueraRadioRearme`, sobre `radioToleranciaM`) — ver el comentario largo de
    // `avisoVozDentro` en `EstadoPuntoControl`. Corre para TODA detección de este tick, sin
    // importar `cumplido`/`dentro` de la máquina de detección: a diferencia de `dentro`, que solo
    // avanza dentro del radio de detección (chico), acá lo que importa es la distancia contra
    // `RADIO_AVISO_M` (grande) — el radio que de hecho gatea cuándo suena la voz
    // (`location-task.ts`, `deteccionAproximacion`).
    let avisoVozDentro = estado.avisoVozDentro ?? false;
    let avisoVozFixesFueraRadioRearme = estado.avisoVozFixesFueraRadioRearme ?? 0;
    if (deteccion.distanciaM <= RADIO_AVISO_M) {
      // Dentro de la zona de aviso (o volviendo a estarlo): arma/mantiene armado el ciclo de voz
      // y resetea el contador de salida — un fix que vuelve a acercarse desmiente cualquier
      // outlier de alejamiento que viniera acumulando.
      avisoVozDentro = true;
      avisoVozFixesFueraRadioRearme = 0;
    } else if (avisoVozDentro && deteccion.distanciaM - margenM > RADIO_AVISO_M * FACTOR_REARME_RADIO) {
      // Fuera de la zona de aviso CON MARGEN (descontando la precisión del fix, mismo criterio
      // M3 que la detección) — cuenta como un fix de salida. Entre `RADIO_AVISO_M` y
      // `RADIO_AVISO_M * FACTOR_REARME_RADIO` (o dentro del margen de error) el fix es
      // "inconcluyente": ni suma ni resetea, igual que el tramo análogo de la detección.
      avisoVozFixesFueraRadioRearme += 1;
      if (avisoVozFixesFueraRadioRearme >= FIXES_REARME_CONSECUTIVOS) {
        // `FIXES_REARME_CONSECUTIVOS` fixes SEGUIDOS confirmando la salida: recién acá se
        // considera re-armado de verdad el ciclo de voz — mismo umbral que la detección
        // (reusado, no un valor nuevo, por pedido explícito del diseño), pero evaluado sobre
        // `RADIO_AVISO_M` en vez de `radioToleranciaM`.
        avisoVozDentro = false;
        avisoVozFixesFueraRadioRearme = 0;
        puntosRearmadosVoz.push(deteccion.puntoControlId);
      }
    }
    estado = { ...estado, avisoVozDentro, avisoVozFixesFueraRadioRearme };

    if (!estado.dentro) {
      if (deteccion.cumplido && tsFixMs - estado.ultimoEmitidoMs >= PASADA_MIN_MS) {
        // ENTREGA 6: ya NO emite acá — arranca el seguimiento del "mínimo local" (ver el
        // comentario de cabecera de la función). `pasadas` no se toca en este punto: solo se
        // incrementa cuando la visita CONFIRMA de verdad (más abajo), así que sigue
        // reflejando pasadas realmente evidenciadas, nunca visitas abiertas sin confirmar.
        transiciones.set(clave, {
          ...estado,
          dentro: true,
          fixesFueraRadioRearme: 0,
          ultimoFixMs: tsFixMs,
          minDistanciaM: deteccion.distanciaM,
          distanciaEntradaM: deteccion.distanciaM,
          // Arranca en 0, no 1: el fix de ENTRADA establece el mínimo inicial, no "falla en
          // mejorarlo" (no hay mínimo previo contra el cual comparar) — ver el comentario del
          // fallback más abajo.
          fixesDentroSinConfirmar: 0,
          confirmado: false,
          // FIX POST-REVISIÓN (bug 1 y bug 2): identidad + candidato del fix de ENTRADA — ver
          // los comentarios largos de `EstadoPuntoControl.puntoControlId`/`candidatoLat`.
          puntoControlId: deteccion.puntoControlId,
          radioToleranciaM: deteccion.radioToleranciaM,
          candidatoLat: posicionFix?.lat,
          candidatoLng: posicionFix?.lng,
          candidatoTsFixMs: tsFixMs,
        });
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
        // `confirmado: true` (ENTREGA 6): para llegar acá con `dentro: false` hace falta haber
        // re-armado, y el re-armado SIEMPRE confirma la visita anterior ANTES de re-armar (ver
        // la nota de cabecera) — así que esta reentrada NO tiene ninguna confirmación
        // pendiente: es una continuación de una visita YA evidenciada, no una nueva. Se limpian
        // los campos de seguimiento del mínimo (no hay nada que seguir).
        //
        // No pierde ninguna pasada real: `ultimoEmitidoMs` no se toca (la pasada ya confirmada
        // sigue siendo la que manda) y una vuelta genuina posterior tiene que re-armar por
        // distancia igual que siempre, ahí sí confirmando con su propio mínimo local.
        transiciones.set(clave, {
          ...estado,
          dentro: true,
          fixesFueraRadioRearme: 0,
          ultimoFixMs: tsFixMs,
          confirmado: true,
          minDistanciaM: undefined,
          distanciaEntradaM: undefined,
          fixesDentroSinConfirmar: undefined,
        });
      } else {
        // No cumple todavía: sin cambios de fondo, pero el fix SÍ se aceptó — hay que dejar
        // `ultimoFixMs` al día para que un fix más viejo que llegue después se descarte (A3).
        transiciones.set(clave, { ...estado, ultimoFixMs: tsFixMs });
      }
      continue;
    }

    // `dentro: true`: visita en curso. ENTREGA 6 — mínimo local: ANTES de evaluar el
    // re-armado, si esta visita todavía no confirmó (`estado.confirmado === false`, puesto EXPLÍCITAMENTE
    // por la rama de ENTRADA de arriba), chequear si corresponde confirmar AHORA. Se evalúa
    // `=== false` (no `!estado.confirmado`) a propósito: un `EstadoPuntoControl` sin este
    // campo (semillas del outbox vía `clavesCumplimientoDesdePayloads`, o estados construidos
    // a mano en tests anteriores a esta entrega) representa una visita YA asentada de una
    // pasada pasada — tratarlo como "confirmado" por default es el lado seguro; el único
    // camino que de verdad dispara el seguimiento del mínimo es la rama de ENTRADA, que
    // siempre deja `confirmado: false` explícito.
    let estadoBase: EstadoPuntoControl = estado;
    if (estado.confirmado === false) {
      const minPrevio = estado.minDistanciaM ?? deteccion.distanciaM;
      const creciendo = deteccion.distanciaM > minPrevio;
      // ENTREGA 6 (fix de diseño): el contador del fallback mide fixes CONSECUTIVOS SIN
      // MEJORAR el mínimo — NO fixes totales desde la entrada. Con "fixes totales" un
      // acercamiento REAL y genuino que tarda más de `FIXES_FALLBACK_CONFIRMACION_SIN_MINIMO`
      // fixes en llegar a su punto más cercano (habitual en un punto de control alejado de la
      // ruta, ver "por qué 10 m es estructuralmente imposible" en el plan) confirmaría TARDE
      // pero mal: con un mínimo a medio camino, no el real, exactamente el defecto que esta
      // entrega existe para cerrar. Mejorar el mínimo (distancia estrictamente menor) resetea
      // el contador a 0 SIEMPRE — así que una serie monótonamente decreciente, sin importar
      // cuántos fixes tarde, nunca dispara el fallback: solo lo dispara una racha de fixes que
      // NO logran un mínimo nuevo (vehículo detenido o prácticamente detenido).
      const mejoraElMinimo = deteccion.distanciaM < minPrevio;
      const fixesSinMejorar = mejoraElMinimo ? 0 : (estado.fixesDentroSinConfirmar ?? 0) + 1;
      const fallbackPorFixes = !creciendo && fixesSinMejorar >= FIXES_FALLBACK_CONFIRMACION_SIN_MINIMO;

      if (creciendo || fallbackPorFixes) {
        // CONFIRMA: si la distancia está creciendo, el mínimo GUARDADO (de un fix anterior) es
        // el mínimo real de la visita — el fix ACTUAL (que ya está más lejos) no lo desplaza.
        // Si confirma por fallback (nunca creció, pero tampoco mejoró en
        // `FIXES_FALLBACK_CONFIRMACION_SIN_MINIMO` intentos seguidos), el mínimo guardado YA es
        // el mejor visto — el fix actual, por definición de esta rama, no lo mejora.
        const distanciaMinAproximacionM = minPrevio;
        const distanciaEntradaM = estado.distanciaEntradaM ?? distanciaMinAproximacionM;
        const pasada = estado.pasadas + 1;
        // FIX POST-REVISIÓN (bug 1): candidato del ESTADO (el fix del mínimo, guardado en la
        // rama de ENTRADA o en la de "mejora el mínimo" de abajo) — NUNCA el fix ACTUAL (el que
        // dispara esta confirmación, que puede estar más lejos que el mínimo: es justo lo que
        // "la distancia volvió a crecer" significa). Sin este fallback a `tsFixMs` el candidato
        // quedaría `undefined` solo en el caso degenerado de un `EstadoPuntoControl` que llegó
        // hasta acá con `confirmado === false` pero sin haber pasado por la rama de ENTRADA
        // (no debería ocurrir por construcción, pero un `tsFixMs` es preferible a nada).
        const candidatoLat = estado.candidatoLat;
        const candidatoLng = estado.candidatoLng;
        const candidatoTsFixMs = estado.candidatoTsFixMs ?? tsFixMs;
        emitir.push({
          deteccion: {
            ...deteccion,
            // `cumplido: true` explícito: el fix ACTUAL (el que disparó la confirmación
            // creciendo o por fallback) puede estar, él mismo, más allá del radio de
            // detección — la confirmación no depende de que ESTE fix puntual cumpla, depende
            // de que la visita YA pasó por el mínimo local. Sin este override, un consumidor
            // que gatea en `cumplido` (`ControlFeedbackToast`, `gps-provider.tsx`) podría
            // quedarse mudo justo en el tick que confirma la pasada real.
            cumplido: true,
            fase: 'confirmado',
            pasada,
            distanciaM: distanciaMinAproximacionM,
          },
          clave,
          pasada,
          distanciaEntradaM,
          distanciaMinAproximacionM,
          candidatoLat,
          candidatoLng,
          candidatoTsFixMs,
        });
        if (margenM > deteccion.radioToleranciaM) {
          // La pasada se emite igual (M3), pero queda marcada: el fix que la sustenta tiene un
          // error de medición mayor que el propio radio del punto de control. Se evalúa con la
          // `accuracy` del fix ACTUAL (el que dispara la confirmación), no la del fix del
          // mínimo — es el fix que efectivamente sustenta la evidencia emitida en este tick.
          avisosPrecision.push({
            motivo: 'emision-con-precision-degradada',
            puntoControlId: deteccion.puntoControlId,
            distanciaM: distanciaMinAproximacionM,
            radioToleranciaM: deteccion.radioToleranciaM,
            accuracyM: margenM,
          });
        }
        estadoBase = {
          ...estado,
          ultimoEmitidoMs: tsFixMs,
          pasadas: pasada,
          confirmado: true,
          minDistanciaM: undefined,
          distanciaEntradaM: undefined,
          fixesDentroSinConfirmar: undefined,
        };
      } else {
        // Todavía no corresponde confirmar: si este fix mejoró el mínimo, lo adopta (y resetea
        // el contador del fallback a 0 — ver el comentario de arriba); si no, mantiene el
        // mínimo guardado y suma un fix al contador. Sigue "sin confirmar" — el re-armado de
        // abajo se evalúa igual con este `estadoBase` (ver la nota de cabecera sobre por qué
        // el orden es seguro).
        estadoBase = {
          ...estado,
          minDistanciaM: mejoraElMinimo ? deteccion.distanciaM : minPrevio,
          fixesDentroSinConfirmar: fixesSinMejorar,
          // FIX POST-REVISIÓN (bug 1): el candidato SIGUE al mínimo — si este fix lo mejoró,
          // pasa a ser el nuevo candidato; si no, se conserva el de antes (mismo criterio que
          // `minDistanciaM` en la línea de arriba).
          candidatoLat: mejoraElMinimo ? posicionFix?.lat : estado.candidatoLat,
          candidatoLng: mejoraElMinimo ? posicionFix?.lng : estado.candidatoLng,
          candidatoTsFixMs: mejoraElMinimo ? tsFixMs : estado.candidatoTsFixMs,
        };
      }
    }

    const radioRearme = deteccion.radioToleranciaM * FACTOR_REARME_RADIO;
    if (deteccion.distanciaM - margenM > radioRearme) {
      // A2 (hallazgo de revisión, alto): hacen falta `FIXES_REARME_CONSECUTIVOS` fixes
      // SEGUIDOS fuera del radio de re-armado para re-armar de verdad — un outlier de un solo
      // fix (jitter de GPS) suma al contador pero no re-arma por sí solo (ver el comentario de
      // la constante). M3: además el fix tiene que estar fuera CON MARGEN, descontando su
      // propia `accuracy`, para que un fix impreciso no habilite una pasada fantasma.
      const consecutivos = (estadoBase.fixesFueraRadioRearme ?? 0) + 1;
      if (consecutivos >= FIXES_REARME_CONSECUTIVOS) {
        // FIX POST-REVISIÓN (bug 4): este es el ÚNICO lugar donde `dentro` (DETECCIÓN) pasa de
        // `true` a `false` de verdad. FIX POST-REVISIÓN (G1): esto YA NO reabre el aviso de voz
        // — ver `puntosRearmadosVoz`/`avisoVozDentro` arriba, que tienen su propia histéresis
        // sobre `RADIO_AVISO_M` en vez de reusar ésta (el bug que G1 cierra).
        puntosRearmados.push(deteccion.puntoControlId);
        transiciones.set(clave, {
          ...estadoBase,
          dentro: false,
          fixesFueraRadioRearme: 0,
          ultimoFixMs: tsFixMs,
        });
      } else {
        transiciones.set(clave, {
          ...estadoBase,
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
      transiciones.set(clave, { ...estadoBase, ultimoFixMs: tsFixMs });
    } else {
      // Sigue dentro del radio de re-armado: misma pasada. Si venía acumulando outliers, este
      // fix los desmiente — resetea el contador de A2.
      transiciones.set(clave, { ...estadoBase, fixesFueraRadioRearme: 0, ultimoFixMs: tsFixMs });
    }
  }

  return { emitir, transiciones, avisosPrecision, puntosRearmados, puntosRearmadosVoz };
}

/**
 * FIX POST-REVISIÓN (bug 2, "un vehículo detenido nunca confirma"): antigüedad máxima, en ms,
 * que puede tener el fix CANDIDATO de una visita SIN CONFIRMAR antes de forzar su confirmación
 * en el próximo `heartbeat` del SDK — cubre el caso de un vehículo que se DETIENE dentro del
 * radio y nunca vuelve a producir un fix nuevo: un vehículo parado no dispara `onLocation`
 * (`distanceFilter: 15` — sin desplazamiento no hay fix), así que
 * `FIXES_FALLBACK_CONFIRMACION_SIN_MINIMO` (el fallback existente, que cuenta FIXES) nunca se
 * alcanza — no hay fixes nuevos que contar — y la visita queda pendiente para siempre. El caso
 * real que esto existe para cerrar: el ÚLTIMO punto de control de una ruta, en la terminal,
 * donde el chofer se estaciona y apaga el motor — sin este piso NUNCA se registra.
 *
 * 90 s: dentro del rango 60-120 s pedido. `heartbeatInterval: 60`
 * (`background-geolocation.config.ts`) — dos heartbeats sin fix nuevo (bajo `distanceFilter: 15`,
 * el vehículo llevaría sin moverse ≥15 m durante ≥90 s) es señal fuerte de vehículo detenido: un
 * semáforo largo o una cola corta rara vez llegan a dos ciclos completos de heartbeat, y un
 * layover real (terminal, control con parada obligatoria) los supera de sobra. Es además corto
 * en términos absolutos: el chofer no espera más de un minuto y medio para sentir/escuchar la
 * confirmación de que su parada quedó registrada.
 */
export const UMBRAL_ANTIGUEDAD_CANDIDATO_MS = 90 * 1000;

/**
 * FIX POST-REVISIÓN (bug 2, hallazgo propio surgido al escribir los tests de este fix — no
 * estaba en la lista original de `/code-review`): `confirmarVisitasVencidas` opera sobre TODO
 * el Map que recibe, sin distinguir sesión — correcto para `puntosControlDetectados.current`
 * de `use-gps-operativo.ts` (foreground), que `sembrarCumplimientos` REEMPLAZA entero en cada
 * cambio de `sesionId` (nunca mezcla dos sesiones). Pero NO es seguro para
 * `puntosControlDetectadosHeadless` (`headless-task.ts`): ese Map es un singleton de MÓDULO que
 * `asegurarSemillaCumplimientos` solo AGREGA entradas, nunca limpia — si el mismo contexto JS
 * headless sobrevive un cambio de turno (chofer nuevo en el MISMO dispositivo/vehículo, sin
 * reinicio de proceso — el caso NORMAL en un dispositivo atado al vehículo, no al chofer), una
 * visita sin confirmar de la sesión ANTERIOR queda viva en el Map. Sin este filtro, el próximo
 * heartbeat de la sesión NUEVA la confirmaría igual — `aplicarConfirmacionesForzadas` usa un
 * único `sesionId` (el de la sesión ACTUAL) para TODO lo que `confirmarVisitasVencidas` emite,
 * así que un paso de la sesión VIEJA se encolaría atribuido a la sesión NUEVA (evidencia con
 * `sesionId` incorrecto).
 *
 * `estado.puntoControlId` (guardado en la rama de ENTRADA, FIX bug 1) es lo que permite
 * reconstruir la clave esperada y compararla: solo sobrevive una entrada cuya clave coincide
 * EXACTAMENTE con `claveCumplimiento(sesionId, estado.puntoControlId)` — el resto (de otra
 * sesión, o sin `puntoControlId` por ser un `EstadoPuntoControl` viejo/incompleto) se ignora en
 * este heartbeat, SIN tocarlo en el Map original (`estados` no se muta — devuelve un Map nuevo).
 */
export function filtrarPorSesion(
  estados: ReadonlyMap<string, EstadoPuntoControl>,
  sesionId: string,
): Map<string, EstadoPuntoControl> {
  const filtrado = new Map<string, EstadoPuntoControl>();
  for (const [clave, estado] of estados) {
    if (
      estado.puntoControlId !== undefined &&
      clave === claveCumplimiento(sesionId, estado.puntoControlId)
    ) {
      filtrado.set(clave, estado);
    }
  }
  return filtrado;
}

/**
 * FIX POST-REVISIÓN (bug 2): recorre TODO el Map de estados y confirma (con el candidato ya
 * guardado, sin necesitar un fix nuevo) toda visita `dentro: true, confirmado: false` cuyo
 * candidato lleve sin mejorar `>= umbralMs`. Pensada para dos callers, con el MISMO umbral
 * jugando dos roles distintos:
 * - El handler de `heartbeat` (headless y foreground, ver `anuncio-punto-control.ts` y
 *   `headless-task.ts`/`use-gps-operativo.ts`): `umbralMs = UMBRAL_ANTIGUEDAD_CANDIDATO_MS`, la
 *   antigüedad real de arriba.
 * - El cierre del recorrido (`fin_recorrido`, plan diseño B, "cierre del recorrido"):
 *   `umbralMs = 0` — fuerza la confirmación de TODA visita pendiente sin importar su edad, para
 *   que ningún paso quede en el limbo cuando el chofer detiene o finaliza. `0` funciona sin
 *   ninguna rama especial porque `ahoraMs - candidatoTsFixMs` es siempre `>= 0` para un
 *   candidato ya observado.
 *
 * Deliberadamente NO registra ningún `gps_point`: el heartbeat del SDK "no engancha activamente
 * los servicios de ubicación" (doc oficial) — inventar una posición sería fabricar evidencia
 * GPS que el dispositivo nunca produjo. El punto de control SÍ se confirma con el candidato ya
 * observado (una posición real, solo que no la más reciente).
 *
 * Best-effort defensivo: una visita sin `puntoControlId`/`radioToleranciaM`/candidato completo
 * (un `EstadoPuntoControl` construido a mano en un test viejo, o una semilla incompleta) se
 * salta en silencio en vez de forzar una confirmación con datos a medias — el fallback normal
 * por fixes (`FIXES_FALLBACK_CONFIRMACION_SIN_MINIMO`) sigue cubriendo esas visitas apenas
 * llegue un fix nuevo.
 */
export function confirmarVisitasVencidas(
  estados: ReadonlyMap<string, EstadoPuntoControl>,
  ahoraMs: number,
  umbralMs: number = UMBRAL_ANTIGUEDAD_CANDIDATO_MS,
): ResultadoFiltrado {
  const emitir: CumplimientoAEmitir[] = [];
  const transiciones = new Map<string, EstadoPuntoControl>();

  for (const [clave, estado] of estados) {
    if (!estado.dentro || estado.confirmado !== false) continue;
    if (
      estado.candidatoTsFixMs === undefined ||
      estado.candidatoLat === undefined ||
      estado.candidatoLng === undefined ||
      estado.minDistanciaM === undefined ||
      estado.puntoControlId === undefined ||
      estado.radioToleranciaM === undefined
    ) {
      continue;
    }
    if (ahoraMs - estado.candidatoTsFixMs < umbralMs) continue;

    const distanciaMinAproximacionM = estado.minDistanciaM;
    const distanciaEntradaM = estado.distanciaEntradaM ?? distanciaMinAproximacionM;
    const pasada = estado.pasadas + 1;
    emitir.push({
      deteccion: {
        puntoControlId: estado.puntoControlId,
        distanciaM: distanciaMinAproximacionM,
        cumplido: true,
        radioToleranciaM: estado.radioToleranciaM,
        fase: 'confirmado',
        pasada,
      },
      clave,
      pasada,
      distanciaEntradaM,
      distanciaMinAproximacionM,
      candidatoLat: estado.candidatoLat,
      candidatoLng: estado.candidatoLng,
      candidatoTsFixMs: estado.candidatoTsFixMs,
    });
    transiciones.set(clave, {
      ...estado,
      // Ojo: `ultimoEmitidoMs` se sella con la hora del CANDIDATO (la hora real de paso), no
      // `ahoraMs` (la hora en que el heartbeat lo notó) — mismo criterio que el resto del
      // módulo: `PASADA_MIN_MS` de la PRÓXIMA pasada tiene que medirse desde el paso real, no
      // desde cuándo se enteró el sistema.
      ultimoEmitidoMs: estado.candidatoTsFixMs,
      pasadas: pasada,
      confirmado: true,
      minDistanciaM: undefined,
      distanciaEntradaM: undefined,
      fixesDentroSinConfirmar: undefined,
    });
  }

  // Sin `puntosRearmados`/`puntosRearmadosVoz`: confirmar por antigüedad/cierre nunca re-arma
  // ninguna de las dos histéresis por sí solo — `dentro` (detección) sigue en `true` (la visita
  // solo se cierra en curso, igual que el camino normal de confirmación por distancia) y
  // `avisoVozDentro` (G1) no se toca acá; las dos siguen re-armando únicamente por el camino
  // normal de fixes reales (`filtrarNuevosCumplimientos`).
  return { emitir, transiciones, avisosPrecision: [], puntosRearmados: [], puntosRearmadosVoz: [] };
}

import { RADIO_CONFIRMACION_M } from '@quivo/shared';
import { claveCumplimiento, type DeteccionPuntoControl, type EstadoPuntoControl } from '../../gps/geofence';

/**
 * REDISEÑO (decisión del CTO, ronda posterior al veredicto `partial` de Codex `verify-fix` del
 * 2026-09-23): módulo NUEVO, sin React ni SQLite (mismo criterio que `geofence.ts`/
 * `location-task.ts` — testeable bajo vitest/Node), que concentra la ÚNICA decisión de si
 * corresponde anunciarle al chofer "llegaste" a un punto de control y por qué motivo.
 *
 * Reemplaza tres mecanismos que antes vivían MEZCLADOS con la máquina de estados de EVIDENCIA
 * (`geofence.ts`): el anuncio inmediato al entrar a `RADIO_CONFIRMACION_M`, el fallback por
 * tiempo (`UMBRAL_ANUNCIO_PROXIMIDAD_MS`, antes evaluado únicamente por
 * `evaluarAnunciosProximidadVencidos`, que NINGÚN caller de producción invocaba — solo los
 * tests) y el fallback por salida del radio sin haber anunciado nunca. Los tres bugs reales que
 * esta separación cierra:
 * - La EVIDENCIA (fotos/registro de cumplimiento) disparaba anuncios por su cuenta
 *   (`gps-provider.tsx`, `anuncio-punto-control.ts` viejo) — acá la evidencia ni siquiera es un
 *   parámetro de `decidirAnuncio`: no puede disparar nada porque no tiene forma de hacerlo.
 * - El fallback de 90 s nunca corría en producción (solo desde tests) — ahora es el ÚNICO
 *   camino para decidir `'fallback-tiempo'`, y el único punto de llamada (`gps/headless-task.ts`,
 *   dentro de `colaRegistroGps`) lo invoca tanto para fixes reales como para heartbeats.
 * - El estado "¿ya anuncié esta visita?" vivía entreverado con `confirmado`/`minDistanciaM` (el
 *   estado de EVIDENCIA) — acá es un ciclo de vida propio (`anuncioHecho`/`anuncioDesdeMs`,
 *   `EstadoPuntoControl`), que `geofence.ts` solo resetea al ENTRAR a una visita nueva (igual
 *   que resetea `minDistanciaM`) pero nunca vuelve a tocar.
 */

/** Motivo por el que corresponde anunciarle "llegaste" al chofer — nunca por evidencia. */
export type MotivoAnuncio = 'proximidad' | 'fallback-tiempo' | 'fallback-salida';

/** Lista runtime de `MotivoAnuncio` — única fuente de verdad para `esMotivoAnuncio`, así que un
 * motivo nuevo agregado al tipo de arriba sin actualizar acá se detecta por inspección directa
 * (son 3 literales, no vale la pena un mapeo generado). */
const MOTIVOS_ANUNCIO: readonly MotivoAnuncio[] = ['proximidad', 'fallback-tiempo', 'fallback-salida'];

/**
 * FIX POST-REVISIÓN (hallazgo 10, cleanup — "validar `motivo` antes de `textoAnuncioLlegada`"):
 * guarda de tipo runtime para `motivo` — `anuncio-punto-control.ts` lee `motivo` como `TEXT` sin
 * restricción desde `anuncios_punto_control` (`reintentarAnunciosLlegadaPendientes`) y antes lo
 * casteaba a ciegas (`as MotivoAnuncio`) antes de pasarlo a `textoAnuncioLlegada` — un valor
 * corrupto o de una versión futura de la app (columna `TEXT` sin `CHECK`, ver `outbox-ddl.ts`)
 * caía en el `switch` exhaustivo de `textoAnuncioLlegada` sin ningún caso que lo cubra, lo que
 * TypeScript no puede pescar en runtime (el cast ya mintió sobre el tipo).
 */
export function esMotivoAnuncio(valor: string): valor is MotivoAnuncio {
  return (MOTIVOS_ANUNCIO as readonly string[]).includes(valor);
}

/** Antigüedad máxima, en ms, que una visita activa puede pasar sin haber anunciado antes de que
 * el fallback dispare igual — mismo valor (90 s) y mismo escenario físico (vehículo detenido)
 * que documentaba `UMBRAL_ANUNCIO_PROXIMIDAD_MS` en `geofence.ts` antes de este rediseño; vive
 * acá ahora porque gobierna el ANUNCIO, no la evidencia. */
export const UMBRAL_ANUNCIO_PROXIMIDAD_MS = 90 * 1000;

/** Estado de anuncio de UNA visita — ciclo de vida propio, independiente de `confirmado`/
 * `minDistanciaM` (el estado de evidencia). `desdeMs` es el reloj contra el que se mide el
 * fallback de tiempo: el instante en que la visita ENTRÓ en curso (mismo momento que arranca el
 * seguimiento del mínimo local de evidencia, pero es un campo propio — ver el docblock de
 * `EstadoPuntoControl.anuncioDesdeMs`). */
export interface EstadoAnuncioVisita {
  /** `true` si esta visita YA produjo una decisión de anuncio (cualquier motivo) — una vez
   * `true`, `decidirAnuncio` no vuelve a decidir nada para la MISMA visita. */
  anunciado: boolean;
  /** `tsFixMs`/`ahoraMs` de referencia para el fallback de tiempo. `undefined` cuando no hay
   * ninguno conocido (visita reconstruida sin este dato, p. ej. tras un reinicio del proceso) —
   * `decidirAnuncio` lo trata como "recién entrando ahora", el mismo criterio de "más vale
   * reiniciar el reloj que inventar una fecha" que ya aplica el resto de este pipeline a otros
   * campos de reconstrucción best-effort. */
  desdeMs?: number;
}

/** Entrada de un FIX real (el vehículo se movió, hay un `location.coords` nuevo). */
export interface EntradaAnuncioFix {
  tipo: 'fix';
  /** `'activa'`: la visita sigue `dentro` este tick, con una distancia real de la que decidir
   * proximidad. `'saliendo'`: este fix es el que RE-ARMA la histéresis de detección (la visita
   * se cierra) — no hay distancia relevante, la única pregunta es si ya se había anunciado. */
  visita: 'activa' | 'saliendo';
  /** Distancia REAL de este fix al punto de control — solo se lee cuando `visita === 'activa'`. */
  distanciaM: number;
  /** `RADIO_CONFIRMACION_M` — parametrizado (no hardcodeado) para que el test pueda variarlo sin
   * depender de la constante de `@quivo/shared` y para que el texto del anuncio (`
   * anuncio-punto-control.ts`) y la decisión deriven siempre del mismo número. */
  radioConfirmacionM: number;
}

/** Entrada de un HEARTBEAT del SDK (vehículo detenido, sin fix nuevo — `HeartbeatEvent.location`
 * es la última posición conocida, no una lectura fresca: nunca se usa para decidir proximidad,
 * solo el paso del tiempo). */
export interface EntradaAnuncioHeartbeat {
  tipo: 'heartbeat';
}

export type EntradaAnuncio = EntradaAnuncioFix | EntradaAnuncioHeartbeat;

export interface ResultadoDecisionAnuncio {
  motivo: MotivoAnuncio | null;
  estado: EstadoAnuncioVisita;
}

/**
 * LA decisión de anuncio — función PURA, sin I/O. Tabla de verdad (ver `decidir-anuncio.test.ts`):
 *
 * | `estadoAnuncio.anunciado` | `entrada`                          | `motivo`           |
 * |----------------------------|-------------------------------------|---------------------|
 * | `true`                     | (cualquiera)                        | `null` (ya se avisó) |
 * | `false`                    | fix, saliendo                       | `'fallback-salida'` |
 * | `false`                    | fix, activa, `distanciaM <= radio`  | `'proximidad'`      |
 * | `false`                    | fix/heartbeat, `ahora - desde >= umbral` | `'fallback-tiempo'` |
 * | `false`                    | ninguna de las anteriores           | `null` (todavía no)  |
 *
 * "nueva pasada": el CALLER (el único punto de llamada, ver `gps/headless-task.ts`) resetea
 * `estadoAnuncio` a `{ anunciado: false, desdeMs: undefined }` en cada ENTRADA a una visita
 * nueva — acá no hay ningún caso especial para eso, es simplemente un `estadoAnuncio` fresco.
 */
export function decidirAnuncio(
  estadoAnuncio: EstadoAnuncioVisita,
  entrada: EntradaAnuncio,
  ahoraMs: number,
  umbralFallbackMs: number = UMBRAL_ANUNCIO_PROXIMIDAD_MS,
): ResultadoDecisionAnuncio {
  if (estadoAnuncio.anunciado) return { motivo: null, estado: estadoAnuncio };

  const desdeMs = estadoAnuncio.desdeMs ?? ahoraMs;

  if (entrada.tipo === 'fix' && entrada.visita === 'saliendo') {
    return { motivo: 'fallback-salida', estado: { anunciado: true, desdeMs } };
  }

  if (entrada.tipo === 'fix' && entrada.distanciaM <= entrada.radioConfirmacionM) {
    return { motivo: 'proximidad', estado: { anunciado: true, desdeMs } };
  }

  if (ahoraMs - desdeMs >= umbralFallbackMs) {
    return { motivo: 'fallback-tiempo', estado: { anunciado: true, desdeMs } };
  }

  return { motivo: null, estado: { anunciado: false, desdeMs } };
}

/** Una decisión de anuncio ya tomada, lista para que `anuncio-punto-control.ts` la ejecute
 * (reclamar la intención durable + programar la notificación). */
export interface AnuncioDecidido {
  motivo: MotivoAnuncio;
  puntoControlId: string;
  pasada: number;
  /** Distancia informativa (no forma parte de la decisión ya tomada) — el mínimo conocido para
   * el caso de heartbeat/salida, o la distancia real del fix para proximidad. */
  distanciaM: number;
  radioToleranciaM: number;
}

function estadoAnuncioDe(estado: EstadoPuntoControl): EstadoAnuncioVisita {
  return { anunciado: estado.anuncioHecho === true, desdeMs: estado.anuncioDesdeMs };
}

function pasadaDeLaVisita(estado: EstadoPuntoControl): number {
  return estado.confirmado === false ? estado.pasadas + 1 : estado.pasadas;
}

/**
 * ÚNICO orquestador de anuncios para FIXES reales — recorre `detecciones` (la lista CRUDA de
 * este tick, `detectarPuntosControlCercanos`, todos los puntos de control sin importar
 * `cumplido`) y, para cada uno con una visita relevante (activa o recién saliendo), llama a
 * `decidirAnuncio` UNA vez. Llamado desde el único punto de llamada dentro de
 * `colaRegistroGps` (`gps/headless-task.ts`, `registrarPuntoGpsInterno`) — nunca desde
 * `gps-provider.tsx`, que ya no tiene disparador propio.
 *
 * `estadosAntes` es el Map TAL COMO ESTABA antes de este tick (para detectar la ENTRADA:
 * `dentro` pasa de `false`/ausente a `true`) y `transicionesEstado` es la salida YA CALCULADA de
 * `filtrarNuevosCumplimientos` para el MISMO tick (el "después" de evidencia) — ninguna de las
 * dos requiere I/O, así que esta función corre ANTES de que el caller empiece a persistir nada,
 * sin ventana de generación que proteger (no hay ningún `await` de por medio).
 */
export function evaluarAnunciosDeFixes(
  estadosAntes: ReadonlyMap<string, EstadoPuntoControl>,
  transicionesEstado: ReadonlyMap<string, EstadoPuntoControl>,
  detecciones: readonly DeteccionPuntoControl[],
  puntosRearmados: readonly string[],
  sesionId: string,
  tsFixMs: number,
): { anuncios: AnuncioDecidido[]; transiciones: Map<string, EstadoPuntoControl> } {
  const anuncios: AnuncioDecidido[] = [];
  const transiciones = new Map<string, EstadoPuntoControl>();
  const puntosRearmadosSet = new Set(puntosRearmados);

  for (const det of detecciones) {
    const clave = claveCumplimiento(sesionId, det.puntoControlId);
    const despues = transicionesEstado.get(clave);
    if (!despues) continue; // fix descartado (A3) o sin transición este tick: nada que decidir

    const estabaActiva = estadosAntes.get(clave)?.dentro === true;
    const sigueActiva = despues.dentro === true;
    const saliendo = estabaActiva && !sigueActiva && puntosRearmadosSet.has(det.puntoControlId);

    if (!sigueActiva && !saliendo) continue; // ni activa ni recién saliendo: no hay visita relevante

    const estadoAnuncioAntes = estadoAnuncioDe(despues);
    if (estadoAnuncioAntes.anunciado) continue; // ya se decidió para esta visita, nada que hacer

    const entrada: EntradaAnuncio = saliendo
      ? { tipo: 'fix', visita: 'saliendo', distanciaM: det.distanciaM, radioConfirmacionM: RADIO_CONFIRMACION_M }
      : { tipo: 'fix', visita: 'activa', distanciaM: det.distanciaM, radioConfirmacionM: RADIO_CONFIRMACION_M };

    const { motivo, estado: nuevoEstadoAnuncio } = decidirAnuncio(estadoAnuncioAntes, entrada, tsFixMs);
    transiciones.set(clave, {
      ...despues,
      anuncioHecho: nuevoEstadoAnuncio.anunciado,
      anuncioDesdeMs: nuevoEstadoAnuncio.desdeMs,
    });

    if (motivo) {
      anuncios.push({
        motivo,
        puntoControlId: det.puntoControlId,
        pasada: pasadaDeLaVisita(despues),
        distanciaM: det.distanciaM,
        radioToleranciaM: despues.radioToleranciaM ?? det.radioToleranciaM,
      });
    }
  }

  return { anuncios, transiciones };
}

/**
 * ÚNICO orquestador de anuncios para HEARTBEATS — hermano de `evaluarAnunciosDeFixes`, pero sin
 * fix nuevo del que leer distancia: solo evalúa el fallback de TIEMPO sobre las visitas activas
 * sin anunciar. Reemplaza a `evaluarAnunciosProximidadVencidos` (removida de `geofence.ts` en
 * este rediseño) — la diferencia real, y el motivo por el que aquella nunca corría en
 * producción, es que ahora el ÚNICO punto de llamada (`confirmarVisitasVencidasEnCola`,
 * `gps/headless-task.ts`) la invoca en el mismo lugar donde ya evalúa el heartbeat de EVIDENCIA,
 * dentro de la misma `colaRegistroGps`.
 */
export function evaluarAnuncioDeHeartbeat(
  estados: ReadonlyMap<string, EstadoPuntoControl>,
  ahoraMs: number,
  umbralMs: number = UMBRAL_ANUNCIO_PROXIMIDAD_MS,
): { anuncios: AnuncioDecidido[]; transiciones: Map<string, EstadoPuntoControl> } {
  const anuncios: AnuncioDecidido[] = [];
  const transiciones = new Map<string, EstadoPuntoControl>();

  for (const [clave, estado] of estados) {
    if (estado.dentro !== true) continue;
    if (estado.anuncioHecho === true) continue;
    if (estado.puntoControlId === undefined || estado.radioToleranciaM === undefined) continue;

    const estadoAnuncioAntes = estadoAnuncioDe(estado);
    const { motivo, estado: nuevoEstadoAnuncio } = decidirAnuncio(
      estadoAnuncioAntes,
      { tipo: 'heartbeat' },
      ahoraMs,
      umbralMs,
    );

    // FIX POST-REVISIÓN (hallazgo 4, code review — "con motivo null, desdeMs no se persiste, un
    // vehículo detenido que solo manda heartbeats nunca dispara fallback-tiempo"): antes, este
    // `continue` saltaba TODO — incluida la semilla de `desdeMs` que `decidirAnuncio` ya calculó
    // (`estadoAnuncio.desdeMs ?? ahoraMs`, ver su docblock). Con `estado.anuncioDesdeMs` siempre
    // `undefined` para una visita reconstruida sin ese dato (p. ej. `combinarConVisitasPendientes`
    // no lo setea — ver su docblock), CADA heartbeat volvía a sembrar `desdeMs` con el `ahoraMs`
    // de ESE heartbeat, así que la resta `ahoraMs - desdeMs` del PRÓXIMO heartbeat nunca acumulaba
    // más que el intervalo entre dos heartbeats — el fallback de 90 s jamás llegaba a vencer para
    // un vehículo detenido que solo manda heartbeats (nunca un fix real que sí persiste la
    // transición, ver `evaluarAnunciosDeFixes`). Ahora la transición se persiste SIEMPRE (motivo
    // dispare o no) — la semilla de `desdeMs` sobrevive de un heartbeat al siguiente; solo la
    // entrada a `anuncios` (lo que de verdad dispara la ejecución) sigue gateada por `motivo`.
    transiciones.set(clave, {
      ...estado,
      anuncioHecho: nuevoEstadoAnuncio.anunciado,
      anuncioDesdeMs: nuevoEstadoAnuncio.desdeMs,
    });
    if (!motivo) continue; // todavía no vence el fallback de tiempo

    anuncios.push({
      motivo,
      puntoControlId: estado.puntoControlId,
      pasada: pasadaDeLaVisita(estado),
      distanciaM: estado.minDistanciaM ?? estado.radioToleranciaM,
      radioToleranciaM: estado.radioToleranciaM,
    });
  }

  return { anuncios, transiciones };
}

import { randomUUID } from 'node:crypto';
import {
  ESPERA_MAX_ACCURACY_M,
  ESPERA_SALIDA_MARGEN_M,
  ESPERA_SALIDA_PUNTOS_CONSECUTIVOS,
  type EstadoVuelta,
  type RolPuntoControl,
} from '@quivo/shared';
import {
  VENTANA_RECORRIDO_TOLERANCIA_MS,
  dedupeKeyEsperaCorta,
  dedupeKeyMolinosOmitido,
} from './infracciones.logic.js';

/**
 * Máquina PURA de vueltas (docs/plan-molinos-designacion.md, F1). No toca la base: el worker
 * (`deteccion-vueltas.ts`) carga la última vuelta de la sesión, le pasa los eventos nuevos del
 * lote ya ordenados/filtrados y aplica los cambios + infracciones resultantes.
 *
 * Reglas:
 * - Una vuelta es terminal → terminal. Con `anclaEnTerminal` (la ruta tiene un PC `terminal`
 *   activo; el worker siempre lo activa) un `inicio_recorrido` NUNCA abre vuelta: solo marca el
 *   recorrido en curso, y la vuelta 1 la abre el primer cumplimiento `terminal` posterior. Así los
 *   PC que el chofer pasa camino a la terminal (COMENZAR RUTA tocado lejos de ella) no cuentan.
 *   EXCEPCIÓN: un `inicio_recorrido` con `enTerminal` (hecho dentro de la terminal; la app no
 *   re-emite el cumplimiento si FIN → COMENZAR sin salir del radio) abre como sin ancla.
 *   Sin ancla (default, rutas sin terminal), la PRIMERA vuelta se abre con lo que llegue primero:
 *   `terminal` o `inicio_recorrido`.
 *   Después de un `fin_recorrido` solo un `inicio_recorrido` (o, anclado, el siguiente `terminal`)
 *   abre una vuelta nueva (el GPS sigue pasando por la terminal con el recorrido terminado).
 * - Un cumplimiento `retorno` marca `pasoRetornoTs` en la vuelta en curso (el primero gana).
 * - Un cumplimiento `terminal` CON `pasoRetornoTs` cierra la vuelta `completa` y abre la
 *   siguiente con el mismo `ts` (siempre hay una en curso). SIN `pasoRetornoTs` no hace nada:
 *   SR → SR sin pasar por Honduras no cuenta vuelta.
 * - `fin_recorrido` deja la vuelta en curso `abierta_al_cierre`, salvo que esté VACÍA (ver abajo):
 *   entonces se ELIMINA. Como `fin_recorrido` usa el
 *   reloj del sistema y el cumplimiento el del GNSS, un `terminal` que llega hasta
 *   `VENTANA_RECORRIDO_TOLERANCIA_MS` (120 s, la misma tolerancia de `pc_omitido`) DESPUÉS de
 *   ese fin todavía cierra la vuelta `completa` (sin abrir otra: el recorrido terminó).
 * - Un `inicio_recorrido` con la vuelta en curso SIN `pasoRetornoTs` no hace nada (es el mismo
 *   recorrido, el chofer esperó en la terminal); con `pasoRetornoTs` es un recorrido nuevo: la
 *   vuelta en curso queda `abierta_al_cierre` y se abre otra (anclado: no se abre, espera al `terminal`).
 * - Espera: la llegada es el cumplimiento del PC de espera de la variante DESIGNADA mientras la
 *   vuelta designada está en curso. Una designada que cierra en la terminal sin llegada genera
 *   `molinos_omitido`. La salida la resuelve el worker con `avanzarSalidaEspera`/`cerrarEspera` sobre los fixes GPS (por páginas).
 *
 * Vuelta vacía: la que abrió la terminal (o un `inicio_recorrido`) y todavía no registró ningún PC
 * después (`pasoRetornoTs` y `ultimoPcTs` nulos) ni está designada. Al terminar el recorrido el
 * cumplimiento de SR cierra la vuelta N y abre la N+1; el `fin_recorrido` que sigue (o un
 * `inicio_recorrido` nuevo) la dejaría como una fila basura por recorrido, así que se ELIMINA en
 * vez de cerrarla. Nunca se elimina una designada. Como lo eliminado es siempre la ÚLTIMA vuelta,
 * la numeración del día queda sin huecos: la siguiente que se abra reutiliza ese número.
 * (El trigger `vueltas_cerrar_con_sesion` NUNCA elimina: solo deja la en curso `abierta_al_cierre`.
 * Si el cierre trae lote tardío, esta máquina la reabre, pero JAMÁS la elimina: un lote posterior
 * aún puede traer su avance. Una `abierta_al_cierre` vacía (logout sin `fin`, o lote tardío que no la
 * llenó) queda como fila y toda consulta que cuente o liste vueltas cerradas la excluye con
 * `vueltaNoVacia`/`vueltaContable`.)
 *
 * Sesión ya cerrada ("cierre tardío", `opciones.cierreTardio`): lo sincronizado antes del logout
 * pero procesado después no se pierde. Es la MISMA máquina, sin abrir vueltas nunca (ni por terminal
 * ni por `inicio_recorrido`) y sin eventos posteriores a `cierreTs` + `VENTANA_RECORRIDO_TOLERANCIA_MS`.
 * La última vuelta se reabre en memoria solo si es la que cerró el trigger (`abierta_al_cierre` con
 * `finTs >= cierreTs`; ver más abajo cuándo `finTs` supera al cierre); si quedó `abierta_al_cierre` por un `fin_recorrido` anterior se deja así y
 * actúa la rama normal (un terminal dentro de la tolerancia la cierra `completa`).
 *
 * Cualquier cumplimiento de un PC activo de la ruta (la máquina ignora los desconocidos: los filtra
 * el worker) cuenta como progreso (`ultimoPcTs`), también el PC de espera en una vuelta no designada.
 *
 * Eventos fuera de orden / tardíos (outbox móvil): NO hay un watermark global. Cada evento se
 * evalúa contra la vuelta actual y uno anterior al inicio de esa vuelta (o que ya no aplica a su
 * estado) se ignora — no mueve la máquina hacia atrás, igual que `desvio.ts`. Dentro de un lote
 * el orden es por `ts`, así que lo que llega junto se ve consistente. Limitación documentada:
 * un cumplimiento tardío que llega DESPUÉS de que la vuelta ya cerró no se aplica (p. ej. el de
 * Molinos tras el cierre en SR deja un `molinos_omitido` abierto para descarte manual), y si se
 * pierde el cumplimiento de SR por un hueco de GPS dos vueltas se fusionan.
 */

/** Vuelta tal como la ve la máquina (columnas de `vueltas` + el PC de espera de su variante). */
export interface FilaVuelta {
  id: string;
  numero: number;
  inicioTs: Date;
  finTs: Date | null;
  estado: EstadoVuelta;
  pasoRetornoTs: Date | null;
  varianteId: string | null;
  /** `variantes.puntoEsperaId` de la variante designada (no se persiste en `vueltas`). */
  puntoEsperaId: string | null;
  esperaLlegadaTs: Date | null;
  esperaSalidaTs: Date | null;
  /** Último cumplimiento de un PC distinto de la terminal (retorno, espera o común) en la vuelta. */
  ultimoPcTs: Date | null;
  /** Cursor de la salida de la espera: `ts` del último fix GPS ya evaluado (lo usa solo el worker). */
  esperaRevisadaHastaTs?: Date | null;
}

/** Vuelta vacía: sin PC tras abrirse y sin designación (candidata a eliminarse al cerrar). */
export function esVueltaVacia(
  fila: Pick<FilaVuelta, 'pasoRetornoTs' | 'ultimoPcTs' | 'varianteId' | 'esperaLlegadaTs'>,
): boolean {
  return (
    fila.varianteId === null &&
    fila.pasoRetornoTs === null &&
    fila.ultimoPcTs === null &&
    fila.esperaLlegadaTs === null
  );
}

export type EventoVuelta =
  | { clase: 'inicio'; ts: Date; enTerminal?: boolean }
  | { clase: 'fin'; ts: Date }
  | {
      clase: 'cumplimiento';
      ts: Date;
      puntoControlId: string;
      /** `puntos_control.rol` del PC; `null` = punto común (no mueve las vueltas). */
      rol: RolPuntoControl | null;
      lat: number;
      lng: number;
    };

export interface CambioVuelta {
  fila: FilaVuelta;
  /** `true` si la fila no existía antes de este avance (hay que insertarla). */
  nueva: boolean;
  /** `true` si la vuelta (vacía) se elimina en vez de cerrarse; si además es `nueva`, no se inserta. */
  eliminada?: boolean;
}

export interface InfraccionVuelta {
  tipo: 'molinos_omitido' | 'espera_corta';
  vueltaId: string;
  inicioTs: Date;
  /** `null` = la máquina no tiene posición (cierre por evento sin coordenadas): la resuelve el worker. */
  lat: number | null;
  lng: number | null;
  detalle: Record<string, unknown>;
  dedupeKey: string;
}

export interface ResultadoVueltas {
  cambios: CambioVuelta[];
  infracciones: InfraccionVuelta[];
}

/** A igual `ts`: el inicio abre antes que cualquier cumplimiento, y el fin va después. */
const PRIORIDAD_CLASE = { inicio: 0, cumplimiento: 1, fin: 2 } as const;

export interface OpcionesAvanzarVueltas {
  nuevoId?: () => string;
  /**
   * El recorrido de la sesión está en curso al empezar el lote (último `inicio_recorrido` /
   * `fin_recorrido` guardado anterior al primer evento; sin ninguno, en curso). Sin vuelta previa
   * (`ultima = null`) un `terminal` solo abre la primera vuelta si el recorrido está en curso: si
   * la primera vuelta se eliminó por vacía al terminar el recorrido, el bus estacionado que sigue
   * pasando por la terminal no debe reabrir otra. Por defecto `true`.
   */
  recorridoEnCurso?: boolean;
  /**
   * Modo "cierre tardío" (sesión de login ya cerrada): la máquina normal, pero que nunca abre una
   * vuelta y descarta lo posterior a `cierreTs` + tolerancia de relojes. La última vuelta, si el
   * trigger la dejó `abierta_al_cierre` con `finTs >= cierreTs`, se reabre en memoria; si no se
   * cierra durante el lote, vuelve a `abierta_al_cierre` con `finTs = max(cierreTs, retorno, último PC, llegada a la espera)`
   * (nunca anterior a sus hitos) y nunca se elimina.
   */
  cierreTardio?: { cierreTs: Date };
  /**
   * La ruta tiene un PC `terminal` activo: el `inicio_recorrido` no abre vueltas (ver cabecera),
   * solo el cumplimiento `terminal`. Por defecto `false` (comportamiento anterior).
   */
  anclaEnTerminal?: boolean;
}

export function avanzarVueltas(
  ultima: FilaVuelta | null,
  eventos: readonly EventoVuelta[],
  opciones: OpcionesAvanzarVueltas = {},
): ResultadoVueltas {
  const nuevoId = opciones.nuevoId ?? randomUUID;
  const cierreTardio = opciones.cierreTardio ?? null;
  const ancla = opciones.anclaEnTerminal ?? false;
  const cambios = new Map<string, CambioVuelta>();
  const infracciones: InfraccionVuelta[] = [];
  let actual: FilaVuelta | null = ultima ? { ...ultima } : null;
  let recorridoEnCurso = opciones.recorridoEnCurso ?? true;
  let reabierta = false;
  if (cierreTardio) {
    // Solo la vuelta que el trigger cerró con la sesión (su `finTs` ES el cierre) se reabre en
    // memoria; cualquier otra (completa, o `abierta_al_cierre` por un `fin_recorrido` anterior)
    // queda como está y la tratan las ramas normales.
    // `finTs >= cierreTs`: el trigger la deja en `cierreTs`; si un lote tardío anterior aplicó hitos
    // posteriores (hasta la tolerancia) la subimos a ese hito (ver el final), así que sigue siendo
    // `>= cierreTs`. Una `abierta_al_cierre` por `fin_recorrido` real tiene `finTs < cierreTs`.
    if (actual?.estado === 'abierta_al_cierre' && (actual.finTs?.getTime() ?? 0) >= cierreTardio.cierreTs.getTime()) {
      actual = { ...actual, estado: 'en_curso', finTs: null };
      reabierta = true;
    }
  }
  // Número de la última vuelta que existe (se retrocede al eliminar una vacía: sin huecos).
  let ultimoNumero = ultima?.numero ?? 0;

  const marcar = (fila: FilaVuelta, nueva = false, eliminada = false) => {
    cambios.set(fila.id, { fila, nueva: cambios.get(fila.id)?.nueva ?? nueva, eliminada });
  };
  const abrir = (ts: Date) => {
    if (cierreTardio) return; // sesión cerrada: nunca se abre una vuelta
    const fila: FilaVuelta = {
      id: nuevoId(),
      numero: ultimoNumero + 1,
      inicioTs: ts,
      finTs: null,
      estado: 'en_curso',
      pasoRetornoTs: null,
      varianteId: null,
      puntoEsperaId: null,
      esperaLlegadaTs: null,
      esperaSalidaTs: null,
      ultimoPcTs: null,
    };
    ultimoNumero = fila.numero;
    actual = fila;
    marcar(fila, true);
  };
  // Designada a Molinos que termina SIN haber pasado por el punto de espera.
  const molinosOmitido = (fila: FilaVuelta, ts: Date, lat: number | null, lng: number | null) => {
    if (fila.varianteId === null || fila.esperaLlegadaTs !== null) return;
    infracciones.push({
      tipo: 'molinos_omitido',
      vueltaId: fila.id,
      inicioTs: ts,
      lat,
      lng,
      detalle: { vueltaId: fila.id, numero: fila.numero, varianteId: fila.varianteId },
      dedupeKey: dedupeKeyMolinosOmitido(fila.id),
    });
  };
  const cerrarCompleta = (fila: FilaVuelta, ts: Date, lat: number, lng: number) => {
    fila.estado = 'completa';
    fila.finTs = ts;
    marcar(fila);
    molinosOmitido(fila, ts, lat, lng);
  };
  const cerrarAbierta = (fila: FilaVuelta, ts: Date) => {
    fila.finTs = ts;
    if (esVueltaVacia(fila) && !cierreTardio) {
      // Vacía: se elimina (jamás en cierre tardío: queda como fila vacía excluida por `vueltaNoVacia`) (es la última vuelta, la numeración no deja hueco). `fila` queda como
      // marca de "recorrido terminado" para los eventos siguientes del lote.
      fila.estado = 'abierta_al_cierre';
      marcar(fila, false, true);
      if (fila.numero === ultimoNumero) ultimoNumero -= 1;
      return;
    }
    fila.estado = 'abierta_al_cierre';
    marcar(fila);
    // Se emite sin posición: el worker la toma del último fix GPS de la sesión.
    molinosOmitido(fila, ts, null, null);
  };

  const ordenados = [...eventos]
    .filter(
      (ev) =>
        !cierreTardio ||
        ev.ts.getTime() <= cierreTardio.cierreTs.getTime() + VENTANA_RECORRIDO_TOLERANCIA_MS,
    )
    .sort((a, b) => a.ts.getTime() - b.ts.getTime() || PRIORIDAD_CLASE[a.clase] - PRIORIDAD_CLASE[b.clase]);

  for (const ev of ordenados) {
    const t = ev.ts.getTime();
    if (ev.clase === 'inicio') {
      recorridoEnCurso = true;
      if (!actual) {
        if (!ancla || ev.enTerminal) abrir(ev.ts);
      } else if (actual.estado === 'en_curso') {
        if (actual.pasoRetornoTs && t > actual.pasoRetornoTs.getTime()) {
          cerrarAbierta(actual, ev.ts);
          if (!ancla || ev.enTerminal) abrir(ev.ts);
        }
      } else if (t > (actual.finTs ?? actual.inicioTs).getTime()) {
        if (!ancla || ev.enTerminal) abrir(ev.ts);
      }
      continue;
    }

    if (ev.clase === 'fin') {
      recorridoEnCurso = false;
      if (
        actual?.estado === 'en_curso' &&
        t >= actual.inicioTs.getTime() - VENTANA_RECORRIDO_TOLERANCIA_MS
      ) {
        cerrarAbierta(actual, ev.ts);
      }
      continue;
    }

    // cumplimiento
    if (ev.rol === 'terminal') {
      if (!actual) {
        // Sin vuelta previa solo abre si el recorrido está en curso (ver `recorridoEnCurso`).
        if (recorridoEnCurso) abrir(ev.ts);
      } else if (actual.estado === 'en_curso') {
        if (actual.pasoRetornoTs && t >= actual.pasoRetornoTs.getTime()) {
          cerrarCompleta(actual, ev.ts, ev.lat, ev.lng);
          abrir(ev.ts);
        }
      } else if (
        actual.estado === 'abierta_al_cierre' &&
        actual.pasoRetornoTs &&
        t >= actual.pasoRetornoTs.getTime() &&
        t <= (actual.finTs ?? actual.inicioTs).getTime() + VENTANA_RECORRIDO_TOLERANCIA_MS
      ) {
        cerrarCompleta(actual, ev.ts, ev.lat, ev.lng);
        // Anclado: un `inicio_recorrido` posterior dejó el recorrido en curso y esta terminal arranca el siguiente.
        if (ancla && recorridoEnCurso) abrir(ev.ts);
      } else if (ancla && recorridoEnCurso && t > (actual.finTs ?? actual.inicioTs).getTime()) {
        // Anclado: la vuelta anterior ya terminó (`completa`/`abierta_al_cierre`) y el `inicio_recorrido` nuevo esperaba la terminal.
        abrir(ev.ts);
      }
    } else if (ev.rol === 'retorno') {
      if (actual?.estado === 'en_curso' && !actual.pasoRetornoTs && t >= actual.inicioTs.getTime()) {
        actual.pasoRetornoTs = ev.ts;
        actual.ultimoPcTs = ev.ts;
        marcar(actual);
      }
    } else if (ev.rol === 'espera') {
      if (actual?.estado === 'en_curso' && t >= actual.inicioTs.getTime()) {
        // La llegada solo cuenta en la vuelta designada (y al PC de SU variante), pero cualquier
        // PC de espera de la ruta es progreso: la vuelta deja de estar vacía, designada o no.
        if (
          actual.varianteId !== null &&
          actual.esperaLlegadaTs === null &&
          actual.puntoEsperaId !== null &&
          actual.puntoEsperaId === ev.puntoControlId
        ) {
          actual.esperaLlegadaTs = ev.ts;
        }
        actual.ultimoPcTs = ev.ts;
        marcar(actual);
      }
    } else if (ev.rol === null) {
      // Punto común: no mueve la máquina, pero la vuelta deja de estar vacía.
      if (actual?.estado === 'en_curso' && t >= actual.inicioTs.getTime()) {
        actual.ultimoPcTs = ev.ts;
        marcar(actual);
      }
    }
  }

  if (reabierta && ultima && actual?.estado === 'en_curso') {
    // No terminó: sigue siendo la vuelta que el trigger cerró con la sesión. Su `finTs` nunca es
    // anterior a sus propios hitos (retorno, último PC, llegada a la espera: de este lote o de
    // anteriores), o la ventana de la salida de la espera (`desde <= hasta`) quedaría vacía.
    // NUNCA se elimina, aunque siga vacía: un lote posterior todavía puede traer su avance
    // (las consultas la excluyen con `vueltaNoVacia`/`vueltaContable`).
    actual.estado = 'abierta_al_cierre';
    actual.finTs = new Date(
      Math.max(
        cierreTardio!.cierreTs.getTime(),
        ...[actual.pasoRetornoTs, actual.ultimoPcTs, actual.esperaLlegadaTs].map((d) => d?.getTime() ?? 0),
      ),
    );
  }

  return { cambios: [...cambios.values()], infracciones };
}

/** Fix GPS con su distancia al punto de espera (la calcula PostGIS en el worker). */
export interface FixEspera {
  ts: Date;
  lat: number;
  lng: number;
  accuracy: number | null;
  distanciaM: number;
}

/**
 * Estado incremental de la salida del punto de espera: permite evaluar los fixes página a página
 * (sin re-correr todo lo acumulado) y deriva el cursor seguro de lo ya evaluado.
 */
export interface EstadoSalidaEspera {
  /** Fixes válidos consecutivos fuera de `radio + margen` hasta ahora. */
  racha: number;
  /** Primer fix de la racha en curso (`null` si `racha == 0`). */
  primero: FixEspera | null;
  /** `ts` del último fix VÁLIDO evaluado (preciso y con distancia finita). */
  ultimoValidoTs: Date | null;
  /** Clave del último fix válido: un duplicado (mismo instante y posición) no suma dos veces. */
  ultimaClave: string | null;
}

export function crearEstadoSalidaEspera(): EstadoSalidaEspera {
  return { racha: 0, primero: null, ultimoValidoTs: null, ultimaClave: null };
}

/**
 * Avanza el estado con una página de fixes (cualquier orden dentro de la página; las páginas
 * llegan en orden de `ts`). Devuelve la salida en cuanto la racha de
 * `ESPERA_SALIDA_PUNTOS_CONSECUTIVOS` (2) fixes válidos a más de `radioM + ESPERA_SALIDA_MARGEN_M`
 * se completa; el instante es el del PRIMERO de la racha. Los fixes imprecisos
 * (`accuracy > ESPERA_MAX_ACCURACY_M`; nula se acepta) o sin distancia finita se descartan antes de
 * contar: no cortan ni suman la racha. Duplicados: solo se descarta el idéntico inmediatamente
 * anterior (barato; con el orden por `ts` un duplicado siempre es adyacente).
 */
export function avanzarSalidaEspera(
  estado: EstadoSalidaEspera,
  fixes: readonly FixEspera[],
  params: { llegadaTs: Date; radioM: number; hastaTs?: Date | null },
): { ts: Date; lat: number; lng: number } | null {
  const umbral = params.radioM + ESPERA_SALIDA_MARGEN_M;
  const hasta = params.hastaTs ?? null;
  const validos = fixes
    .filter(
      (f) =>
        f.ts.getTime() > params.llegadaTs.getTime() &&
        (hasta === null || f.ts.getTime() <= hasta.getTime()) &&
        (f.accuracy === null || f.accuracy <= ESPERA_MAX_ACCURACY_M) &&
        Number.isFinite(f.distanciaM),
    )
    .sort((a, b) => a.ts.getTime() - b.ts.getTime());
  for (const f of validos) {
    const clave = `${f.ts.getTime()}|${f.lat}|${f.lng}`;
    if (clave === estado.ultimaClave) continue;
    estado.ultimaClave = clave;
    estado.ultimoValidoTs = f.ts;
    if (f.distanciaM > umbral) {
      if (estado.racha === 0) estado.primero = f;
      estado.racha += 1;
      if (estado.racha >= ESPERA_SALIDA_PUNTOS_CONSECUTIVOS && estado.primero) {
        return { ts: estado.primero.ts, lat: estado.primero.lat, lng: estado.primero.lng };
      }
    } else {
      estado.racha = 0;
      estado.primero = null;
    }
  }
  return null;
}

/**
 * Cursor seguro de lo ya evaluado: solo cubre fixes realmente evaluados (válidos). Con una racha
 * fuera de radio EN CURSO y sin confirmar nunca pasa del primer fix de la racha (queda 1 ms antes):
 * el siguiente lote tiene que volver a verlo. Sin racha, es el último fix válido (que quedó dentro).
 */
export function cursorSalidaEspera(estado: EstadoSalidaEspera): Date | null {
  if (estado.racha > 0 && estado.primero) return new Date(estado.primero.ts.getTime() - 1);
  return estado.ultimoValidoTs;
}

/**
 * Inicio de la ventana de fixes de una espera pendiente:
 * `max(llegada, min(cursor, mínimo GPS del lote) - margen)`. Un lote cuyos fixes son MÁS VIEJOS que
 * el cursor (se confirmaron después que otros más nuevos) obliga a retroceder hasta ellos. Sin
 * cursor la espera nunca se evaluó: se empieza en la llegada (un mínimo GPS posterior a la llegada
 * dejaría sin ver fixes de lotes anteriores). Sin mínimo GPS (lote sin fixes) manda el cursor.
 */
export function inicioVentanaEspera(p: {
  llegadaTs: Date;
  cursor: Date | null;
  gpsMinTs: Date | null;
  margenMs: number;
}): Date {
  if (!p.cursor) return p.llegadaTs;
  const base = p.gpsMinTs ? Math.min(p.cursor.getTime(), p.gpsMinTs.getTime()) : p.cursor.getTime();
  return new Date(Math.max(p.llegadaTs.getTime(), base - p.margenMs));
}

/**
 * Cierra la espera de una vuelta designada: dada la salida confirmada, devuelve su `ts` y, si
 * esperó menos de `esperaMin`, la infracción `espera_corta` (`detalle {esperaMin, requeridoMin}`:
 * lo esperado en minutos enteros hacia abajo y lo exigido). `esperaMin` null = salida libre: solo
 * cierra la espera, sin infracción.
 */
export function cerrarEspera(
  vuelta: Pick<FilaVuelta, 'id' | 'esperaLlegadaTs'>,
  salida: { ts: Date; lat: number; lng: number },
  esperaMin: number | null,
): { esperaSalidaTs: Date; infraccion: InfraccionVuelta | null } {
  const esperadoMs = salida.ts.getTime() - vuelta.esperaLlegadaTs!.getTime();
  const infraccion: InfraccionVuelta | null =
    esperaMin !== null && esperadoMs < esperaMin * 60_000
      ? {
          tipo: 'espera_corta',
          vueltaId: vuelta.id,
          inicioTs: salida.ts,
          lat: salida.lat,
          lng: salida.lng,
          detalle: {
            esperaMin: Math.floor(esperadoMs / 60_000),
            requeridoMin: esperaMin,
            vueltaId: vuelta.id,
          },
          dedupeKey: dedupeKeyEsperaCorta(vuelta.id),
        }
      : null;
  return { esperaSalidaTs: salida.ts, infraccion };
}

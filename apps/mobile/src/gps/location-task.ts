import type { Location } from 'react-native-background-geolocation';
import {
  derivarEventIdDeterministico,
  RADIO_AVISO_M,
  resolverTsFix,
  type PuntoControlPaquete,
  type TipoEventoSync,
} from '@quivo/shared';
import {
  detectarPuntosControlCercanos,
  filtrarNuevosCumplimientos,
  claveCumplimiento,
  type AvisoPrecision,
  type DeteccionPuntoControl,
  type EstadoPuntoControl,
} from './geofence';

/**
 * Lógica pura de construcción de eventos a partir de un punto GPS (QUI-216, RF-67..73): sin
 * dependencias de React ni de módulos nativos (SQLite/SecureStore), por eso es testeable en
 * Node/vitest igual que `geofence.ts` y `battery-gap-monitor.ts`.
 *
 * Existe como módulo separado de `headless-task.ts` porque este último SÍ importa código
 * nativo (`expo-sqlite`, `expo-secure-store` vía `db/outbox.ts` y `sesion-movil-store.ts`) y
 * eso rompe la carga de módulos bajo vitest/Node (falla con `SyntaxError: Unexpected token
 * 'export'` al intentar transformar esos paquetes) — separar la parte pura evita ese
 * problema sin tener que mockear nada.
 *
 * Este mismo módulo alimenta los dos caminos que necesitan procesar un punto GPS:
 * - `useGpsOperativo` (`use-gps-operativo.ts`), cuando la app está viva y React corre.
 * - el headless task de Transistorsoft (`headless-task.ts` + registro en `index.js`), cuando
 *   la app fue terminada por el usuario o el sistema y NO hay árbol de React ni hooks.
 */

/** Estado operativo que el registro de un punto necesita — en la app viva viene de React
 * (props/hooks); en el headless task se reconstruye leyendo el almacenamiento persistente
 * del dispositivo (ver `obtenerContextoUbicacionPersistido` en `headless-task.ts`). */
export interface ContextoUbicacion {
  deviceId: string;
  sesionId: string;
  puntosControl: PuntoControlPaquete[];
}

/** Evento listo para encolar en el outbox — todavía sin persistir; `registrarPuntoGps`
 * (`headless-task.ts`) es quien hace el `encolarEvento` real. */
export interface EventoUbicacionConstruido {
  tipo: TipoEventoSync;
  payload: Record<string, unknown>;
  /** M4 (hallazgo de revisión, medio): clave (`claveCumplimiento`) cuya transición de estado
   * queda ATADA a la persistencia de ESTE evento — presente SOLO en eventos
   * `cumplimiento_punto_control` (`undefined` para `gps_point`, que no tiene ninguna
   * transición de histéresis asociada). `registrarPuntoGps` (`headless-task.ts`) usa este
   * campo para aplicar la transición correspondiente INMEDIATAMENTE después de que SU PROPIO
   * `encolarEvento` se confirma — no al final del tick — así que si un `encolarEvento`
   * posterior en el mismo tick falla (dos puntos de control con radios solapados, por
   * ejemplo), los cumplimientos que SÍ se persistieron antes del fallo ya quedaron reflejados
   * en el Map de estados y no se re-emiten como pasada 1 en el próximo fix.
   */
  clave?: string;
  /**
   * FIX POST-REVISIÓN ("eventId estable" — hallazgo de concurrencia, ver
   * `derivarEventIdDeterministico` en `@quivo/shared`): presente SOLO en
   * `cumplimiento_punto_control`, derivado determinísticamente de `{sesionId, puntoControlId,
   * pasada}` — la MISMA pasada de la MISMA visita produce SIEMPRE el MISMO `eventId`, así que
   * un fix real y una confirmación forzada por heartbeat/cierre
   * (`aplicarConfirmacionesForzadas`, `headless-task.ts`) que terminaran confirmando la MISMA
   * pasada (carrera que R1 ya serializa dentro de un mismo contexto JS, pero esto cierra la
   * clase de bug entera, no solo esa ventana puntual) emiten el MISMO evento en vez de dos
   * distintos — el dedupe del servidor es únicamente por `eventId` (QUI-241). `undefined` para
   * `gps_point` (cada fix GPS es un hecho distinto, no hay pasada que lo identifique).
   */
  eventId?: string;
}

export interface ResultadoConstruirEventos {
  eventos: EventoUbicacionConstruido[];
  /** Último punto de control CONFIRMADO (mínimo local, `fase: 'confirmado'`) en este tick, o
   * `null` si no hubo ninguno — lo usa `useGpsOperativo` para disparar sonido + toast
   * (`gps-provider.tsx`, ENTREGA 6) y `anunciarPuntoControl` (`anuncio-punto-control.ts`,
   * ENTREGA 7) para la notificación headless. Antes de la ENTREGA 6 este campo alimentaba
   * también la voz — ya no: la voz sale de `deteccionAproximacion`, abajo. */
  deteccion: DeteccionPuntoControl | null;
  /**
   * ENTREGA 6 (plan post-piloto 2026-09-09): el punto de control MÁS CERCANO cuya distancia
   * cae dentro de `RADIO_AVISO_M`, con `fase: 'aproximacion'`, o `null` si ninguno está en
   * rango — informativo, calculado directamente sobre TODAS las detecciones de este tick
   * (`detectarPuntosControlCercanos`, que ya trae `distanciaM` para todas), SIN pasar por la
   * máquina de estados de `filtrarNuevosCumplimientos`: el aviso de aproximación no depende de
   * histéresis ni de `PASADA_MIN_MS`, solo de "¿hay algún punto cerca ahora mismo?". El
   * dedupe de "ya lo anuncié" es responsabilidad del caller (`gps-provider.tsx` en foreground,
   * `anuncio-punto-control.ts` en headless) — acá se recalcula en cada tick sin memoria.
   */
  deteccionAproximacion: DeteccionPuntoControl | null;
  /**
   * REDISEÑO (decisión del CTO, ronda posterior al veredicto `partial` de Codex `verify-fix`
   * del 2026-09-23): TODAS las detecciones crudas de este tick (`detectarPuntosControlCercanos`,
   * sin filtrar por `cumplido`) — el único punto de llamada de `decidirAnuncio`
   * (`gps/headless-task.ts`, vía `evaluarAnunciosDeFixes` en
   * `features/operacion/decidir-anuncio.ts`) las necesita para leer la distancia REAL de este
   * fix a cada punto de control con una visita activa. Antes de este rediseño, esa decisión
   * (entonces llamada `deteccionConfirmacionProximidad`) vivía DENTRO de
   * `filtrarNuevosCumplimientos` — ahora la máquina de estados de evidencia no calcula nada de
   * anuncio, así que el caller necesita las detecciones crudas para decidir por su cuenta.
   */
  deteccionesTick: DeteccionPuntoControl[];
  /**
   * `tsFixMs` de este tick — el mismo reloj que usa `filtrarNuevosCumplimientos` para
   * `PASADA_MIN_MS` (`tsFix`, nunca `Date.now()`). El único punto de llamada de `decidirAnuncio`
   * lo necesita para medir el fallback de tiempo (`UMBRAL_ANUNCIO_PROXIMIDAD_MS`,
   * `decidir-anuncio.ts`) sobre el mismo reloj que el resto del pipeline.
   */
  tsFixMs: number;
  /**
   * Transiciones de estado del geofence (`filtrarNuevosCumplimientos`, `geofence.ts`) que
   * corresponde aplicar al Map de estados del caller — SOLO DESPUÉS de que `encolarEvento`
   * confirme que `eventos` quedó persistido de verdad. Esta función NO muta nada (a
   * diferencia de la versión anterior, que mutaba el Set de detecciones in-place ANTES de esa
   * confirmación — plan §2.4, hallazgo de revisión: un fallo de encolado dejaba el punto
   * marcado como emitido y suprimía su reemisión). Vacío cuando no hay transición que aplicar.
   */
  transicionesEstado: Map<string, EstadoPuntoControl>;
  /** M3 (hallazgo de revisión, medio): decisiones de la máquina de estados condicionadas por la
   * precisión del fix — `registrarPuntoGps` (`headless-task.ts`) las convierte en breadcrumbs
   * de Sentry. Vacío en el caso normal. Ver `AvisoPrecision` en `geofence.ts`. */
  avisosPrecision: AvisoPrecision[];
  /** FIX POST-REVISIÓN (bug 4): puntos cuya histéresis de DETECCIÓN re-armó de verdad este tick
   * — ver el comentario de `puntosRearmados` en `geofence.ts`. FIX POST-REVISIÓN (G1): ya NO se
   * usa para `limpiarAproximacionesAnunciadas` — ver `puntosRearmadosVoz` abajo. */
  puntosRearmados: string[];
  /** FIX POST-REVISIÓN (G1, "la voz se re-anuncia dentro del radio de aviso"): puntos cuya
   * histéresis PROPIA de voz (`avisoVozDentro`, `geofence.ts`) re-armó de verdad este tick —
   * este es el campo que `registrarPuntoGps`/`tareaHeadlessUbicacion` pasan a
   * `limpiarAproximacionesAnunciadas` (`anuncio-punto-control.ts`), independiente de la
   * histéresis de detección (`puntosRearmados` arriba). Ver el comentario largo de
   * `puntosRearmadosVoz` en `geofence.ts`. */
  puntosRearmadosVoz: string[];
}

/**
 * Normaliza `location.timestamp` a ISO-8601 con offset — la forma que exigen
 * `PayloadGpsPointSchema.tsFix` / `PayloadCumplimientoPuntoControlSchema.tsFix`
 * (`@quivo/shared`, `z.string().datetime({ offset: true })`).
 *
 * Transistorsoft v4 tipaba `Location.timestamp` como `string` a secas; v5 lo ensanchó a
 * `string | number` (epoch ms en el caso numérico — ver
 * `@transistorsoft/background-geolocation-types`, `Location.d.ts`). Antes de este fix el
 * valor se pasaba tal cual al payload: compilaba igual porque
 * `EventoUbicacionConstruido.payload` es `Record<string, unknown>`, pero un epoch numérico
 * (o cualquier string no-ISO) pierde el `.datetime()` de Zod en `resolverTsFix`
 * (`packages/shared/src/sync/evento.ts`), que cae EN SILENCIO al `ts` de encolado del
 * sobre — exactamente la deformación del recorrido por buffering headless que `tsFix`
 * existe para evitar (hallazgo de revisión).
 *
 * Devuelve `undefined` (nunca `"Invalid Date"`) ante un timestamp ilegible: `tsFix` ya es
 * opcional en el schema, así que un fix inválido cae al mismo camino de retrocompatibilidad
 * que un evento viejo sin `tsFix`, en vez de fabricar una fecha basura que además pasaría el
 * `safeParse` de Zod (`"Invalid Date"` no es ISO válido, pero mejor no arriesgarlo).
 */
// Exportada (hallazgo de revisión H6, rescate del día 1): `rescate-dia1-core.ts` la reusa tal
// cual para decidir si un punto rescatado de la SQLite nativa se puede encolar — mismo defecto
// de raíz (timestamp ilegible cayendo en silencio al `ts` del sobre), mismo fix, sin duplicar
// la lógica.
export function normalizarTsFix(timestamp: Location['timestamp']): string | undefined {
  const fecha = new Date(timestamp);
  return Number.isNaN(fecha.getTime()) ? undefined : fecha.toISOString();
}

/**
 * Construye los eventos de outbox correspondientes a un punto GPS: siempre un `gps_point`
 * (criterio C del spike — la evidencia legal, RF-67..73) y, por cada punto de control cuya
 * máquina de estados (`filtrarNuevosCumplimientos`, `geofence.ts`) decida que corresponde una
 * pasada nueva (RF-64..66), un `cumplimiento_punto_control` adicional con su número de
 * `pasada`.
 *
 * PURA: no muta `estadosPuntosControl` — a diferencia de la versión anterior (que mutaba el
 * Set de detecciones in-place dentro de este mismo loop). Devuelve las `transicionesEstado`
 * para que el caller (`registrarPuntoGps`, `headless-task.ts`) las aplique recién cuando
 * confirme que `eventos` se encoló con éxito (ver el comentario de `ResultadoConstruirEventos`
 * y el de `ResultadoFiltrado` en `geofence.ts`).
 */
export function construirEventosDeUbicacion(
  location: Location,
  contexto: ContextoUbicacion,
  estadosPuntosControl: ReadonlyMap<string, EstadoPuntoControl>,
): ResultadoConstruirEventos {
  // Normalizado UNA sola vez: `gps_point` y, si aplica, `cumplimiento_punto_control` vienen
  // de la misma `location` — ver `normalizarTsFix` arriba para el porqué (v5 ensanchó
  // `Location.timestamp` a `string | number`).
  const tsFix = normalizarTsFix(location.timestamp);
  // La máquina de estados (`filtrarNuevosCumplimientos`) exige medir `PASADA_MIN_MS` sobre el
  // FIX real, nunca sobre `Date.now()` (ver el comentario de esa constante en `geofence.ts`).
  // Si el timestamp del fix es ilegible (`tsFix === undefined`, caso raro), no hay reloj de
  // fix del que confiar — usar `Date.now()` acá es el único fallback posible y no contradice
  // esa regla: la regla existe para no colapsar fixes bufferados con `tsFix` VÁLIDOS pero
  // distintos, no para este caso degenerado sin ningún timestamp usable.
  const tsFixMs = tsFix !== undefined ? Date.parse(tsFix) : Date.now();
  const eventos: EventoUbicacionConstruido[] = [
    {
      tipo: 'gps_point',
      payload: {
        sesionId: contexto.sesionId,
        lat: location.coords.latitude,
        lng: location.coords.longitude,
        accuracy: location.coords.accuracy,
        speed: location.coords.speed,
        // Timestamp del FIX GPS, no el del encolado: el sobre del outbox se sella con
        // `new Date()` en `encolarEvento`, y en el camino headless (app terminada) el SDK
        // entrega ubicaciones bufferadas en ráfaga al salir de Doze — sin esto, un tramo
        // entero de manejo se persistiría con timestamps casi idénticos y el recorrido
        // reconstruido quedaría deformado. Contrato + fallback: `PayloadGpsPointSchema` /
        // `resolverTsFix` en `@quivo/shared`.
        tsFix,
      },
    },
  ];

  let deteccion: DeteccionPuntoControl | null = null;
  let deteccionAproximacion: DeteccionPuntoControl | null = null;
  let deteccionesTick: DeteccionPuntoControl[] = [];
  let transicionesEstado = new Map<string, EstadoPuntoControl>();
  let avisosPrecision: AvisoPrecision[] = [];
  let puntosRearmados: string[] = [];
  let puntosRearmadosVoz: string[] = [];
  if (contexto.puntosControl.length > 0) {
    const posicion: [number, number] = [location.coords.longitude, location.coords.latitude];
    // M3 (hallazgo de revisión, medio): la precisión del fix viaja DENTRO de cada detección y
    // la aplica `filtrarNuevosCumplimientos` solo al re-armado. Antes de este fix, acá se
    // FILTRABAN (se tiraban) las detecciones cuyo fix tuviera `accuracy > radioToleranciaM`:
    // con los radios de 100 m de la Z12 y una Android que reporta 100-500 m de rutina, una
    // pasada genuina desaparecía entera — sin evento y sin telemetría. Ver el comentario largo
    // de M3 en `geofence.ts` para el porqué de tratar entrada y re-armado de forma asimétrica.
    const detecciones = detectarPuntosControlCercanos(
      posicion,
      contexto.puntosControl,
      location.coords.accuracy,
    );
    deteccionesTick = detecciones;

    // ENTREGA 6: aviso de aproximación — el punto MÁS CERCANO dentro de `RADIO_AVISO_M`, sobre
    // TODAS las detecciones del tick (no solo las `cumplido`, que usan el radio de detección
    // propio de cada punto — `RADIO_AVISO_M` es un radio de AVISO global, independiente).
    // Deliberadamente por fuera de `filtrarNuevosCumplimientos`: no toca la máquina de estados
    // de detección/confirmación, así que no puede introducir un bug en la evidencia legal.
    for (const d of detecciones) {
      if (d.distanciaM > RADIO_AVISO_M) continue;
      if (deteccionAproximacion === null || d.distanciaM < deteccionAproximacion.distanciaM) {
        deteccionAproximacion = { ...d, fase: 'aproximacion' };
      }
    }

    // FIX POST-REVISIÓN (bug 1): se pasa la posición de ESTE fix como `posicionFix` — no para
    // que el evento la use directo (ver más abajo), sino para que la máquina de estados pueda
    // guardarla como CANDIDATO si este fix resulta ser el de entrada o el que mejora el mínimo
    // de la visita. Ver el comentario largo de `posicionFix` en `filtrarNuevosCumplimientos`.
    const {
      emitir,
      transiciones,
      avisosPrecision: avisos,
      puntosRearmados: rearmados,
      puntosRearmadosVoz: rearmadosVoz,
    } = filtrarNuevosCumplimientos(estadosPuntosControl, detecciones, contexto.sesionId, tsFixMs, {
      lat: location.coords.latitude,
      lng: location.coords.longitude,
    });
    transicionesEstado = transiciones;
    avisosPrecision = avisos;
    puntosRearmados = rearmados;
    puntosRearmadosVoz = rearmadosVoz;

    for (const {
      deteccion: nuevaDeteccion,
      pasada,
      clave,
      distanciaEntradaM,
      distanciaMinAproximacionM,
      candidatoLat,
      candidatoLng,
      candidatoTsFixMs,
    } of emitir) {
      // B4 (hallazgo de revisión, bajo): la pasada viaja en la propia `DeteccionPuntoControl`
      // — `gps-provider.tsx` la necesita para distinguir dos pasadas CONSECUTIVAS del MISMO
      // punto de control (multi-vuelta) al decidir si repetir sonido/toast.
      deteccion = nuevaDeteccion;
      eventos.push({
        tipo: 'cumplimiento_punto_control',
        // M4 (hallazgo de revisión, medio): clave atada a ESTE evento — ver el comentario de
        // `EventoUbicacionConstruido.clave`.
        clave,
        // FIX POST-REVISIÓN ("eventId estable"): derivado de {sesionId, puntoControlId, pasada}
        // — ver el comentario largo de `EventoUbicacionConstruido.eventId`.
        eventId: derivarEventIdDeterministico([
          contexto.sesionId,
          nuevaDeteccion.puntoControlId,
          String(pasada),
        ]),
        payload: {
          sesionId: contexto.sesionId,
          puntoControlId: nuevaDeteccion.puntoControlId,
          // FIX POST-REVISIÓN (bug 1, "el servidor puede rechazar el paso"): lat/lng del fix
          // CANDIDATO (el más cercano de la visita, guardado por la máquina de estados) — NUNCA
          // las del fix ACTUAL que disparó esta confirmación. El bug real: en el camino "la
          // distancia vuelve a crecer", el fix que dispara la confirmación puede estar YA FUERA
          // del radio (ejemplo verificado: radio 150, entra a 146 m, el fix que confirma está a
          // 158 m) — el worker revalida con `ST_DWithin` exactamente esas coordenadas contra
          // `radioToleranciaM` (`ingesta-worker.service.ts` ~347-430) y rechaza el paso
          // (`cumplido=false`), perdiendo evidencia real. El candidato está DENTRO del radio
          // por construcción (es el mínimo observado), así que la revalidación server-side
          // siempre pasa. Fallback a `location.coords` solo para el caso degenerado en que
          // `filtrarNuevosCumplimientos` no haya podido registrar un candidato (no debería
          // ocurrir en el camino real, que siempre pasa `posicionFix`) — mejor una posición
          // "peor" que ninguna.
          lat: candidatoLat ?? location.coords.latitude,
          lng: candidatoLng ?? location.coords.longitude,
          distanciaM: nuevaDeteccion.distanciaM,
          // ENTREGA 6: ambos números viajan — `distanciaEntradaM` es lo que decía la voz vieja
          // (borde del radio de detección, 104-150 m en el piloto del 09-09);
          // `distanciaMinAproximacionM` es el mínimo real de la visita (ver el comentario largo
          // de "mínimo local" en `filtrarNuevosCumplimientos`, `geofence.ts`).
          distanciaEntradaM,
          distanciaMinAproximacionM,
          validadoPor: 'app',
          // FIX POST-REVISIÓN (bug 1): hora del fix CANDIDATO, no del fix que confirma — mismo
          // razonamiento que `lat`/`lng` de arriba: la hora que sustenta una sanción (RF-64..66)
          // tiene que ser la del paso real (el mínimo), no la de un fix posterior ya alejándose.
          // Contrato + fallback: `PayloadCumplimientoPuntoControlSchema` / `resolverTsFix` en
          // `@quivo/shared`.
          tsFix: candidatoTsFixMs !== undefined ? new Date(candidatoTsFixMs).toISOString() : tsFix,
          // Número de pasada (multi-vuelta, plan §2.3): contador incremental por clave
          // `${sesionId}:${puntoControlId}`, empezando en 1 — ver `filtrarNuevosCumplimientos`
          // en `geofence.ts`. `PayloadCumplimientoPuntoControlSchema.pasada` es opcional a
          // propósito: APKs viejos nunca lo van a mandar.
          pasada,
        },
      });
    }
  }

  return {
    eventos,
    deteccion,
    deteccionAproximacion,
    deteccionesTick,
    tsFixMs,
    transicionesEstado,
    avisosPrecision,
    puntosRearmados,
    puntosRearmadosVoz,
  };
}

/**
 * Reconstruye el ESTADO de histéresis (`EstadoPuntoControl`, `geofence.ts`) de cada punto de
 * control ya visto, a partir de los eventos `cumplimiento_punto_control` que siguen en el
 * outbox local. Sirve para SEMBRAR el Map del headless task en su primer tick, y — desde el
 * fix de C1 — el del hook TAMBIÉN al re-enganchar al montar (no solo al arrancar `iniciar()`):
 * scopear la clave por sesión evita que el estado de la ruta A contamine el de la ruta B, pero
 * no cubre el otro lado del mismo problema — si Android recicla el contexto JS headless a
 * mitad de turno (o la app se mata y se reabre), un Map vacío reiniciaría el contador de
 * pasadas en 1 y podría reemitir la pasada que ya estaba en curso.
 *
 * Recibe `{ ts, payload }` (no solo el payload) porque usa `resolverTsFix` — el mismo
 * contrato que aplica el worker server-side (`@quivo/shared`) — para derivar el timestamp de
 * cada cumplimiento: eventos con `tsFix` usable lo usan, y los que no (dispositivos con una
 * versión anterior de la app, o un `tsFix` ilegible) caen al `ts` de encolado del sobre, en
 * vez de quedar sin ningún timestamp del que derivar el estado.
 *
 * Por cada clave (`sesionId:puntoControlId`):
 * - `pasadas` = `Math.max(maxPasadaEnPayloads, cantidadDeFilas)` (M2, hallazgo de revisión,
 *   medio). Antes era solo `cantidadDeFilas` — contar filas alcanza mientras el outbox tenga
 *   TODAS las filas de la clave, pero `restaurarSesion` mantiene viva la misma `sesionId`
 *   mientras el refresh token siga vigente (30 días por default) y `purgarAcusadosAntesDe`
 *   (`db/outbox.ts`, ventana de 7 días) puede borrar cumplimientos YA ACUSADOS de los
 *   primeros días de una sesión que sigue viva más allá de esa ventana — ahí `cantidadDeFilas`
 *   subcuenta y el contador de pasadas RETROCEDE. `pasada` ya viaja en el payload de cada
 *   evento (`PayloadCumplimientoPuntoControlSchema.pasada`, opcional para compatibilidad con
 *   APKs viejos) — tomar el máximo entre ambas fuentes usa la que esté más completa: si la
 *   purga se comió filas viejas pero la más reciente que sobrevive ya traía `pasada: 8`, el
 *   `Math.max` la respeta aunque solo quede 1 fila en el outbox.
 * - `ultimoEmitidoMs` = el `max` de los timestamps resueltos de esa clave.
 * - `dentro` es SIEMPRE `true` cuando hay al menos una emisión previa para la clave — nunca en
 *   función del tiempo transcurrido (A1, hallazgo de revisión CRÍTICO; ver el porqué debajo).
 *
 * Es best-effort a propósito: si el outbox ya purgó TODAS las filas de una clave, la semilla
 * queda incompleta y el contador puede arrancar más bajo de lo real — sigue siendo
 * estrictamente mejor que arrancar siempre vacío (que reiniciaría SIEMPRE en pasada 1), y
 * nunca suprime evidencia de una sesión distinta.
 *
 * ---
 *
 * ### Por qué `dentro` YA NO depende del tiempo transcurrido (A1)
 *
 * La versión anterior derivaba `dentro = ahoraMs - ultimoEmitidoMs < PASADA_MIN_MS`: si la
 * última emisión fue hace más de `PASADA_MIN_MS` (2 min), sembraba `dentro: false` — es decir,
 * usaba el PISO de tiempo entre pasadas como si fuera una prueba de que el vehículo ya se
 * había ido del punto. No lo es: `PASADA_MIN_MS` existe para no colapsar dos pasadas reales
 * separadas por un salto de reloj del fix, NO para inferir si el vehículo se movió. Con el
 * vehículo PARADO cerca de un punto de control (layover en terminal) y la app matada/reabierta
 * — o el contexto JS headless reciclado por Android — más de 2 minutos después, la semilla
 * derivaba `dentro: false` y el próximo fix (a 10 m, el vehículo nunca se movió) emitía una
 * pasada 2 FANTASMA. Pasaba en dos escenarios reales: cada vez que Android recicla el contexto
 * JS headless durante un layover de más de 2 min en la terminal, y cada vez que el chofer
 * aprieta "Iniciar" estando parado dentro de un punto.
 *
 * Sembrar `dentro: true` siempre (cuando hay pasadas previas) no pierde ninguna pasada real: la
 * máquina de estados (`filtrarNuevosCumplimientos`, `geofence.ts`) se re-arma sola en el primer
 * fix a más de `radio * FACTOR_REARME_RADIO` (y, desde A2, en el SEGUNDO fix consecutivo — ver
 * `FIXES_REARME_CONSECUTIVOS`) — con `locationUpdateInterval: 10_000` eso llega en 10-20 s de
 * movimiento real, así que la próxima pasada de verdad se habilita casi de inmediato en cuanto
 * el vehículo sale del radio, sin que haga falta (ni corresponda) adivinar acá cuánto tiempo
 * pasó reabriendo la app.
 */
export function clavesCumplimientoDesdePayloads(
  eventos: { ts: string; payload: Record<string, unknown> }[],
): Map<string, EstadoPuntoControl> {
  const acumulado = new Map<
    string,
    { ultimoEmitidoMs: number; filas: number; maxPasadaPayload: number }
  >();

  for (const evento of eventos) {
    const sesionId = evento.payload['sesionId'];
    const puntoControlId = evento.payload['puntoControlId'];
    if (typeof sesionId !== 'string' || typeof puntoControlId !== 'string') continue;

    const clave = claveCumplimiento(sesionId, puntoControlId);
    const tsResueltoMs = Date.parse(resolverTsFix(evento.payload, evento.ts));
    const pasadaPayload = evento.payload['pasada'];
    const pasadaNumerica =
      typeof pasadaPayload === 'number' && Number.isFinite(pasadaPayload) ? pasadaPayload : 0;
    const previo = acumulado.get(clave) ?? { ultimoEmitidoMs: -Infinity, filas: 0, maxPasadaPayload: 0 };
    acumulado.set(clave, {
      filas: previo.filas + 1,
      maxPasadaPayload: Math.max(previo.maxPasadaPayload, pasadaNumerica),
      ultimoEmitidoMs: Number.isNaN(tsResueltoMs)
        ? previo.ultimoEmitidoMs
        : Math.max(previo.ultimoEmitidoMs, tsResueltoMs),
    });
  }

  const estados = new Map<string, EstadoPuntoControl>();
  for (const [clave, { ultimoEmitidoMs, filas, maxPasadaPayload }] of acumulado) {
    // M2: ver el comentario de arriba — el máximo entre "cuántas filas quedan" y "la pasada
    // más alta que alguna fila sobreviviente reporta" sobrevive a una purga parcial.
    const pasadas = Math.max(maxPasadaPayload, filas);
    estados.set(clave, {
      // A1: ver el comentario largo de arriba — toda clave que llega hasta acá tiene al menos
      // una emisión previa (por construcción del loop de arriba), así que siempre es `true`.
      dentro: true,
      ultimoEmitidoMs,
      pasadas,
      // ENTREGA 6: explícito (aunque el `=== false` de `filtrarNuevosCumplimientos` ya trata
      // un campo ausente como "confirmado" por default) — toda clave sembrada acá viene de
      // pasadas YA EMITIDAS al outbox, nunca de una visita con el mínimo local a mitad de
      // camino (eso no se persiste hasta confirmar). No hay nada pendiente que seguir.
      confirmado: true,
      ultimoFixMs: Number.isFinite(ultimoEmitidoMs) ? ultimoEmitidoMs : undefined,
      // FIX POST-REVISIÓN (hallazgo 2, code review — "la evidencia re-sembrada dispara
      // fallback-salida", EL MÁS IMPORTANTE del lote): sin esto, una clave sembrada acá quedaba
      // `dentro: true` (A1, arriba) pero SIN `anuncioHecho` — `estadoAnuncioDe`
      // (`decidir-anuncio.ts`) la lee como "todavía no anuncié nada para esta visita" pese a que
      // la visita YA está confirmada/cerrada desde hace rato (es evidencia vieja, re-sembrada
      // tras un reinicio del proceso). El próximo fix que la re-arma (`visita: 'saliendo'`)
      // decidía entonces `'fallback-salida'` — un anuncio de "llegaste" FANTASMA disparado por
      // evidencia pura, exactamente lo que el rediseño de `decidir-anuncio.ts` prometía que NUNCA
      // podía pasar ("la evidencia nunca dispara un anuncio"). Toda clave que llega hasta acá
      // viene de una pasada YA EMITIDA — por construcción, esa pasada real YA tuvo su oportunidad
      // de anunciar (o no le tocaba); marcarla `anuncioHecho: true` cierra el ciclo de anuncio de
      // esa visita para siempre, igual que ya cierra el de evidencia (`confirmado: true`, arriba).
      anuncioHecho: true,
    });
  }
  return estados;
}

/** Forma de una fila de `visitas_pendientes` (`db/outbox.ts`) tal como la necesita
 * `combinarConVisitasPendientes` — deliberadamente redeclarada acá (en vez de importar el tipo
 * de `db/outbox.ts`) para que este módulo siga sin ninguna dependencia de `expo-sqlite`: es lo
 * que lo mantiene testeable bajo vitest/Node (ver el docblock de cabecera del archivo). */
export interface VisitaPendienteSembrable {
  clave: string;
  puntoControlId: string;
  pasadasPrevias: number;
  radioToleranciaM: number;
  minDistanciaM: number;
  distanciaEntradaM: number;
  candidatoLat: number;
  candidatoLng: number;
  candidatoTsFixMs: number;
  ultimoEmitidoMs: number;
  fixesDentroSinConfirmar: number;
}

/**
 * FIX POST-REVISIÓN (bug 5, "reabrir la app a mitad de visita pierde la pasada"): superpone las
 * visitas PENDIENTES (persistidas en SQLite, `visitas_pendientes` en `db/outbox.ts`) sobre el
 * Map ya derivado de los eventos `cumplimiento_punto_control` CONFIRMADOS
 * (`clavesCumplimientoDesdePayloads`, arriba). El bug real: esa función solo ve eventos YA
 * emitidos — una visita que estaba "en el mínimo local, todavía sin confirmar" al momento de
 * matar la app (o de que Android recicle el contexto JS headless) no tiene ningún evento en el
 * outbox todavía, así que la semilla la perdía por completo (ni pendiente ni confirmada: como
 * si nunca hubiera pasado). Peor aún — si SÍ había una pasada previa confirmada de ese mismo
 * punto (multi-vuelta), la semilla vieja sembraba esa clave con `confirmado: true`, así que la
 * visita en curso volvía como "ya cumplida" y la máquina de estados jamás la re-evaluaba.
 *
 * PURA (sin SQLite): la lectura de `visitas_pendientes` vive en el caller (`headless-task.ts` /
 * `use-gps-operativo.ts`), acá solo se combina. `pasadas` viene SIEMPRE del estado YA derivado
 * de los eventos confirmados (`combinado.get(...)?.pasadas`) — la fila de `visitas_pendientes`
 * NO las duplica ni las reemplaza, así que si el outbox tiene 2 pasadas ya emitidas y una
 * tercera visita en curso, `pasadas` sigue en 2 (la próxima confirmación la sube a 3). Solo cae
 * a `pasadasPrevias` (el conteo guardado AL MOMENTO de entrar a esa visita) en el caso borde de
 * no tener NINGÚN evento confirmado todavía para esa clave (primera visita de la sesión).
 */
export function combinarConVisitasPendientes(
  estadosBase: ReadonlyMap<string, EstadoPuntoControl>,
  visitasPendientes: VisitaPendienteSembrable[],
): Map<string, EstadoPuntoControl> {
  const combinado = new Map(estadosBase);
  for (const visita of visitasPendientes) {
    const base = combinado.get(visita.clave);
    combinado.set(visita.clave, {
      dentro: true,
      confirmado: false,
      // `base?.ultimoEmitidoMs` es la fuente autoritativa (derivada de los eventos confirmados
      // que SIGUEN en el outbox); `visita.ultimoEmitidoMs` (guardado junto al candidato al
      // persistir la fila) es el fallback si esa clave ya no tiene ningún evento confirmado
      // visible (purgado, o primera visita de la sesión) — nunca `-Infinity` a ciegas, que
      // reabriría la puerta de `PASADA_MIN_MS` sin motivo.
      ultimoEmitidoMs: base?.ultimoEmitidoMs ?? visita.ultimoEmitidoMs,
      pasadas: base?.pasadas ?? visita.pasadasPrevias,
      fixesFueraRadioRearme: 0,
      ultimoFixMs: visita.candidatoTsFixMs,
      minDistanciaM: visita.minDistanciaM,
      distanciaEntradaM: visita.distanciaEntradaM,
      fixesDentroSinConfirmar: visita.fixesDentroSinConfirmar,
      puntoControlId: visita.puntoControlId,
      radioToleranciaM: visita.radioToleranciaM,
      candidatoLat: visita.candidatoLat,
      candidatoLng: visita.candidatoLng,
      candidatoTsFixMs: visita.candidatoTsFixMs,
    });
  }
  return combinado;
}

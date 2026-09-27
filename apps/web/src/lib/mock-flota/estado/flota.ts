import { LINEAS_MOCK, TRUFIS_MOCK } from '../datos';
import { bearingEnAvance, desplazarPerpendicular, largoTotalM, posicionEnPolilinea, tramoDesdeAvance } from '../geometria';
import { entreEnteros, mulberry32, SEMILLA_HISTORIAL } from './rng';
import { avanzarSincronizando, avanzarSinSenal } from './senal';
import type {
  AccionAplicada,
  CumplimientoPunto,
  EstadoFlotaMock,
  EstadoTrufi,
  EventoTrufiTick,
  FaseTrufi,
  InfraccionMock,
  InfraccionTipo,
  LineaMock,
  LineaMockId,
  ModoAplicacion,
  PuntoTrazado,
  Severidad,
} from '../tipos';
import { CATALOGO_INFRACCIONES } from '../catalogo-infracciones';

/**
 * Slice `flota` — todo lo que es puramente del VEHÍCULO: movimiento sobre la polilínea, la
 * máquina de estados de `fase` (normal / atascado / desviado — `sin_senal`/`sincronizando`
 * viven en `senal.ts`, slice aparte por pedido del contrato) e infracciones (se quedan acá,
 * no tienen slice propio en el contrato — son 1:1 con un trufi).
 *
 * Como el resto del módulo, es PURO: nada de `Math.random()`/`Date.now()` acá — todo entra ya
 * resuelto como argumento (`now`, `rng`) desde `flota-mock-context.tsx`.
 */

// ============================================================================================
// Infracciones (contenido ORIGINAL de `estado.ts`, sin cambios de comportamiento).
// ============================================================================================

export const PLAZO_MAX_DIAS = 30;

export function fechaPlazoValida(venceEl: string, now: string): boolean {
  const ahora = new Date(now);
  if (Number.isNaN(ahora.getTime())) {
    return false;
  }
  const partesVence = /^(\d{4})-(\d{2})-(\d{2})$/.exec(venceEl);
  if (!partesVence) {
    return false;
  }
  const anioVence = Number(partesVence[1]);
  const mesVence = Number(partesVence[2]) - 1;
  const diaVence = Number(partesVence[3]);
  const inicioHoyMs = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime();
  const limiteMs = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + PLAZO_MAX_DIAS).getTime();
  const venceDiaMs = new Date(anioVence, mesVence, diaVence).getTime();
  if (Number.isNaN(venceDiaMs)) {
    return false;
  }
  return venceDiaMs >= inicioHoyMs && venceDiaMs <= limiteMs;
}

export function infraccionActivaDe(estado: EstadoFlotaMock, trufiId: string): InfraccionMock | undefined {
  return estado.infracciones.find((i) => i.trufiId === trufiId && i.estado === 'activa');
}

export function infraccionesDe(estado: EstadoFlotaMock, trufiId: string): InfraccionMock[] {
  return estado.infracciones.filter((i) => i.trufiId === trufiId);
}

export function trufisSinInfraccionActiva(estado: EstadoFlotaMock, candidatos: string[]): string[] {
  return candidatos.filter((id) => !infraccionActivaDe(estado, id));
}

export function elegirAleatorios<T>(items: T[], n: number, rng: () => number = Math.random): T[] {
  if (items.length <= n) {
    return [...items];
  }
  const copia = [...items];
  const limite = Math.min(n, copia.length);
  for (let i = 0; i < limite; i++) {
    const j = i + Math.floor(rng() * (copia.length - i));
    const tmp = copia[i]!;
    copia[i] = copia[j]!;
    copia[j] = tmp;
  }
  return copia.slice(0, limite);
}

export function elegirTipoInfraccion(severidad: Severidad | 'aleatoria', rng: () => number = Math.random): InfraccionTipo {
  const candidatos =
    severidad === 'aleatoria' ? CATALOGO_INFRACCIONES : CATALOGO_INFRACCIONES.filter((tipo) => tipo.severidad === severidad);
  const pool = candidatos.length > 0 ? candidatos : CATALOGO_INFRACCIONES;
  const idx = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
  return pool[idx]!;
}

export function simularInfracciones(estado: EstadoFlotaMock, nuevas: InfraccionMock[]): EstadoFlotaMock {
  const aAgregar = nuevas.filter((inf) => !infraccionActivaDe(estado, inf.trufiId));
  if (aAgregar.length === 0) {
    return estado;
  }
  return { ...estado, infracciones: [...estado.infracciones, ...aAgregar] };
}

export function limpiarInfracciones(estado: EstadoFlotaMock, trufiIds?: string[]): EstadoFlotaMock {
  if (estado.infracciones.length === 0) {
    return estado;
  }
  if (!trufiIds) {
    return { ...estado, infracciones: [] };
  }
  const idsALimpiar = new Set(trufiIds);
  const restantes = estado.infracciones.filter((i) => !idsALimpiar.has(i.trufiId));
  return restantes.length === estado.infracciones.length ? estado : { ...estado, infracciones: restantes };
}

export function asignarParada(estado: EstadoFlotaMock, trufiId: string, paradaId: string): EstadoFlotaMock {
  const actual = estado.trufis[trufiId];
  if (!actual) {
    return estado;
  }
  return { ...estado, trufis: { ...estado.trufis, [trufiId]: { ...actual, siguienteParadaId: paradaId } } };
}

export function aplicarAccion(
  estado: EstadoFlotaMock,
  infraccionId: string,
  accionId: string,
  modo: ModoAplicacion,
  aplicadaEn: string,
  venceEl: string | undefined,
): EstadoFlotaMock {
  const infraccion = estado.infracciones.find((i) => i.id === infraccionId);
  if (!infraccion || infraccion.estado !== 'activa') {
    return estado;
  }
  if (modo === 'plazo') {
    if (!venceEl || !fechaPlazoValida(venceEl, aplicadaEn)) {
      return estado;
    }
  }
  const accionAplicada: AccionAplicada =
    modo === 'plazo' ? { accionId, modo, aplicadaEn, venceEl } : { accionId, modo, aplicadaEn };
  return {
    ...estado,
    infracciones: estado.infracciones.map((i) => (i.id === infraccionId ? { ...i, estado: 'sancionada', accionAplicada } : i)),
  };
}

/** Distinta de `SEMILLA_HISTORIAL` (misma razón que `novedades.ts`). */
const SEMILLA_SANCIONES = SEMILLA_HISTORIAL ^ 0x3333;

/**
 * Siembra 2 sanciones (`InfraccionMock` con `estado: 'sancionada'`) para que la pestaña
 * "Sanciones" de la ficha tenga contenido desde el arranque (contrato: "reuse InfraccionMock
 * 'sancionada' for 2 trufis"). Determinístico por día (mismo mecanismo que
 * `recorridos.ts#sembrarHistorial`).
 *
 * Ítem 10 del guion delegado: la ventana original (30 min a 6 h después de las 05:00) era FIJA,
 * sin relación con `now` — antes de las 11:00 podía sortear un `ocurridaEn` en el futuro. Se
 * clampea con el MISMO mecanismo que `novedades.ts#sembrarNovedades` (`finVentanaMs`/`rangoMs`,
 * nunca más tarde de 30 min antes de `now`). Si `now` es antes de las 05:00 (grabación de
 * madrugada), directamente NO siembra nada (contrato: "before 05:00, seed none, or seed them on
 * the previous day" — elegimos la opción más simple) en vez de colapsar la ventana a un único
 * instante que igual quedaría en el futuro respecto de `now`.
 */
export function sembrarSanciones(now: Date): InfraccionMock[] {
  const inicioDia = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 5, 0, 0, 0);
  if (now.getTime() < inicioDia.getTime()) {
    return [];
  }
  const rng = mulberry32(SEMILLA_SANCIONES);
  const finVentanaMs = Math.max(inicioDia.getTime(), now.getTime() - 30 * 60_000);
  const rangoMs = Math.max(1, finVentanaMs - inicioDia.getTime());
  const trufisElegidos = elegirAleatorios(TRUFIS_MOCK, 2, rng);
  return trufisElegidos.map((trufi, i) => {
    const tipo = CATALOGO_INFRACCIONES[entreEnteros(rng, 0, CATALOGO_INFRACCIONES.length - 1)]!;
    const accion = tipo.acciones[entreEnteros(rng, 0, tipo.acciones.length - 1)]!;
    const ocurridaEnMs = inicioDia.getTime() + Math.floor(rng() * rangoMs);
    const ocurridaEn = new Date(ocurridaEnMs).toISOString();
    return {
      id: `inf-seed-${trufi.id}-${i}`,
      trufiId: trufi.id,
      tipoId: tipo.id,
      severidad: tipo.severidad,
      ocurridaEn,
      estado: 'sancionada',
      accionAplicada: { accionId: accion.id, modo: 'ahora', aplicadaEn: ocurridaEn },
    };
  });
}

// ============================================================================================
// Velocidades — un loop completo tarda ~3-4 min en los 3 trufis originales; los 5 nuevos usan
// periodos en el mismo rango para no desentonar visualmente.
// ============================================================================================

interface VelocidadTrufi {
  periodoSegundos: number;
  /** Avance de arranque — solo importa para los trufis que EMPIEZAN `en_ruta` (`FASE_INICIAL`
   * de abajo); los que empiezan `en_cola` arrancan siempre en avance 0 al ser despachados. */
  avanceInicial: number;
}

const VELOCIDADES: Record<string, VelocidadTrufi> = {
  'trufi-z12-1': { periodoSegundos: 190, avanceInicial: 0 },
  'trufi-z12-2': { periodoSegundos: 225, avanceInicial: 0.33 },
  'trufi-z12-3': { periodoSegundos: 205, avanceInicial: 0.66 },
  'trufi-z12-4': { periodoSegundos: 195, avanceInicial: 0 },
  'trufi-z12-5': { periodoSegundos: 215, avanceInicial: 0 },
  'trufi-l120-1': { periodoSegundos: 205, avanceInicial: 0.2 },
  'trufi-l120-2': { periodoSegundos: 230, avanceInicial: 0.6 },
  'trufi-l120-3': { periodoSegundos: 210, avanceInicial: 0 },
};

/** Escena inicial al cargar la página (contrato del plan): Z12 = 3 `en_ruta` + 2 `en_cola`;
 * Línea 120 = 2 `en_ruta` + 1 `en_cola`. Los 3 trufis ORIGINALES quedan `en_ruta` (comportamiento
 * previo, sin cambios visuales para quien ya vio la demo vieja). */
export const FASE_INICIAL: Record<string, FaseTrufi> = {
  'trufi-z12-1': 'en_ruta',
  'trufi-z12-2': 'en_ruta',
  'trufi-z12-3': 'en_ruta',
  'trufi-z12-4': 'en_cola',
  'trufi-z12-5': 'en_cola',
  'trufi-l120-1': 'en_ruta',
  'trufi-l120-2': 'en_ruta',
  'trufi-l120-3': 'en_cola',
};

/** Cadencia del reloj de la simulación — 1 tick = 1 s. Única fuente (re-exportada desde
 * `estado/index.ts`), la necesita `flota-mock-context.tsx` para su `setInterval`. */
export const INTERVALO_TICK_MS = 1000;

const ATASCO_TICKS_TOTAL = 60;
const ATASCO_TRAMO_M = 250;
const DESVIO_TICKS_TOTAL = 20;
const DESVIO_OFFSET_MAX_M = 200;

function avanceInicialDe(trufiId: string): number {
  return VELOCIDADES[trufiId]?.avanceInicial ?? 0;
}

export function pasoPorTickDe(trufiId: string): number {
  const periodo = VELOCIDADES[trufiId]?.periodoSegundos ?? 200;
  return INTERVALO_TICK_MS / 1000 / periodo;
}

/** Primera parada (orden 0) de una línea — "el origen" donde se paran los `en_cola` y donde
 * arranca cada vuelta nueva (`iniciarVuelta`). */
function origenDe(linea: LineaMock): { lat: number; lng: number } {
  const primera = linea.paradas.find((p) => p.orden === 0) ?? linea.paradas[0];
  if (primera) {
    return { lat: primera.lat, lng: primera.lng };
  }
  const [lat, lng] = linea.polilinea[0] ?? [0, 0];
  return { lat, lng };
}

/** Separación entre trufis `en_cola` consecutivos, en metros (guion delegado: "spread backwards
 * along the polyline from the first stop, about 35 m apart by queue position"). */
const SEPARACION_COLA_M = 35;

/**
 * Posición EXPUESTA de un trufi `en_cola` según su posición `indice` (0 = cabeza de la cola,
 * el próximo a despachar) — el índice 0 se queda exactamente en `origenDe` (mismo lugar de
 * siempre); los siguientes se desplazan hacia ATRÁS (avance negativo, o sea `avance` cerca de 1
 * viniendo "desde el otro lado") `SEPARACION_COLA_M * indice` metros, para que los marcadores
 * en cola no queden apilados unos sobre otros. Llamado por `salidas.ts#reposicionarCola` cada
 * vez que cambia el ORDEN de una cola (despacho, fuera de orden, `moverEnCola`) y por
 * `estado/index.ts#estadoInicial` para la escena inicial.
 */
export function posicionEnColaDe(linea: LineaMock, indice: number): { lat: number; lng: number } {
  if (indice <= 0) {
    return origenDe(linea);
  }
  const largo = largoTotalM(linea.polilinea);
  if (largo === 0) {
    return origenDe(linea);
  }
  const avance = ((-(SEPARACION_COLA_M * indice) / largo) % 1 + 1) % 1;
  return posicionEnPolilinea(linea.polilinea, avance);
}

/** Estado inicial de `trufis` — llamado desde `estado/index.ts#estadoInicial`. Los `en_ruta`
 * arrancan con su `avanceInicial` de `VELOCIDADES`; los `en_cola` arrancan parados en el
 * origen de su línea (avance 0). */
export function trufisInicial(nowIso: string): Record<string, EstadoTrufi> {
  const trufis: Record<string, EstadoTrufi> = {};
  for (const trufi of TRUFIS_MOCK) {
    const linea = LINEAS_MOCK[trufi.lineaId];
    const fase = FASE_INICIAL[trufi.id] ?? 'en_cola';
    const avance = fase === 'en_ruta' ? avanceInicialDe(trufi.id) : 0;
    const { lat, lng } = fase === 'en_ruta' ? posicionEnPolilinea(linea.polilinea, avance) : origenDe(linea);
    trufis[trufi.id] = {
      trufiId: trufi.id,
      fase,
      avance,
      lat,
      lng,
      siguienteParadaId: null,
      vueltaActual: 1,
      ultimaSenalEn: nowIso,
      bufferPuntos: [],
      traza: [],
      cumplimientos: [],
      eventosPendientes: [],
      puntosPendientes: 0,
      ultimoTramoSincronizado: null,
    };
  }
  return trufis;
}

// ============================================================================================
// Elegibilidad para las acciones de escenario ("trufi al azar entre los visibles"). Solo un
// trufi `en_ruta` puede empezar atasco/desvío/pérdida de señal — evita superponer escenarios
// (un trufi ya atascado no puede "perder señal" encima).
// ============================================================================================

export function trufisEnRutaVisibles(estado: EstadoFlotaMock, lineaId?: LineaMockId): string[] {
  return TRUFIS_MOCK.filter((t) => (!lineaId || t.lineaId === lineaId) && estado.trufis[t.id]?.fase === 'en_ruta').map(
    (t) => t.id,
  );
}

export function trufisSinSenalVisibles(estado: EstadoFlotaMock, lineaId?: LineaMockId): string[] {
  return TRUFIS_MOCK.filter((t) => (!lineaId || t.lineaId === lineaId) && estado.trufis[t.id]?.fase === 'sin_senal').map(
    (t) => t.id,
  );
}

/** Cualquier trufi visible que no esté `en_cola` recién sembrado sin haber salido nunca —
 * usado por `simularReporteConductor` (un reporte del conductor puede pasar en cualquier fase
 * activa, incluso `atascado`/`desviado`; solo se excluye `finalizado`, que ya no tiene
 * conductor operando). */
export function trufisReportables(estado: EstadoFlotaMock, lineaId?: LineaMockId): string[] {
  return TRUFIS_MOCK.filter((t) => (!lineaId || t.lineaId === lineaId) && estado.trufis[t.id]?.fase !== 'finalizado').map(
    (t) => t.id,
  );
}

// ============================================================================================
// Transiciones de fase — "iniciar" (disparadas por una acción de escenario) y "avanzar"
// (aplicadas en cada tick mientras la fase está activa).
// ============================================================================================

export function iniciarAtasco(trufi: EstadoTrufi, linea: LineaMock): EstadoTrufi {
  return {
    ...trufi,
    fase: 'atascado',
    atascoTicksRestantes: ATASCO_TICKS_TOTAL,
    tramoAtascado: tramoDesdeAvance(linea.polilinea, trufi.avance, ATASCO_TRAMO_M),
  };
}

export function iniciarDesvio(trufi: EstadoTrufi): EstadoTrufi {
  return { ...trufi, fase: 'desviado', desvioProgreso: 0, trazaDesvio: [] };
}

/** Resetea un trufi para arrancar una vuelta nueva — usado por `despacharSiguiente`/
 * `simularFueraDeOrden` (`salidas.ts`) al sacarlo de la cola: ahí SÍ hay que teletransportar la
 * posición al origen (el trufi estuvo parado en la cola). Distinto de `cerrarVuelta` (abajo),
 * usado cuando el trufi completa una vuelta EN MARCHA (loop guion delegado, ítem 1) — ahí NO se
 * teletransporta, sigue de largo desde donde ya estaba. */
export function iniciarVuelta(trufi: EstadoTrufi, linea: LineaMock, nowIso: string): EstadoTrufi {
  const { lat, lng } = origenDe(linea);
  return {
    ...trufi,
    fase: 'en_ruta',
    avance: 0,
    lat,
    lng,
    vueltaActual: trufi.vueltaActual + 1,
    ultimaSenalEn: nowIso,
    traza: [],
    cumplimientos: [],
    bufferPuntos: [],
    eventosPendientes: [],
    puntosPendientes: 0,
    ultimoTramoSincronizado: null,
    tramoAtascado: undefined,
    trazaDesvio: undefined,
    atascoTicksRestantes: undefined,
    desvioProgreso: undefined,
    sincronizandoTicksRestantes: undefined,
  };
}

/**
 * Cierra `vueltasCompletadas` vueltas (normalmente 1, pero puede ser más de 1 si se reconcilian
 * varias vueltas cerradas MIENTRAS el trufi estaba `sin_senal`, ver
 * `senal.ts#avanzarSincronizando`) SIN teletransportar — el trufi sigue `en_ruta`/`desviado`
 * desde donde ya iba (contrato del guion delegado, ítem 1: el mapa no se vacía, un trufi NO
 * vuelve a la cola solo por completar una vuelta — la cola cambia ÚNICAMENTE vía
 * `despacharSiguiente`/`simularFueraDeOrden`/`moverEnCola`). Resetea el estado "de la vuelta"
 * (traza, cumplimientos, tramo sincronizado) e incrementa `vueltaActual` — deja todo lo demás
 * (avance, lat/lng, fase, offsets de atasco/desvío) intacto, ya seteado por `avanzarTrufi` para
 * este mismo tick.
 */
export function cerrarVuelta(
  trufi: EstadoTrufi,
  vueltasCompletadas: number,
  cumplimientosVueltaNueva: CumplimientoPunto[] = [],
): EstadoTrufi {
  if (vueltasCompletadas <= 0) {
    return trufi;
  }
  return {
    ...trufi,
    vueltaActual: trufi.vueltaActual + vueltasCompletadas,
    traza: [],
    // Cumplimientos que ocurrieron DESPUÉS del último `vuelta-completa` de este mismo tick (p.
    // ej., varias vueltas reconciliadas de una — `senal.ts#avanzarSincronizando` — donde la
    // última vuelta cerrada ya cruzó algún punto de control de la vuelta NUEVA) — los anteriores
    // ya se contaron en el recorrido que se cierra (`estado/index.ts#tick`), no acá.
    cumplimientos: cumplimientosVueltaNueva,
    ultimoTramoSincronizado: null,
  };
}

/** `finalizarRecorrido` — para la demo, deja al trufi "estacionado" donde esté (marcador gris
 * con check), sin volver a la cola. */
export function finalizarTrufi(trufi: EstadoTrufi): EstadoTrufi {
  return { ...trufi, fase: 'finalizado' };
}

export interface ParadaControlActiva {
  id: string;
  avance: number;
}

/**
 * Detecta qué eventos (cumplimiento de punto de control / vuelta completa) ocurrieron al pasar
 * de `avanceAnterior` a `avanceNuevo` — la MISMA lógica para cualquier fase "en movimiento
 * real" (`en_ruta`, `desviado`, `sin_senal`): el guion delegado pide detectar cruces en TODAS
 * las fases en movimiento (ítem 6), no solo `en_ruta` como antes. También la usa
 * `avanzarSinSenal` (`senal.ts`). `huboVuelta` (el avance dio la vuelta completa) se detecta
 * con el mismo criterio de siempre: el avance nuevo "retrocede" respecto del anterior porque
 * hizo `% 1`.
 */
export function detectarEventos(
  paradasControl: ParadaControlActiva[],
  avanceAnterior: number,
  avanceNuevo: number,
  nowIso: string,
): EventoTrufiTick[] {
  const huboVuelta = avanceNuevo < avanceAnterior;
  const eventos: EventoTrufiTick[] = [];
  for (const parada of paradasControl) {
    const cruzo = huboVuelta
      ? parada.avance > avanceAnterior || parada.avance <= avanceNuevo
      : parada.avance > avanceAnterior && parada.avance <= avanceNuevo;
    if (cruzo) {
      eventos.push({ tipo: 'cumplimiento', paradaId: parada.id, ts: nowIso });
    }
  }
  if (huboVuelta) {
    eventos.push({ tipo: 'vuelta-completa' });
  }
  return eventos;
}

/**
 * Avanza UN trufi un tick, según su `fase` actual. Devuelve el `EstadoTrufi` actualizado más
 * los eventos que le importan a otros slices (`estado/index.ts` los aplica sobre
 * `recorridos`/`salidas`). `paradasControl` son los puntos de control ACTIVOS de la línea
 * (geometría fija + `esPuntoControl` en vivo desde `estado.config` — resuelto por el caller,
 * `flota.ts` no conoce `config.ts`).
 */
export function avanzarTrufi(
  trufi: EstadoTrufi,
  linea: LineaMock,
  paradasControl: ParadaControlActiva[],
  nowIso: string,
): { trufi: EstadoTrufi; eventos: EventoTrufiTick[] } {
  const nowMs = Date.parse(nowIso);
  switch (trufi.fase) {
    case 'en_cola':
    case 'finalizado':
      return { trufi, eventos: [] };

    case 'atascado': {
      const restantes = (trufi.atascoTicksRestantes ?? 1) - 1;
      if (restantes <= 0) {
        return {
          trufi: { ...trufi, fase: 'en_ruta', atascoTicksRestantes: undefined, tramoAtascado: undefined },
          eventos: [],
        };
      }
      return { trufi: { ...trufi, atascoTicksRestantes: restantes }, eventos: [] };
    }

    case 'desviado': {
      // Sigue avanzando el avance INTERNO con normalidad — el desvío solo desplaza la posición
      // EXPUESTA (perpendicular a la ruta), no el progreso real. Ítem 6 del guion delegado:
      // detecta cruces de punto de control y cierre de vuelta acá TAMBIÉN (antes solo pasaba
      // en `en_ruta`, así que un trufi que completaba el loop mientras estaba "desviado" nunca
      // cerraba su recorrido).
      const paso = pasoPorTickDe(trufi.trufiId);
      const anterior = trufi.avance;
      const nuevoAvance = (anterior + paso) % 1;
      const eventos = detectarEventos(paradasControl, anterior, nuevoAvance, nowIso);
      const cumplimientosNuevos = eventos
        .filter((e): e is Extract<EventoTrufiTick, { tipo: 'cumplimiento' }> => e.tipo === 'cumplimiento')
        .map((e) => ({ paradaId: e.paradaId, ts: e.ts }));
      const cumplimientos = [...trufi.cumplimientos, ...cumplimientosNuevos];

      const progreso = (trufi.desvioProgreso ?? 0) + 1;
      if (progreso >= DESVIO_TICKS_TOTAL) {
        const { lat, lng } = posicionEnPolilinea(linea.polilinea, nuevoAvance);
        return {
          trufi: {
            ...trufi,
            fase: 'en_ruta',
            avance: nuevoAvance,
            lat,
            lng,
            cumplimientos,
            desvioProgreso: undefined,
            trazaDesvio: undefined,
          },
          eventos,
        };
      }
      const mitad = DESVIO_TICKS_TOTAL / 2;
      const factor = progreso <= mitad ? progreso / mitad : (DESVIO_TICKS_TOTAL - progreso) / mitad;
      const offsetM = DESVIO_OFFSET_MAX_M * factor;
      const base = posicionEnPolilinea(linea.polilinea, nuevoAvance);
      const bearing = bearingEnAvance(linea.polilinea, nuevoAvance);
      const { lat, lng } = desplazarPerpendicular(base.lat, base.lng, bearing, offsetM);
      return {
        trufi: {
          ...trufi,
          avance: nuevoAvance,
          lat,
          lng,
          cumplimientos,
          desvioProgreso: progreso,
          trazaDesvio: [...(trufi.trazaDesvio ?? []), [lat, lng]],
        },
        eventos,
      };
    }

    case 'sin_senal': {
      // `avanzarSinSenal` (`senal.ts`) YA acumula los eventos detectados en
      // `trufi.eventosPendientes` (ítem 6: mientras está offline, se coleccionan para
      // reconciliar de una sola vez al sincronizar) — no hay nada que aplicar EN VIVO acá.
      const trufiSinSenal = avanzarSinSenal(trufi, linea, paradasControl, pasoPorTickDe(trufi.trufiId), nowMs, nowIso);
      return { trufi: trufiSinSenal, eventos: [] };
    }

    case 'sincronizando': {
      // Acá SÍ puede haber eventos que reportar — son los que se acumularon en
      // `eventosPendientes` mientras estaba `sin_senal`, recién flusheados cuando termina la
      // cuenta regresiva de `sincronizando` (ver `avanzarSincronizando`).
      return avanzarSincronizando(trufi, linea, nowIso);
    }

    case 'en_ruta':
    default: {
      const paso = pasoPorTickDe(trufi.trufiId);
      const anterior = trufi.avance;
      const nuevoAvance = (anterior + paso) % 1;
      const { lat, lng } = posicionEnPolilinea(linea.polilinea, nuevoAvance);
      const eventos = detectarEventos(paradasControl, anterior, nuevoAvance, nowIso);
      const cumplimientosNuevos = eventos
        .filter((e): e is Extract<EventoTrufiTick, { tipo: 'cumplimiento' }> => e.tipo === 'cumplimiento')
        .map((e) => ({ paradaId: e.paradaId, ts: e.ts }));

      const punto: PuntoTrazado = [lat, lng, nowMs];
      return {
        trufi: {
          ...trufi,
          avance: nuevoAvance,
          lat,
          lng,
          ultimaSenalEn: nowIso,
          traza: [...trufi.traza, punto],
          cumplimientos: [...trufi.cumplimientos, ...cumplimientosNuevos],
        },
        eventos,
      };
    }
  }
}

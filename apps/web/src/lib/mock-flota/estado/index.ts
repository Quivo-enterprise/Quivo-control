import { CATALOGO_INFRACCIONES } from '../catalogo-infracciones';
import { LINEAS_MOCK, TRUFIS_MOCK } from '../datos';
import type {
  ConfigLineaInput,
  EstadoFlotaMock,
  EstadoTrufi,
  InfraccionMock,
  LineaMockId,
  ModoAplicacion,
  NovedadMock,
  SubtipoReporteConductor,
  TrufiMock,
} from '../tipos';
import {
  aplicarAccion,
  asignarParada,
  cerrarVuelta,
  elegirAleatorios,
  elegirTipoInfraccion,
  fechaPlazoValida,
  finalizarTrufi,
  iniciarAtasco,
  iniciarDesvio,
  infraccionActivaDe,
  infraccionesDe,
  INTERVALO_TICK_MS,
  limpiarInfracciones,
  PLAZO_MAX_DIAS,
  avanzarTrufi,
  sembrarSanciones,
  simularInfracciones,
  trufisEnRutaVisibles,
  trufisInicial,
  trufisReportables,
  trufisSinInfraccionActiva,
  trufisSinSenalVisibles,
} from './flota';
import { iniciarPerderSenal, iniciarRecuperarSenal } from './senal';
import { cerrarRecorridoEnCurso, crearRecorrido, recorridosDelDia, registrarCumplimiento, sembrarHistorial } from './recorridos';
import {
  colasInicial,
  despacharFueraDeOrden,
  despacharSiguiente as despacharSiguienteEnEstado,
  moverEnCola,
  reposicionarCola,
} from './salidas';
import {
  agregarNovedad,
  atenderNovedad,
  crearNovedad,
  infraccionDeNovedad,
  novedadesAbiertas,
  revisarNovedad,
  sembrarNovedades,
  vincularInfraccionANovedad,
} from './novedades';
import {
  alternarHoraPico as alternarHoraPicoEnEstado,
  demandaDe,
  movimientoPorHora,
  movimientoTipicoPorHora,
  paradasConAltaDemanda,
} from './demanda';
import { configDe, configInicial, guardarConfigLinea, paradasDe, puntosControlActivosDe, validarConfigLinea } from './config';

/**
 * `estado/index.ts` — arma el `EstadoFlotaMock` combinado a partir de los slices de
 * `estado/*` (`flota`, `salidas`, `recorridos`, `novedades`, `senal`, `demanda`, `config`) y
 * expone la ÚNICA API pública del reducer: `estadoInicial`, `reducer`, `INTERVALO_TICK_MS`, y
 * todos los selectores/helpers re-exportados (ver `../index.ts`, el barrel del módulo, para la
 * lista completa documentada).
 *
 * El reducer sigue siendo PURO (mismo diseño que el `estado.ts` original): CERO
 * `Math.random()`/`new Date()` en este archivo — `now`, los ids y cualquier sorteo viajan YA
 * RESUELTOS en el payload de la acción, resueltos por `flota-mock-context.tsx`. La ÚNICA
 * excepción real es `estadoInicial(now)`, que NO es el reducer sino el INICIALIZADOR que le
 * pasa `useReducer` (mismo patrón que el módulo ya tenía) — es una función pura de `now`
 * (nunca lee `Date.now()` internamente), así que sigue siendo 100% testeable pasándole un
 * `Date` fijo.
 */

// ============================================================================================
// Re-exports de los slices — ver cada archivo de `estado/*` para el detalle de cada uno.
// ============================================================================================

export {
  PLAZO_MAX_DIAS,
  fechaPlazoValida,
  infraccionActivaDe,
  infraccionesDe,
  trufisSinInfraccionActiva,
  elegirAleatorios,
  elegirTipoInfraccion,
  INTERVALO_TICK_MS,
  trufisEnRutaVisibles,
  trufisSinSenalVisibles,
  trufisReportables,
};
export { SINCRONIZANDO_TICKS } from './senal';
export { recorridosDelDia };
export { colaDe, delanteDetras, horariosCola, salidasDelDia, type GapTrufi } from './salidas';
export { novedadesAbiertas, infraccionDeNovedad };
export { demandaDe, movimientoPorHora, movimientoTipicoPorHora, paradasConAltaDemanda };
export { configDe, validarConfigLinea, puntosControlActivosDe, paradasDe };

/** KPIs de la franja superior (E07 03:48 del guion) — respeta el filtro de línea del HUD. */
export function kpis(
  estado: EstadoFlotaMock,
  lineaId?: LineaMockId,
): {
  enRuta: number;
  enCola: number;
  finalizados: number;
  sinSenal: number;
  atascados: number;
  novedadesAbiertas: number;
} {
  const visibles = lineaId ? TRUFIS_MOCK.filter((t) => t.lineaId === lineaId) : TRUFIS_MOCK;
  let enRuta = 0;
  let enCola = 0;
  let finalizados = 0;
  let sinSenal = 0;
  let atascados = 0;
  for (const trufi of visibles) {
    const fase = estado.trufis[trufi.id]?.fase;
    if (fase === 'en_ruta' || fase === 'desviado') {
      enRuta += 1;
    } else if (fase === 'en_cola') {
      enCola += 1;
    } else if (fase === 'finalizado') {
      finalizados += 1;
    } else if (fase === 'sin_senal' || fase === 'sincronizando') {
      sinSenal += 1;
    }
    if (fase === 'atascado') {
      atascados += 1;
    }
  }
  return { enRuta, enCola, finalizados, sinSenal, atascados, novedadesAbiertas: novedadesAbiertas(estado, lineaId).length };
}

// ============================================================================================
// Estado inicial
// ============================================================================================

export function estadoInicial(now: Date = new Date()): EstadoFlotaMock {
  const nowIso = now.toISOString();
  const trufis = trufisInicial(nowIso);
  const { recorridos: recorridosSembrados, salidas: salidasSembradas } = sembrarHistorial(now);
  const novedadesSembradas = sembrarNovedades(now);
  const infraccionesSembradas = sembrarSanciones(now);
  const config = configInicial();

  let estadoBase: EstadoFlotaMock = {
    trufis,
    infracciones: infraccionesSembradas,
    pausado: false,
    colas: colasInicial(),
    salidas: salidasSembradas,
    recorridos: recorridosSembrados,
    novedades: novedadesSembradas,
    horaPico: false,
    config,
  };

  // Vuelta EN CURSO de cada trufi `en_ruta` de la escena inicial (un `en_cola` no tiene
  // recorrido abierto hasta que lo despachen). Ítem 3 del guion delegado: los trufis `en_ruta`
  // arrancan a MITAD de vuelta (`avanceInicial` 0.2-0.66, `flota.ts#VELOCIDADES`) — si
  // `puntosTotal` contara TODOS los puntos de control de la línea, esta primera vuelta parcial
  // jamás podría cerrar `completo` (los puntos con `avance <= avanceInicial` ya quedaron
  // ATRÁS y no se van a volver a cruzar hasta la SIGUIENTE vuelta, que arranca desde 0 recién
  // en el wrap). Se cuenta solo lo que queda ADELANTE del avance de arranque — eso SÍ se va a
  // cruzar antes de que esta vuelta cierre.
  for (const trufi of TRUFIS_MOCK) {
    const trufiEstado = trufis[trufi.id];
    if (trufiEstado?.fase === 'en_ruta') {
      const puntosTotal = puntosControlActivosDe(estadoBase, trufi.lineaId).filter((p) => p.avance > trufiEstado.avance).length;
      estadoBase = {
        ...estadoBase,
        recorridos: [...estadoBase.recorridos, crearRecorrido(`rec-init-${trufi.id}`, trufi.id, trufi.lineaId, nowIso, puntosTotal)],
      };
    }
  }

  // Ítem 2: separa los marcadores de los trufis `en_cola` (si no, todos arrancan apilados en
  // el origen de su línea).
  estadoBase = reposicionarCola(estadoBase, 'z12');
  estadoBase = reposicionarCola(estadoBase, 'l120');

  return estadoBase;
}

// ============================================================================================
// Acciones
// ============================================================================================

export type AccionFlotaMock =
  | { type: 'tick'; now: string }
  | { type: 'simular-infracciones'; infracciones: InfraccionMock[] }
  | { type: 'limpiar-infracciones'; trufiIds?: string[] }
  | { type: 'asignar-parada'; trufiId: string; paradaId: string }
  | {
      type: 'aplicar-accion';
      infraccionId: string;
      accionId: string;
      modo: ModoAplicacion;
      aplicadaEn: string;
      venceEl?: string;
    }
  | { type: 'toggle-pausa' }
  | { type: 'despachar-siguiente'; lineaId: LineaMockId; now: string; salidaId: string; recorridoId: string }
  | { type: 'mover-en-cola'; trufiId: string; delta: 1 | -1 }
  | { type: 'simular-atasco'; trufiId: string; now: string; novedadId: string }
  | { type: 'simular-desvio'; trufiId: string; now: string; novedadId: string; infraccionId: string }
  | {
      type: 'simular-fuera-de-orden';
      lineaId: LineaMockId;
      trufiId: string;
      now: string;
      salidaId: string;
      recorridoId: string;
      novedadId: string;
    }
  | { type: 'simular-reporte-conductor'; trufiId: string; subtipo: SubtipoReporteConductor; now: string; novedadId: string }
  | { type: 'perder-senal'; trufiId: string; now: string; novedadId: string }
  | { type: 'recuperar-senal'; trufiId: string }
  | { type: 'alternar-hora-pico' }
  | { type: 'finalizar-recorrido'; trufiId: string; now: string }
  | { type: 'atender-novedad'; id: string; nota: string }
  | { type: 'revisar-novedad'; id: string }
  | { type: 'crear-infraccion-desde-novedad'; novedadId: string; tipoId: string; infraccionId: string; now: string }
  | { type: 'guardar-config-linea'; lineaId: LineaMockId; config: ConfigLineaInput }
  | { type: 'reiniciar-demo'; now: string };

function aplicarSimularAtasco(estado: EstadoFlotaMock, accion: Extract<AccionFlotaMock, { type: 'simular-atasco' }>): EstadoFlotaMock {
  const trufiInfo = TRUFIS_MOCK.find((t) => t.id === accion.trufiId);
  const trufi = estado.trufis[accion.trufiId];
  if (!trufiInfo || !trufi || trufi.fase !== 'en_ruta') {
    return estado;
  }
  const trufiActualizado = iniciarAtasco(trufi, LINEAS_MOCK[trufiInfo.lineaId]);
  const novedad = crearNovedad(accion.novedadId, 'atascado', accion.trufiId, accion.now);
  return agregarNovedad({ ...estado, trufis: { ...estado.trufis, [accion.trufiId]: trufiActualizado } }, novedad);
}

function aplicarSimularDesvio(estado: EstadoFlotaMock, accion: Extract<AccionFlotaMock, { type: 'simular-desvio' }>): EstadoFlotaMock {
  const trufi = estado.trufis[accion.trufiId];
  if (!trufi || trufi.fase !== 'en_ruta') {
    return estado;
  }
  const trufiActualizado = iniciarDesvio(trufi);
  // Ítem 12: si el trufi YA tiene una infracción activa, `simularInfracciones` la descarta en
  // silencio (dedupe) más abajo — en ese caso la novedad se crea SIN `infraccionId` (no hay
  // infracción real detrás para vincular). El hook (`flota-mock-context.tsx`) ya bloquea este
  // caso ANTES de despachar, pero el reducer se queda defensivo por las dudas de que se
  // dispatchee este `type` directo (tests, `reiniciarDemo`, etc.).
  const yaTeniaInfraccionActiva = !!infraccionActivaDe(estado, accion.trufiId);
  const novedad = crearNovedad(
    accion.novedadId,
    'desvio',
    accion.trufiId,
    accion.now,
    undefined,
    yaTeniaInfraccionActiva ? undefined : accion.infraccionId,
  );
  const tipo = CATALOGO_INFRACCIONES.find((t) => t.id === 'desvio-de-ruta');
  let siguiente: EstadoFlotaMock = { ...estado, trufis: { ...estado.trufis, [accion.trufiId]: trufiActualizado } };
  siguiente = agregarNovedad(siguiente, novedad);
  if (tipo && !yaTeniaInfraccionActiva) {
    const infraccion: InfraccionMock = {
      id: accion.infraccionId,
      trufiId: accion.trufiId,
      tipoId: tipo.id,
      severidad: tipo.severidad,
      ocurridaEn: accion.now,
      estado: 'activa',
    };
    siguiente = simularInfracciones(siguiente, [infraccion]);
  }
  return siguiente;
}

function aplicarSimularFueraDeOrden(
  estado: EstadoFlotaMock,
  accion: Extract<AccionFlotaMock, { type: 'simular-fuera-de-orden' }>,
): EstadoFlotaMock {
  const despachado = despacharFueraDeOrden(estado, accion.lineaId, accion.trufiId, accion.now, accion.salidaId, accion.recorridoId);
  if (despachado === estado) {
    return estado;
  }
  const novedad = crearNovedad(accion.novedadId, 'fuera_de_orden', accion.trufiId, accion.now);
  return agregarNovedad(despachado, novedad);
}

function aplicarSimularReporteConductor(
  estado: EstadoFlotaMock,
  accion: Extract<AccionFlotaMock, { type: 'simular-reporte-conductor' }>,
): EstadoFlotaMock {
  if (!estado.trufis[accion.trufiId]) {
    return estado;
  }
  const novedad = crearNovedad(accion.novedadId, 'reporte_conductor', accion.trufiId, accion.now, accion.subtipo);
  return agregarNovedad(estado, novedad);
}

function aplicarPerderSenal(estado: EstadoFlotaMock, accion: Extract<AccionFlotaMock, { type: 'perder-senal' }>): EstadoFlotaMock {
  const trufi = estado.trufis[accion.trufiId];
  if (!trufi || trufi.fase !== 'en_ruta') {
    return estado;
  }
  const trufiActualizado = iniciarPerderSenal(trufi, accion.now);
  const novedad = crearNovedad(accion.novedadId, 'sin_senal', accion.trufiId, accion.now);
  return agregarNovedad({ ...estado, trufis: { ...estado.trufis, [accion.trufiId]: trufiActualizado } }, novedad);
}

function aplicarRecuperarSenal(estado: EstadoFlotaMock, accion: Extract<AccionFlotaMock, { type: 'recuperar-senal' }>): EstadoFlotaMock {
  const trufi = estado.trufis[accion.trufiId];
  if (!trufi || trufi.fase !== 'sin_senal') {
    return estado;
  }
  return { ...estado, trufis: { ...estado.trufis, [accion.trufiId]: iniciarRecuperarSenal(trufi) } };
}

function aplicarFinalizarRecorrido(
  estado: EstadoFlotaMock,
  accion: Extract<AccionFlotaMock, { type: 'finalizar-recorrido' }>,
): EstadoFlotaMock {
  const trufi = estado.trufis[accion.trufiId];
  if (!trufi || trufi.fase !== 'en_ruta') {
    return estado;
  }
  const cerrado = cerrarRecorridoEnCurso(estado, accion.trufiId, accion.now);
  return { ...cerrado, trufis: { ...cerrado.trufis, [accion.trufiId]: finalizarTrufi(trufi) } };
}

function aplicarCrearInfraccionDesdeNovedad(
  estado: EstadoFlotaMock,
  accion: Extract<AccionFlotaMock, { type: 'crear-infraccion-desde-novedad' }>,
): EstadoFlotaMock {
  const novedad: NovedadMock | undefined = estado.novedades.find((n) => n.id === accion.novedadId);
  const tipo = CATALOGO_INFRACCIONES.find((t) => t.id === accion.tipoId);
  // Defensivo (mismo motivo que `aplicarSimularDesvio`): el hook ya bloquea con el trufi ya
  // activo ANTES de despachar (ítem 13), pero el reducer no confía ciegamente en el caller.
  if (!novedad || !tipo || infraccionActivaDe(estado, novedad.trufiId)) {
    return estado;
  }
  const infraccion: InfraccionMock = {
    id: accion.infraccionId,
    trufiId: novedad.trufiId,
    tipoId: tipo.id,
    severidad: tipo.severidad,
    ocurridaEn: accion.now,
    estado: 'activa',
  };
  const siguiente = simularInfracciones(estado, [infraccion]);
  if (siguiente === estado) {
    return estado;
  }
  // Ítem 12: vincula la novedad con la infracción recién creada.
  return vincularInfraccionANovedad(siguiente, accion.novedadId, accion.infraccionId);
}

/**
 * Tick — avanza TODOS los trufis un paso y aplica los eventos que reporta `flota.ts` sobre
 * `recorridos`/`colas` (cumplimiento de punto de control, vuelta completa). Es la única
 * función de este archivo que toca varios slices a la vez porque el movimiento de un trufi es
 * INHERENTEMENTE cross-cutting — el resto de las acciones tocan como mucho 2 slices
 * (trufi + novedad) y viven en los `aplicar*` de arriba.
 */
/** Abre el SIGUIENTE recorrido `en_curso` de `trufiInfo` apenas cierra el anterior — ítem 1 del
 * guion delegado: un trufi que completa una vuelta arranca la SIGUIENTE de una, sin pasar por
 * la cola (la cola solo cambia vía `despacharSiguiente`/`simularFueraDeOrden`/`moverEnCola`).
 * Usa un id determinístico (`nowIso` + `trufiId`) — el reducer sigue siendo puro, no hace falta
 * que el caller (`flota-mock-context.tsx`) resuelva un id para esto, a diferencia del despacho
 * manual (que SÍ recibe `recorridoId` ya resuelto, porque ahí es una acción explícita del
 * delegado, no un evento automático del tick). */
function cerrarVueltaYAbrirNueva(estado: EstadoFlotaMock, trufiInfo: TrufiMock, nowIso: string): EstadoFlotaMock {
  const cerrado = cerrarRecorridoEnCurso(estado, trufiInfo.id, nowIso);
  const puntosTotal = puntosControlActivosDe(cerrado, trufiInfo.lineaId).length;
  // El id incluye `cerrado.recorridos.length` (no solo `nowIso`) para seguir siendo ÚNICO
  // incluso si dos vueltas del MISMO trufi se cierran con el mismo `nowIso` (posible en tests
  // que llaman `tick` repetidas veces con un timestamp fijo — en producción `now` cambia solo
  // cada segundo real, así que esto no pasa, pero el reducer no depende de esa garantía).
  const recorrido = crearRecorrido(
    `rec-loop-${trufiInfo.id}-${cerrado.recorridos.length}-${nowIso}`,
    trufiInfo.id,
    trufiInfo.lineaId,
    nowIso,
    puntosTotal,
  );
  return { ...cerrado, recorridos: [...cerrado.recorridos, recorrido] };
}

/**
 * Tick — avanza TODOS los trufis un paso y aplica los eventos que reporta `flota.ts`/`senal.ts`
 * sobre `recorridos` (cumplimiento de punto de control, vuelta completa). Es la única función
 * de este archivo que toca varios slices a la vez porque el movimiento de un trufi es
 * INHERENTEMENTE cross-cutting — el resto de las acciones tocan como mucho 2 slices (trufi +
 * novedad) y viven en los `aplicar*` de arriba.
 *
 * `eventos` puede venir de DOS fuentes, tratadas EXACTAMENTE igual acá (ítem 6 del guion
 * delegado): en vivo, de un trufi `en_ruta`/`desviado` que cruzó algo ESTE tick; o
 * reconciliados de una, de un trufi `sincronizando` que recién terminó de volcar su buffer y
 * reporta TODO lo que se coleccionó mientras estaba `sin_senal` (`senal.ts#avanzarSincronizando`)
 * — en ese caso `eventos` puede traer VARIAS vueltas completas de una sola vez. Los eventos se
 * procesan EN ORDEN: cada `cumplimiento` suma al recorrido `en_curso` en ese momento (así que un
 * cumplimiento justo antes de una `vuelta-completa` queda contado en el recorrido que se
 * CIERRA, no en el que se abre a continuación) y cada `vuelta-completa` cierra ese recorrido y
 * abre el siguiente (ítem 1). Ítem 5: cada evento cuenta, no solo "hubo al menos uno"
 * (`eventos.some(...)` — el bug original solo registraba 1 cumplimiento aunque el tick hubiera
 * cruzado varios puntos de control de una).
 */
function tick(estado: EstadoFlotaMock, nowIso: string): EstadoFlotaMock {
  if (estado.pausado) {
    return estado;
  }

  let siguiente = estado;
  const trufisNuevos: Record<string, EstadoTrufi> = {};

  for (const trufiInfo of TRUFIS_MOCK) {
    const actual = estado.trufis[trufiInfo.id];
    if (!actual) {
      continue;
    }
    const linea = LINEAS_MOCK[trufiInfo.lineaId];
    const paradasControl = puntosControlActivosDe(siguiente, trufiInfo.lineaId);
    const { trufi: avanzado, eventos } = avanzarTrufi(actual, linea, paradasControl, nowIso);

    let trufiFinal = avanzado;
    let vueltasCompletadas = 0;
    let cumplimientosDesdeUltimaVuelta: EstadoTrufi['cumplimientos'] = [];

    for (const evento of eventos) {
      if (evento.tipo === 'cumplimiento') {
        siguiente = registrarCumplimiento(siguiente, trufiInfo.id);
        cumplimientosDesdeUltimaVuelta = [...cumplimientosDesdeUltimaVuelta, { paradaId: evento.paradaId, ts: evento.ts }];
      } else {
        siguiente = cerrarVueltaYAbrirNueva(siguiente, trufiInfo, nowIso);
        vueltasCompletadas += 1;
        cumplimientosDesdeUltimaVuelta = [];
      }
    }

    if (vueltasCompletadas > 0) {
      trufiFinal = cerrarVuelta(avanzado, vueltasCompletadas, cumplimientosDesdeUltimaVuelta);
    }

    trufisNuevos[trufiInfo.id] = trufiFinal;
  }

  return { ...siguiente, trufis: trufisNuevos };
}

export function reducer(estado: EstadoFlotaMock, accion: AccionFlotaMock): EstadoFlotaMock {
  switch (accion.type) {
    case 'tick':
      return tick(estado, accion.now);
    case 'simular-infracciones':
      return simularInfracciones(estado, accion.infracciones);
    case 'limpiar-infracciones':
      return limpiarInfracciones(estado, accion.trufiIds);
    case 'asignar-parada':
      return asignarParada(estado, accion.trufiId, accion.paradaId);
    case 'aplicar-accion':
      return aplicarAccion(estado, accion.infraccionId, accion.accionId, accion.modo, accion.aplicadaEn, accion.venceEl);
    case 'toggle-pausa':
      return { ...estado, pausado: !estado.pausado };
    case 'despachar-siguiente':
      return despacharSiguienteEnEstado(estado, accion.lineaId, accion.now, accion.salidaId, accion.recorridoId);
    case 'mover-en-cola':
      return moverEnCola(estado, accion.trufiId, accion.delta);
    case 'simular-atasco':
      return aplicarSimularAtasco(estado, accion);
    case 'simular-desvio':
      return aplicarSimularDesvio(estado, accion);
    case 'simular-fuera-de-orden':
      return aplicarSimularFueraDeOrden(estado, accion);
    case 'simular-reporte-conductor':
      return aplicarSimularReporteConductor(estado, accion);
    case 'perder-senal':
      return aplicarPerderSenal(estado, accion);
    case 'recuperar-senal':
      return aplicarRecuperarSenal(estado, accion);
    case 'alternar-hora-pico':
      return alternarHoraPicoEnEstado(estado);
    case 'finalizar-recorrido':
      return aplicarFinalizarRecorrido(estado, accion);
    case 'atender-novedad':
      return atenderNovedad(estado, accion.id, accion.nota);
    case 'revisar-novedad':
      return revisarNovedad(estado, accion.id);
    case 'crear-infraccion-desde-novedad':
      return aplicarCrearInfraccionDesdeNovedad(estado, accion);
    case 'guardar-config-linea':
      return guardarConfigLinea(estado, accion.lineaId, accion.config);
    case 'reiniciar-demo':
      return estadoInicial(new Date(accion.now));
    default:
      return estado;
  }
}

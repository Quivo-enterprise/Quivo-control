'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import { CATALOGO_INFRACCIONES } from './catalogo-infracciones';
import { LINEAS_MOCK, TRUFIS_MOCK } from './datos';
import {
  colaDe,
  elegirAleatorios,
  elegirTipoInfraccion,
  estadoInicial,
  infraccionActivaDe,
  INTERVALO_TICK_MS,
  reducer,
  trufisEnRutaVisibles,
  trufisReportables,
  trufisSinInfraccionActiva,
  trufisSinSenalVisibles,
  validarConfigLinea,
} from './estado';
import type {
  ConfigLineaInput,
  EstadoFlotaMock,
  InfraccionMock,
  LineaMock,
  LineaMockId,
  ModoAplicacion,
  Severidad,
  SubtipoReporteConductor,
  TrufiMock,
} from './tipos';

/** Trufis de `TRUFIS_MOCK` que corresponden a `lineaId`, o todos si `lineaId` es `undefined`
 * (filtro "Todas" del HUD). Reutilizado por `simularInfracciones`/`limpiarInfracciones` de
 * abajo — ambos aceptan un `lineaId` opcional para operar solo sobre los trufis VISIBLES bajo
 * el filtro de línea (Decisión CTO, 2026-09-27), sin que el reducer (`estado/`) tenga que
 * saber qué es una "línea". */
function trufisDeLinea(lineaId?: LineaMockId): TrufiMock[] {
  return lineaId ? TRUFIS_MOCK.filter((t) => t.lineaId === lineaId) : TRUFIS_MOCK;
}

/** Id determinístico-al-azar para una entidad sembrada en vivo (salida/recorrido/novedad/
 * infracción) — mismo patrón que ya usaba `simularInfracciones` antes de esta ampliación. */
function nuevoId(prefijo: string): string {
  return `${prefijo}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

/** Resultado de una acción que PUEDE fallar (ítem 13 del guion delegado: "Actions must report
 * success") — antes estas acciones no-opeaban en silencio cuando la condición no se cumplía
 * (cola vacía, config inválida, trufi con infracción activa) y el que llamaba no tenía forma de
 * saberlo. Se resuelve ACÁ, antes de dispatchear, a partir del `estado` actual — no en el
 * reducer (que se queda puro e IGUAL de defensivo por las dudas, ver `estado/index.ts`). */
export type AccionResultado = { ok: true } | { ok: false; motivo: string };

function motivoInfraccionActiva(estado: EstadoFlotaMock, trufiId: string): string {
  const activa = infraccionActivaDe(estado, trufiId);
  const tipo = activa ? CATALOGO_INFRACCIONES.find((t) => t.id === activa.tipoId) : undefined;
  return `El trufi ya tiene una infracción activa (${tipo?.nombre ?? activa?.tipoId ?? 'sin nombre'}).`;
}

/**
 * Provider + hook del mock de flota (`docs/plan-mock-flota-en-vivo.md` y, para la ampliación
 * del panel del delegado, `docs/plan-mock-guion-delegado.md`). El reducer (`estado/`) es puro
 * a propósito — acá viven las ÚNICAS fuentes de no-determinismo del módulo: `Math.random()`
 * (qué trufi/línea sortea cada acción de escenario) y `Date.now()`/`new Date()` (los
 * timestamps e ids de cada acción). Ambas se resuelven acá, antes de dispatchear, para que el
 * reducer siga siendo 100% testeable sin mockear nada global.
 */

interface FlotaMockContextValue {
  estado: EstadoFlotaMock;
  lineas: Record<LineaMockId, LineaMock>;
  trufis: TrufiMock[];
  catalogo: typeof CATALOGO_INFRACCIONES;

  // -- Heredadas del mock original (firma sin cambios) --
  simularInfracciones: (n: 1 | 2 | 3, severidad: Severidad | 'aleatoria', lineaId?: LineaMockId) => void;
  limpiarInfracciones: (lineaId?: LineaMockId) => void;
  asignarParada: (trufiId: string, paradaId: string) => void;
  aplicarAccion: (infraccionId: string, accionId: string, modo: ModoAplicacion, venceEl?: string) => void;
  togglePausa: () => void;

  // -- Coordinación de salidas --
  despacharSiguiente: (lineaId: LineaMockId) => AccionResultado;
  moverEnCola: (trufiId: string, delta: 1 | -1) => void;

  // -- Escenarios de demo --
  simularAtasco: (trufiId?: string) => void;
  simularDesvio: (trufiId?: string) => AccionResultado;
  simularFueraDeOrden: (trufiId?: string) => void;
  simularReporteConductor: (subtipo?: SubtipoReporteConductor, trufiId?: string) => void;
  perderSenal: (trufiId?: string) => void;
  recuperarSenal: (trufiId?: string) => void;
  alternarHoraPico: () => void;
  finalizarRecorrido: (trufiId?: string) => void;
  reiniciarDemo: () => void;

  // -- Novedades --
  atenderNovedad: (id: string, nota: string) => void;
  revisarNovedad: (id: string) => void;
  crearInfraccionDesdeNovedad: (novedadId: string, tipoId: string) => AccionResultado;

  // -- Configuración --
  guardarConfigLinea: (lineaId: LineaMockId, config: ConfigLineaInput) => AccionResultado;
}

const FlotaMockContext = createContext<FlotaMockContextValue | null>(null);

export function FlotaMockProvider({ children }: { children: ReactNode }) {
  const [estado, dispatch] = useReducer(reducer, undefined, () => estadoInicial(new Date()));

  useEffect(() => {
    if (estado.pausado) {
      return;
    }
    const id = setInterval(() => {
      dispatch({ type: 'tick', now: new Date().toISOString() });
    }, INTERVALO_TICK_MS);
    return () => clearInterval(id);
  }, [estado.pausado]);

  // Depende de `estado` (no `[]`): necesita la lista de infracciones activas AL MOMENTO del
  // click para no elegir un trufi que ya tiene una (el reducer también lo filtra como
  // segunda defensa, pero acá es donde se decide QUÉ trufis entran al sorteo).
  const simularInfracciones = useCallback(
    (n: 1 | 2 | 3, severidad: Severidad | 'aleatoria', lineaId?: LineaMockId) => {
      const disponibles = trufisSinInfraccionActiva(estado, trufisDeLinea(lineaId).map((t) => t.id));
      const elegidos = elegirAleatorios(disponibles, n, Math.random);
      const ahora = new Date().toISOString();
      const infracciones: InfraccionMock[] = elegidos.map((trufiId) => {
        const tipo = elegirTipoInfraccion(severidad, Math.random);
        return {
          id: nuevoId(`inf-${trufiId}`),
          trufiId,
          tipoId: tipo.id,
          severidad: tipo.severidad,
          ocurridaEn: ahora,
          estado: 'activa',
        };
      });
      dispatch({ type: 'simular-infracciones', infracciones });
    },
    [estado],
  );

  const limpiarInfracciones = useCallback((lineaId?: LineaMockId) => {
    dispatch({ type: 'limpiar-infracciones', trufiIds: lineaId ? trufisDeLinea(lineaId).map((t) => t.id) : undefined });
  }, []);

  const asignarParada = useCallback((trufiId: string, paradaId: string) => {
    dispatch({ type: 'asignar-parada', trufiId, paradaId });
  }, []);

  const aplicarAccion = useCallback((infraccionId: string, accionId: string, modo: ModoAplicacion, venceEl?: string) => {
    dispatch({ type: 'aplicar-accion', infraccionId, accionId, modo, aplicadaEn: new Date().toISOString(), venceEl });
  }, []);

  const togglePausa = useCallback(() => {
    dispatch({ type: 'toggle-pausa' });
  }, []);

  const despacharSiguiente = useCallback(
    (lineaId: LineaMockId): AccionResultado => {
      if (colaDe(estado, lineaId).length === 0) {
        return { ok: false, motivo: 'La cola de la línea está vacía.' };
      }
      dispatch({
        type: 'despachar-siguiente',
        lineaId,
        now: new Date().toISOString(),
        salidaId: nuevoId(`sal-${lineaId}`),
        recorridoId: nuevoId(`rec-${lineaId}`),
      });
      return { ok: true };
    },
    [estado],
  );

  const moverEnCola = useCallback((trufiId: string, delta: 1 | -1) => {
    dispatch({ type: 'mover-en-cola', trufiId, delta });
  }, []);

  const simularAtasco = useCallback(
    (trufiId?: string) => {
      const elegible = trufiId ?? elegirAleatorios(trufisEnRutaVisibles(estado), 1, Math.random)[0];
      if (!elegible) return;
      dispatch({ type: 'simular-atasco', trufiId: elegible, now: new Date().toISOString(), novedadId: nuevoId(`nov-${elegible}`) });
    },
    [estado],
  );

  const simularDesvio = useCallback(
    (trufiId?: string): AccionResultado => {
      const elegible = trufiId ?? elegirAleatorios(trufisEnRutaVisibles(estado), 1, Math.random)[0];
      if (!elegible) {
        return { ok: false, motivo: 'No hay trufis en ruta disponibles.' };
      }
      if (infraccionActivaDe(estado, elegible)) {
        return { ok: false, motivo: motivoInfraccionActiva(estado, elegible) };
      }
      const ahora = new Date().toISOString();
      dispatch({
        type: 'simular-desvio',
        trufiId: elegible,
        now: ahora,
        novedadId: nuevoId(`nov-${elegible}`),
        infraccionId: nuevoId(`inf-${elegible}`),
      });
      return { ok: true };
    },
    [estado],
  );

  // "El 2° de la cola sale antes que la cabeza" — si viene `trufiId`, resuelve a qué línea
  // pertenece y verifica que esté en la cola en una posición >= 1 (posición 0 sería un
  // despacho normal, no "fuera de orden"); sin `trufiId`, sortea entre las líneas con >= 2
  // trufis en cola y toma el de la posición 1.
  const simularFueraDeOrden = useCallback(
    (trufiId?: string) => {
      let lineaId: LineaMockId | undefined;
      let objetivo: string | undefined;
      if (trufiId) {
        const trufi = TRUFIS_MOCK.find((t) => t.id === trufiId);
        if (!trufi) return;
        const cola = colaDe(estado, trufi.lineaId);
        if (cola.indexOf(trufiId) < 1) return;
        lineaId = trufi.lineaId;
        objetivo = trufiId;
      } else {
        const lineasConCandidato = (Object.keys(LINEAS_MOCK) as LineaMockId[]).filter((id) => colaDe(estado, id).length >= 2);
        lineaId = elegirAleatorios(lineasConCandidato, 1, Math.random)[0];
        objetivo = lineaId ? colaDe(estado, lineaId)[1] : undefined;
      }
      if (!lineaId || !objetivo) return;
      const ahora = new Date().toISOString();
      dispatch({
        type: 'simular-fuera-de-orden',
        lineaId,
        trufiId: objetivo,
        now: ahora,
        salidaId: nuevoId(`sal-${lineaId}`),
        recorridoId: nuevoId(`rec-${lineaId}`),
        novedadId: nuevoId(`nov-${objetivo}`),
      });
    },
    [estado],
  );

  const SUBTIPOS_REPORTE: SubtipoReporteConductor[] = useMemo(
    () => ['pinchazo', 'control_policial', 'bloqueo_via', 'falla_mecanica', 'incidente_pasajero'],
    [],
  );

  const simularReporteConductor = useCallback(
    (subtipo?: SubtipoReporteConductor, trufiId?: string) => {
      const elegible = trufiId ?? elegirAleatorios(trufisReportables(estado), 1, Math.random)[0];
      if (!elegible) return;
      const subtipoResuelto = subtipo ?? elegirAleatorios(SUBTIPOS_REPORTE, 1, Math.random)[0]!;
      dispatch({
        type: 'simular-reporte-conductor',
        trufiId: elegible,
        subtipo: subtipoResuelto,
        now: new Date().toISOString(),
        novedadId: nuevoId(`nov-${elegible}`),
      });
    },
    [estado, SUBTIPOS_REPORTE],
  );

  const perderSenal = useCallback(
    (trufiId?: string) => {
      const elegible = trufiId ?? elegirAleatorios(trufisEnRutaVisibles(estado), 1, Math.random)[0];
      if (!elegible) return;
      dispatch({ type: 'perder-senal', trufiId: elegible, now: new Date().toISOString(), novedadId: nuevoId(`nov-${elegible}`) });
    },
    [estado],
  );

  const recuperarSenal = useCallback(
    (trufiId?: string) => {
      const elegible = trufiId ?? elegirAleatorios(trufisSinSenalVisibles(estado), 1, Math.random)[0];
      if (!elegible) return;
      dispatch({ type: 'recuperar-senal', trufiId: elegible });
    },
    [estado],
  );

  const alternarHoraPico = useCallback(() => {
    dispatch({ type: 'alternar-hora-pico' });
  }, []);

  const finalizarRecorrido = useCallback(
    (trufiId?: string) => {
      const elegible = trufiId ?? elegirAleatorios(trufisEnRutaVisibles(estado), 1, Math.random)[0];
      if (!elegible) return;
      dispatch({ type: 'finalizar-recorrido', trufiId: elegible, now: new Date().toISOString() });
    },
    [estado],
  );

  const reiniciarDemo = useCallback(() => {
    dispatch({ type: 'reiniciar-demo', now: new Date().toISOString() });
  }, []);

  const atenderNovedad = useCallback((id: string, nota: string) => {
    dispatch({ type: 'atender-novedad', id, nota });
  }, []);

  const revisarNovedad = useCallback((id: string) => {
    dispatch({ type: 'revisar-novedad', id });
  }, []);

  const crearInfraccionDesdeNovedad = useCallback(
    (novedadId: string, tipoId: string): AccionResultado => {
      const novedad = estado.novedades.find((n) => n.id === novedadId);
      if (!novedad) {
        return { ok: false, motivo: 'La novedad ya no existe.' };
      }
      const tipo = CATALOGO_INFRACCIONES.find((t) => t.id === tipoId);
      if (!tipo) {
        return { ok: false, motivo: 'Tipo de infracción inválido.' };
      }
      if (infraccionActivaDe(estado, novedad.trufiId)) {
        return { ok: false, motivo: motivoInfraccionActiva(estado, novedad.trufiId) };
      }
      dispatch({
        type: 'crear-infraccion-desde-novedad',
        novedadId,
        tipoId,
        infraccionId: nuevoId(`inf-${novedadId}`),
        now: new Date().toISOString(),
      });
      return { ok: true };
    },
    [estado],
  );

  const guardarConfigLinea = useCallback((lineaId: LineaMockId, config: ConfigLineaInput): AccionResultado => {
    const errores = validarConfigLinea(config);
    if (errores.length > 0) {
      return { ok: false, motivo: errores.join(' ') };
    }
    dispatch({ type: 'guardar-config-linea', lineaId, config });
    return { ok: true };
  }, []);

  const value = useMemo<FlotaMockContextValue>(
    () => ({
      estado,
      lineas: LINEAS_MOCK,
      trufis: TRUFIS_MOCK,
      catalogo: CATALOGO_INFRACCIONES,
      simularInfracciones,
      limpiarInfracciones,
      asignarParada,
      aplicarAccion,
      togglePausa,
      despacharSiguiente,
      moverEnCola,
      simularAtasco,
      simularDesvio,
      simularFueraDeOrden,
      simularReporteConductor,
      perderSenal,
      recuperarSenal,
      alternarHoraPico,
      finalizarRecorrido,
      reiniciarDemo,
      atenderNovedad,
      revisarNovedad,
      crearInfraccionDesdeNovedad,
      guardarConfigLinea,
    }),
    [
      estado,
      simularInfracciones,
      limpiarInfracciones,
      asignarParada,
      aplicarAccion,
      togglePausa,
      despacharSiguiente,
      moverEnCola,
      simularAtasco,
      simularDesvio,
      simularFueraDeOrden,
      simularReporteConductor,
      perderSenal,
      recuperarSenal,
      alternarHoraPico,
      finalizarRecorrido,
      reiniciarDemo,
      atenderNovedad,
      revisarNovedad,
      crearInfraccionDesdeNovedad,
      guardarConfigLinea,
    ],
  );

  return <FlotaMockContext.Provider value={value}>{children}</FlotaMockContext.Provider>;
}

export function useFlotaMock(): FlotaMockContextValue {
  const ctx = useContext(FlotaMockContext);
  if (!ctx) {
    throw new Error('useFlotaMock debe usarse dentro de <FlotaMockProvider>');
  }
  return ctx;
}

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
  elegirAleatorios,
  elegirTipoInfraccion,
  estadoInicial,
  INTERVALO_TICK_MS,
  reducer,
  trufisSinInfraccionActiva,
} from './estado';
import type {
  EstadoFlotaMock,
  InfraccionMock,
  LineaMock,
  LineaMockId,
  ModoAplicacion,
  Severidad,
  TrufiMock,
} from './tipos';

/**
 * Provider + hook del mock de flota (Decisión 3 del plan). El reducer (`estado.ts`) es puro
 * a propósito — acá viven las ÚNICAS dos fuentes de no-determinismo del módulo:
 * `Math.random()` (qué trufis/qué tipo de infracción sortea `simularInfracciones`) y
 * `Date.now()`/`new Date()` (los timestamps de cada acción). Ambas se resuelven acá, antes
 * de dispatchear, para que el reducer siga siendo 100% testeable sin mockear nada global.
 */

interface FlotaMockContextValue {
  estado: EstadoFlotaMock;
  lineas: Record<LineaMockId, LineaMock>;
  trufis: TrufiMock[];
  catalogo: typeof CATALOGO_INFRACCIONES;
  simularInfracciones: (n: 1 | 2 | 3, severidad: Severidad | 'aleatoria') => void;
  limpiarInfracciones: () => void;
  asignarParada: (trufiId: string, paradaId: string) => void;
  aplicarAccion: (
    infraccionId: string,
    accionId: string,
    modo: ModoAplicacion,
    venceEl?: string,
  ) => void;
  togglePausa: () => void;
}

const FlotaMockContext = createContext<FlotaMockContextValue | null>(null);

export function FlotaMockProvider({ children }: { children: ReactNode }) {
  const [estado, dispatch] = useReducer(reducer, undefined, estadoInicial);

  useEffect(() => {
    if (estado.pausado) {
      return;
    }
    const id = setInterval(() => {
      dispatch({ type: 'tick' });
    }, INTERVALO_TICK_MS);
    return () => clearInterval(id);
  }, [estado.pausado]);

  // Depende de `estado` (no `[]`): necesita la lista de infracciones activas AL MOMENTO del
  // click para no elegir un trufi que ya tiene una (el reducer también lo filtra como
  // segunda defensa, pero acá es donde se decide QUÉ trufis entran al sorteo).
  const simularInfracciones = useCallback(
    (n: 1 | 2 | 3, severidad: Severidad | 'aleatoria') => {
      const disponibles = trufisSinInfraccionActiva(
        estado,
        TRUFIS_MOCK.map((t) => t.id),
      );
      const elegidos = elegirAleatorios(disponibles, n, Math.random);
      const ahora = new Date().toISOString();
      const infracciones: InfraccionMock[] = elegidos.map((trufiId) => {
        const tipo = elegirTipoInfraccion(severidad, Math.random);
        return {
          id: `inf-${trufiId}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
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

  const limpiarInfracciones = useCallback(() => {
    dispatch({ type: 'limpiar-infracciones' });
  }, []);

  const asignarParada = useCallback((trufiId: string, paradaId: string) => {
    dispatch({ type: 'asignar-parada', trufiId, paradaId });
  }, []);

  const aplicarAccion = useCallback(
    (infraccionId: string, accionId: string, modo: ModoAplicacion, venceEl?: string) => {
      dispatch({
        type: 'aplicar-accion',
        infraccionId,
        accionId,
        modo,
        aplicadaEn: new Date().toISOString(),
        venceEl,
      });
    },
    [],
  );

  const togglePausa = useCallback(() => {
    dispatch({ type: 'toggle-pausa' });
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
    }),
    [estado, simularInfracciones, limpiarInfracciones, asignarParada, aplicarAccion, togglePausa],
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

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  acercarAdelante,
  adelanteAtras,
  alternarVelocidad,
  colaDe,
  crearEstadoInicial,
  crearReporte,
  finalizarJornada,
  iniciarJornada,
  otrosVehiculos,
  perderSenal,
  posicionDe,
  proximaSalidaDe,
  recuperarSenal,
  reiniciar,
  saltarAlProximoPunto,
  tick,
  type EstadoMotorDemo,
  type PosicionDemo,
  type TipoReporteDemo,
  type VecinoDemo,
  type VehiculoMapaDemo,
} from './motor';

/**
 * Contexto del motor demo — arranca con `crearEstadoInicial` y lo avanza con un `setInterval`
 * de 1 s REAL (el propio `velocidadDemo` del estado, no este intervalo, es lo que hace ×1/×4:
 * ver `tick()` en `./motor.ts`). `useDemo()` es el único punto de lectura — las pantallas de
 * B/C nunca llaman a `tick`/`iniciarJornada`/etc. directo, solo a través de `acciones`.
 */

export interface AccionesDemo {
  iniciarJornada: () => void;
  finalizarJornada: () => void;
  perderSenal: () => void;
  recuperarSenal: () => void;
  alternarVelocidad: () => void;
  saltarAlProximoPunto: () => void;
  acercarAdelante: () => void;
  crearReporte: (entrada: { tipo: TipoReporteDemo; placaReportada?: string; nota?: string }) => void;
  reiniciar: () => void;
}

interface DemoContextValue {
  estado: EstadoMotorDemo;
  acciones: AccionesDemo;
}

const DemoContext = createContext<DemoContextValue | null>(null);

let contadorReporteDemo = 0;
/** Genera un id de reporte sin depender de `crypto.randomUUID()` (no disponible en todos los
 * runtimes de Hermes) — determinístico + timestamp alcanza, esto nunca se persiste ni se
 * compara contra nada externo. */
function generarIdReporteDemo(): string {
  contadorReporteDemo += 1;
  return `reporte-demo-${Date.now()}-${contadorReporteDemo}`;
}

export function DemoProvider({
  trufiPropioId,
  children,
}: {
  trufiPropioId: string;
  children: React.ReactNode;
}) {
  const [estado, setEstado] = useState<EstadoMotorDemo>(() => crearEstadoInicial(trufiPropioId, Date.now()));

  // Si cambia la unidad propia (cambio de conductor a otra placa jugable, poco común pero
  // posible si el login demo llega a soportarlo) reinicia el motor desde cero para esa unidad.
  useEffect(() => {
    setEstado((actual) =>
      actual.trufiPropioId === trufiPropioId ? actual : crearEstadoInicial(trufiPropioId, Date.now()),
    );
  }, [trufiPropioId]);

  useEffect(() => {
    const id = setInterval(() => {
      setEstado((actual) => tick(actual, Date.now()));
    }, 1_000);
    return () => clearInterval(id);
  }, []);

  const acciones = useMemo<AccionesDemo>(
    () => ({
      iniciarJornada: () => setEstado((actual) => iniciarJornada(actual, Date.now())),
      finalizarJornada: () => setEstado((actual) => finalizarJornada(actual, Date.now())),
      perderSenal: () => setEstado((actual) => perderSenal(actual)),
      recuperarSenal: () => setEstado((actual) => recuperarSenal(actual, Date.now())),
      alternarVelocidad: () => setEstado((actual) => alternarVelocidad(actual)),
      saltarAlProximoPunto: () => setEstado((actual) => saltarAlProximoPunto(actual)),
      acercarAdelante: () => setEstado((actual) => acercarAdelante(actual)),
      crearReporte: (entrada) =>
        setEstado((actual) => crearReporte(actual, entrada, Date.now(), generarIdReporteDemo())),
      reiniciar: () => setEstado((actual) => reiniciar(actual, Date.now())),
    }),
    [],
  );

  const value = useMemo<DemoContextValue>(() => ({ estado, acciones }), [estado, acciones]);

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export interface UseDemoResultado {
  estado: EstadoMotorDemo;
  acciones: AccionesDemo;
  /** `adelanteAtras(estado, trufiPropioId)` ya resuelto — ver `./motor.ts`. */
  adelanteAtras: { adelante?: VecinoDemo; atras?: VecinoDemo };
  /** Cola de salida de la línea propia (`colaDe(estado, lineaPropiaId)`). */
  colaPropia: string[];
  /** Posición/heading actual de la unidad propia — `null` antes de que el motor tenga un
   * `trufiPropioId` válido (no debería pasar dentro de un `DemoProvider` bien formado). */
  posicionPropia: PosicionDemo | null;
  /** epoch ms de la próxima salida programada de la unidad propia — `null` mientras no está
   * `en_cola` (ya está en ruta o finalizada). */
  proximaSalidaPropia: number | null;
  /** Unidades `en_ruta` de la línea propia (para los marcadores del mapa), sin la propia. */
  otrosVehiculosLineaPropia: VehiculoMapaDemo[];
}

export function useDemo(): UseDemoResultado {
  const ctx = useContext(DemoContext);
  if (!ctx) {
    throw new Error('useDemo debe usarse dentro de un <DemoProvider>');
  }
  const { estado, acciones } = ctx;
  const { trufiPropioId, lineaPropiaId } = estado;

  return useMemo(
    () => ({
      estado,
      acciones,
      adelanteAtras: adelanteAtras(estado, trufiPropioId),
      colaPropia: colaDe(estado, lineaPropiaId),
      posicionPropia: posicionDe(estado, trufiPropioId),
      proximaSalidaPropia: proximaSalidaDe(estado, trufiPropioId),
      otrosVehiculosLineaPropia: otrosVehiculos(estado, lineaPropiaId),
    }),
    [estado, acciones, trufiPropioId, lineaPropiaId],
  );
}

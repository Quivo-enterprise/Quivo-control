'use client';

import { Button, ConfirmDialog, Select } from '@quivo/design-system';
import {
  AlertTriangle,
  Car,
  ChevronDown,
  ChevronUp,
  Gauge,
  MessagesSquare,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  TrafficCone,
  Truck,
  WifiOff,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  colaDe,
  trufisEnRutaVisibles,
  trufisReportables,
  trufisSinInfraccionActiva,
  trufisSinSenalVisibles,
  useFlotaMock,
  type AccionResultado,
  type LineaMockId,
  type Severidad,
  type SubtipoReporteConductor,
} from '../../../../src/lib/mock-flota';

interface PanelSimulacionProps {
  /** Línea del filtro activo en el HUD (`undefined` = "Todas"). Con una línea puesta, el
   * panel opera SOLO sobre los trufis visibles de esa línea (Decisión CTO, 2026-09-27):
   * contador, disponibilidad de los botones "Infracción en N" y "Limpiar infracciones", y
   * TAMBIÉN el resto de los escenarios de esta ampliación. */
  lineaId?: LineaMockId;
  /** Trufi con la ficha abierta (`en-vivo-simulado.tsx`) — cuando un escenario es aplicable a
   * ESTE trufi, los botones lo targetean primero en vez de sortear uno al azar entre los
   * visibles (contrato del brief de C2: "scenario actions target the selected trufi when
   * eligible, else a random visible one"). */
  seleccionadoId?: string | null;
}

const SUBTIPOS_REPORTE: { value: SubtipoReporteConductor; label: string }[] = [
  { value: 'pinchazo', label: 'Pinchazo' },
  { value: 'control_policial', label: 'Control policial' },
  { value: 'bloqueo_via', label: 'Bloqueo de vía' },
  { value: 'falla_mecanica', label: 'Falla mecánica' },
  { value: 'incidente_pasajero', label: 'Incidente con pasajero' },
];

interface SeccionProps {
  id: string;
  titulo: string;
  icono: ReactNode;
  abierta: boolean;
  onToggle: () => void;
  children: ReactNode;
}

function Seccion({ titulo, icono, abierta, onToggle, children }: SeccionProps) {
  return (
    <div className="qv-sim-seccion">
      <button type="button" className="qv-sim-seccion__header" onClick={onToggle} aria-expanded={abierta}>
        <span className="qv-sim-seccion__title">
          {icono}
          {titulo}
        </span>
        <span className="qv-sim-seccion__chevron" aria-hidden="true">
          {abierta ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>
      {abierta && <div className="qv-sim-seccion__body">{children}</div>}
    </div>
  );
}

/**
 * Panel flotante de simulación (Decisión 10 del plan original, reorganizado en secciones
 * colapsables para la ampliación del guion delegado: Infracciones · Tráfico · Salidas ·
 * Conductor · Señal · Demo) — abajo a la izquierda, para no competir con la ficha del trufi
 * (arriba a la derecha, `trufi-panel.tsx`). En modo grabación arranca oculto y se
 * muestra/oculta con la tecla `S` (ver `en-vivo-simulado.tsx`).
 */
export function PanelSimulacion({ lineaId, seleccionadoId }: PanelSimulacionProps) {
  const {
    estado,
    trufis,
    simularInfracciones,
    limpiarInfracciones,
    togglePausa,
    simularAtasco,
    simularDesvio,
    simularFueraDeOrden,
    simularReporteConductor,
    perderSenal,
    recuperarSenal,
    alternarHoraPico,
    finalizarRecorrido,
    reiniciarDemo,
  } = useFlotaMock();
  const [abierto, setAbierto] = useState(true);
  // Ítem 11: "Reiniciar demo" pierde TODO el estado en vivo (infracciones, novedades, colas,
  // historial de recorridos armado) sin forma de deshacer — pide confirmación explícita antes
  // de ejecutar, con el `ConfirmDialog` del design-system (mismo patrón que el resto del repo,
  // ver p. ej. `app/(dashboard)/reglas/page.tsx`).
  const [confirmandoReinicio, setConfirmandoReinicio] = useState(false);
  const [severidad, setSeveridad] = useState<Severidad | 'aleatoria'>('aleatoria');
  const [subtipo, setSubtipo] = useState<SubtipoReporteConductor>('pinchazo');
  // Ítem 6 del guion de fixes: `simularDesvio` devuelve `AccionResultado` — con el trufi
  // elegido ya sancionado (infracción activa) hay que mostrar el `motivo` del fallo, no
  // "Aplicado a…" como si hubiera funcionado.
  const [aplicadoA, setAplicadoA] = useState<{ mensaje: string; ok: boolean } | null>(null);
  const [secciones, setSecciones] = useState({
    infracciones: true,
    trafico: true,
    salidas: false,
    conductor: false,
    senal: false,
    demo: false,
  });

  function toggleSeccion(key: keyof typeof secciones) {
    setSecciones((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const trufisVisibles = lineaId ? trufis.filter((t) => t.lineaId === lineaId) : trufis;
  const idsVisibles = new Set(trufisVisibles.map((t) => t.id));
  const activas = estado.infracciones.filter((i) => i.estado === 'activa' && idsVisibles.has(i.trufiId)).length;
  const hayInfraccionesVisibles = estado.infracciones.some((i) => idsVisibles.has(i.trufiId));
  const disponibles = trufisSinInfraccionActiva(estado, trufisVisibles.map((t) => t.id)).length;

  /** Elige el trufi objetivo de un escenario: el seleccionado en la ficha si es elegible (y
   * está dentro del filtro de línea), si no uno al azar entre los visibles que sí cumplen
   * `elegible`. Devuelve `undefined` si ninguno califica (el botón ya viene `disabled` en ese
   * caso, pero se revalida acá por si el estado cambió entre renders). */
  function elegirObjetivo(elegible: (trufiId: string) => boolean): string | undefined {
    if (seleccionadoId && idsVisibles.has(seleccionadoId) && elegible(seleccionadoId)) {
      return seleccionadoId;
    }
    const candidatos = trufisVisibles.filter((t) => elegible(t.id));
    if (candidatos.length === 0) return undefined;
    return candidatos[Math.floor(Math.random() * candidatos.length)]!.id;
  }

  function aplicar(accion: (trufiId?: string) => void | AccionResultado, elegible: (trufiId: string) => boolean) {
    const objetivo = elegirObjetivo(elegible);
    if (!objetivo) return;
    const resultado = accion(objetivo);
    const placa = trufis.find((t) => t.id === objetivo)?.placa ?? objetivo;
    // Solo `simularDesvio` devuelve `AccionResultado` hoy — el resto de las acciones de este
    // panel siguen siendo `void` y caen en la rama de éxito de siempre.
    if (resultado && typeof resultado === 'object' && 'ok' in resultado && !resultado.ok) {
      setAplicadoA({ mensaje: resultado.motivo, ok: false });
      return;
    }
    setAplicadoA({ mensaje: `Aplicado a ${placa}`, ok: true });
  }

  const enRutaIds = new Set(trufisEnRutaVisibles(estado, lineaId));
  const enRutaVisibles = trufisVisibles.filter((t) => enRutaIds.has(t.id));
  const sinSenalIds = new Set(trufisSinSenalVisibles(estado, lineaId));
  const sinSenalVisibles = trufisVisibles.filter((t) => sinSenalIds.has(t.id));
  const reportablesIds = new Set(trufisReportables(estado, lineaId));
  const reportablesVisibles = trufisVisibles.filter((t) => reportablesIds.has(t.id));

  // Fuera de orden: elegible = está en la cola de SU línea en una posición >= 1 (la cabeza,
  // posición 0, sería un despacho normal). Solo mira líneas dentro del filtro activo.
  const lineasDelFiltro: LineaMockId[] = lineaId ? [lineaId] : ['z12', 'l120'];
  function esFueraDeOrdenElegible(trufiId: string): boolean {
    const trufi = trufis.find((t) => t.id === trufiId);
    if (!trufi || !lineasDelFiltro.includes(trufi.lineaId)) return false;
    return colaDe(estado, trufi.lineaId).indexOf(trufiId) >= 1;
  }
  const hayFueraDeOrdenElegible = lineasDelFiltro.some((id) => colaDe(estado, id).length >= 2);

  return (
    <div className="qv-sim-panel">
      <button
        type="button"
        className="qv-sim-panel__header"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
      >
        <span className="qv-sim-panel__title">
          <Sparkles size={15} aria-hidden="true" />
          Simulación
          {activas > 0 && <span className="qv-sim-panel__count">{activas}</span>}
        </span>
        <span className="qv-sim-panel__chevron" aria-hidden="true">
          {abierto ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </span>
      </button>

      {abierto && (
        <div className="qv-sim-panel__body">
          <Seccion
            id="infracciones"
            titulo="Infracciones"
            icono={<AlertTriangle size={13} aria-hidden="true" />}
            abierta={secciones.infracciones}
            onToggle={() => toggleSeccion('infracciones')}
          >
            <Select
              label="Severidad"
              options={[
                { label: 'Aleatoria', value: 'aleatoria' },
                { label: 'Leve', value: 'leve' },
                { label: 'Media', value: 'media' },
                { label: 'Grave', value: 'grave' },
              ]}
              value={severidad}
              onChange={(e) => setSeveridad(e.target.value as Severidad | 'aleatoria')}
            />
            <div className="qv-sim-panel__buttons">
              {[1, 2, 3].map((n) => (
                <Button
                  key={n}
                  size="sm"
                  variant="secondary"
                  disabled={disponibles < n}
                  onClick={() => simularInfracciones(n as 1 | 2 | 3, severidad, lineaId)}
                >
                  Infracción en {n} trufi{n > 1 ? 's' : ''}
                </Button>
              ))}
            </div>
            <Button size="sm" variant="ghost" onClick={() => limpiarInfracciones(lineaId)} disabled={!hayInfraccionesVisibles}>
              Limpiar infracciones
            </Button>
            <span className="qv-trufi-panel__hint">
              {activas} {activas === 1 ? 'infracción activa' : 'infracciones activas'}
            </span>
          </Seccion>

          <Seccion
            id="trafico"
            titulo="Tráfico"
            icono={<TrafficCone size={13} aria-hidden="true" />}
            abierta={secciones.trafico}
            onToggle={() => toggleSeccion('trafico')}
          >
            <div className="qv-sim-panel__buttons">
              <Button size="sm" variant="secondary" disabled={enRutaVisibles.length === 0} onClick={() => aplicar(simularAtasco, (id) => enRutaIds.has(id))}>
                Atasco
              </Button>
              <Button size="sm" variant="secondary" disabled={enRutaVisibles.length === 0} onClick={() => aplicar(simularDesvio, (id) => enRutaIds.has(id))}>
                Desvío no autorizado
              </Button>
              <Button size="sm" variant={estado.horaPico ? 'primary' : 'secondary'} onClick={alternarHoraPico} aria-pressed={estado.horaPico}>
                <Gauge size={14} aria-hidden="true" /> Hora pico: {estado.horaPico ? 'activa' : 'inactiva'}
              </Button>
            </div>
          </Seccion>

          <Seccion
            id="salidas"
            titulo="Salidas"
            icono={<Truck size={13} aria-hidden="true" />}
            abierta={secciones.salidas}
            onToggle={() => toggleSeccion('salidas')}
          >
            <div className="qv-sim-panel__buttons">
              <Button size="sm" variant="secondary" disabled={!hayFueraDeOrdenElegible} onClick={() => aplicar(simularFueraDeOrden, esFueraDeOrdenElegible)}>
                Fuera de orden
              </Button>
              <Button size="sm" variant="secondary" disabled={enRutaVisibles.length === 0} onClick={() => aplicar(finalizarRecorrido, (id) => enRutaIds.has(id))}>
                Finalizar recorrido
              </Button>
            </div>
          </Seccion>

          <Seccion
            id="conductor"
            titulo="Conductor"
            icono={<MessagesSquare size={13} aria-hidden="true" />}
            abierta={secciones.conductor}
            onToggle={() => toggleSeccion('conductor')}
          >
            <Select
              label="Subtipo del reporte"
              options={SUBTIPOS_REPORTE}
              value={subtipo}
              onChange={(e) => setSubtipo(e.target.value as SubtipoReporteConductor)}
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={reportablesVisibles.length === 0}
              onClick={() => {
                const objetivo = elegirObjetivo((id) => reportablesIds.has(id));
                if (!objetivo) return;
                simularReporteConductor(subtipo, objetivo);
                const placa = trufis.find((t) => t.id === objetivo)?.placa ?? objetivo;
                setAplicadoA({ mensaje: `Aplicado a ${placa}`, ok: true });
              }}
            >
              <Car size={14} aria-hidden="true" /> Reporte del conductor
            </Button>
          </Seccion>

          <Seccion
            id="senal"
            titulo="Señal"
            icono={<WifiOff size={13} aria-hidden="true" />}
            abierta={secciones.senal}
            onToggle={() => toggleSeccion('senal')}
          >
            <div className="qv-sim-panel__buttons">
              <Button size="sm" variant="secondary" disabled={enRutaVisibles.length === 0} onClick={() => aplicar(perderSenal, (id) => enRutaIds.has(id))}>
                Perder señal
              </Button>
              <Button size="sm" variant="secondary" disabled={sinSenalVisibles.length === 0} onClick={() => aplicar(recuperarSenal, (id) => sinSenalIds.has(id))}>
                Recuperar señal
              </Button>
            </div>
          </Seccion>

          <Seccion
            id="demo"
            titulo="Demo"
            icono={<RotateCcw size={13} aria-hidden="true" />}
            abierta={secciones.demo}
            onToggle={() => toggleSeccion('demo')}
          >
            <div className="qv-sim-panel__actions-row">
              <Button size="sm" variant="secondary" onClick={togglePausa}>
                {estado.pausado ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
                {estado.pausado ? 'Reanudar' : 'Pausar'}
              </Button>
            </div>
            <div className="qv-sim-panel__actions-row">
              <Button size="sm" variant="ghost" onClick={() => setConfirmandoReinicio(true)}>
                <RotateCcw size={14} aria-hidden="true" /> Reiniciar demo
              </Button>
            </div>
          </Seccion>

          <div
            aria-live="polite"
            className={`qv-sim-panel__aplicado ${aplicadoA && !aplicadoA.ok ? 'qv-sim-panel__aplicado--error' : ''}`}
          >
            {aplicadoA?.mensaje}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmandoReinicio}
        title="Reiniciar demo"
        message="Se pierde todo el estado en vivo (infracciones, novedades, colas, recorridos armados) y vuelve al escenario inicial. No se puede deshacer."
        variant="danger"
        confirmLabel="Reiniciar"
        onConfirm={() => {
          reiniciarDemo();
          setConfirmandoReinicio(false);
        }}
        onCancel={() => setConfirmandoReinicio(false)}
      />
    </div>
  );
}

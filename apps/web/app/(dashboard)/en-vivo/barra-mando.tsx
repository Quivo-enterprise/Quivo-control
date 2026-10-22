'use client';

import type { RefObject } from 'react';
import Link from 'next/link';
import { Select, type SelectOption } from '@quivo/design-system';
import type { GravedadRegla, Linea } from '@quivo/shared';
import { ArrowLeft, BellRing, CircleCheck, Clock, History, ListFilter, LogOut, Radio, WifiOff } from 'lucide-react';
import { ETIQUETA_NIVEL, NIVELES_DESC } from '../../../src/lib/en-vivo/alertas';
import { useSaludRefresco, type SaludRefresco } from '../../../src/lib/en-vivo/use-salud-refresco';
import { IconoNivel } from './panel-vehiculo';

/** Hasta este número de líneas el filtro es un segmento; con más, un `Select` (no cabría en la barra). */
const MAX_LINEAS_SEGMENTO = 4;

const SALUD: Record<SaludRefresco['estado'], { texto: string; Icono: typeof Radio }> = {
  ok: { texto: 'En vivo', Icono: Radio },
  lento: { texto: 'Actualización lenta', Icono: Clock },
  sin_conexion: { texto: 'Sin conexión', Icono: WifiOff },
};

/** Hoja: el tick de 1 Hz de `useSaludRefresco` re-renderiza solo esto, nunca el mapa. */
function SaludRefrescoVista({ consulta }: { consulta: { dataUpdatedAt: number; isError: boolean } }) {
  const salud = useSaludRefresco(consulta);
  const { texto, Icono } = SALUD[salud.estado];
  return (
    <div className={`qv-live-salud qv-live-salud--${salud.estado}`}>
      <Icono size={14} aria-hidden="true" />
      {/* Solo el estado va en la región viva: los segundos cambian cada 1 s y spamearían al lector. */}
      <span role="status">{texto}</span>
      <span className="qv-live-salud__seg">· hace {salud.segundos}&nbsp;s</span>
    </div>
  );
}

interface BarraMandoProps {
  consulta: { dataUpdatedAt: number; isError: boolean };
  /** Con panel admin la salida es "Panel"; sin él (operador) es "Salir" (cierra sesión). */
  tienePanelAdmin: boolean;
  puedeVerDias: boolean;
  onSalir: () => void;
  lineas: Linea[];
  lineaOptions: SelectOption[];
  lineaFilter: string;
  onLinea: (id: string) => void;
  conteoNiveles: Record<GravedadRegla, number>;
  nivelFiltro: GravedadRegla | null;
  onNivel: (nivel: GravedadRegla | null) => void;
  alertasPendientes: number;
  resumenAlertas: string;
  siguienteAlertaRef: RefObject<HTMLButtonElement>;
  onSiguienteAlerta: () => void;
  flotaAbierta: boolean;
  onToggleFlota: () => void;
}

export function BarraMando(p: BarraMandoProps) {
  const sinInfracciones = NIVELES_DESC.every((n) => p.conteoNiveles[n] === 0) && !p.nivelFiltro;
  return (
    <header className="qv-live-barra" aria-label="Barra de mando de En vivo">
      <div className="qv-live-barra__fila">
        <button
          type="button"
          className="qv-live-btn"
          onClick={p.onSalir}
          title={p.tienePanelAdmin ? 'Volver al panel administrativo' : 'Cerrar sesión'}
        >
          {p.tienePanelAdmin ? <ArrowLeft size={14} aria-hidden="true" /> : <LogOut size={14} aria-hidden="true" />}
          {p.tienePanelAdmin ? 'Panel' : 'Salir'}
        </button>
        <h1 className="qv-live-barra__titulo">En vivo</h1>
        <SaludRefrescoVista consulta={p.consulta} />
        <span className="qv-live-barra__espacio" />
        {p.puedeVerDias && (
          <Link className="qv-live-btn" href="/reportes/recorridos" aria-label="Días anteriores" title="Días anteriores">
            <History size={14} aria-hidden="true" />
            <span className="qv-live-barra__dias-texto">Días anteriores</span>
          </Link>
        )}
        {/* Solo < 1024 px: el panel de flota es una hoja que se abre a pedido. */}
        <button
          type="button"
          className="qv-live-btn qv-live-barra__flota"
          aria-pressed={p.flotaAbierta}
          aria-controls="qv-live-flota"
          onClick={p.onToggleFlota}
        >
          <ListFilter size={14} aria-hidden="true" />
          Flota
        </button>
      </div>

      <div className="qv-live-barra__fila">
        {p.lineas.length <= MAX_LINEAS_SEGMENTO ? (
          <div className="qv-live-segmento" role="group" aria-label="Filtrar por línea">
            {[{ id: '', nombre: 'Todas', color: null as string | null }, ...p.lineas.map((l) => ({
              id: l.id,
              nombre: l.nombreCorto || `Línea ${l.codigo}`,
              color: l.color ?? null,
            }))].map((l) => (
              <button
                key={l.id || 'todas'}
                type="button"
                className="qv-live-segmento__op"
                aria-pressed={p.lineaFilter === l.id}
                onClick={() => p.onLinea(l.id)}
              >
                {l.color && <i className="qv-live-linea-punto" style={{ '--qv-linea': l.color } as React.CSSProperties} aria-hidden="true" />}
                {l.nombre}
              </button>
            ))}
          </div>
        ) : (
          <div className="qv-live-barra__select">
            <Select
              aria-label="Filtrar por línea"
              options={[{ label: 'Todas las líneas', value: '' }, ...p.lineaOptions]}
              placeholder="Todas las líneas"
              value={p.lineaFilter}
              onChange={(e) => p.onLinea(e.target.value)}
            />
          </div>
        )}

        {/* Contadores por nivel (cada uno filtra "solo con alertas de ese nivel"). El color nunca va
        solo: cada nivel lleva su ícono y su texto. */}
        <div className="qv-live-alertas" role="group" aria-label="Alertas por infracción">
          {sinInfracciones ? (
            <span className="qv-live-alertas__vacio">
              <CircleCheck size={14} aria-hidden="true" />
              Sin infracciones abiertas
            </span>
          ) : (
            NIVELES_DESC.map((nivel) => {
              const n = p.conteoNiveles[nivel];
              const activo = p.nivelFiltro === nivel;
              const etiqueta = ETIQUETA_NIVEL[nivel];
              return (
                <button
                  key={nivel}
                  type="button"
                  className={`qv-live-nivel qv-live-nivel--${nivel}`}
                  aria-pressed={activo}
                  disabled={n === 0 && !activo}
                  title={`Mostrar solo vehículos con alertas ${etiqueta.plural}`}
                  aria-label={`${n} ${n === 1 ? etiqueta.singular : etiqueta.plural}: solo con alertas de este nivel`}
                  onClick={() => p.onNivel(activo ? null : nivel)}
                >
                  <IconoNivel nivel={nivel} />
                  <span aria-hidden="true">
                    {n} {n === 1 ? etiqueta.singular : etiqueta.plural}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <button
          ref={p.siguienteAlertaRef}
          type="button"
          className="qv-live-btn qv-live-btn--primario"
          disabled={p.alertasPendientes === 0}
          onClick={p.onSiguienteAlerta}
          title={p.alertasPendientes > 0 ? `Ir a la siguiente alerta (${p.resumenAlertas})` : undefined}
        >
          <BellRing size={14} aria-hidden="true" />
          Siguiente alerta
        </button>
      </div>
    </header>
  );
}

'use client';

import { Button, Select } from '@quivo/design-system';
import { ChevronDown, ChevronUp, Pause, Play, Sparkles } from 'lucide-react';
import { useState } from 'react';
import {
  trufisSinInfraccionActiva,
  useFlotaMock,
  type LineaMockId,
  type Severidad,
} from '../../../../src/lib/mock-flota';

interface PanelSimulacionProps {
  /** Línea del filtro activo en el HUD (`undefined` = "Todas"). Con una línea puesta, el
   * panel opera SOLO sobre los trufis visibles de esa línea (Decisión CTO, 2026-09-27):
   * contador, disponibilidad de los botones "Infracción en N" y "Limpiar infracciones". */
  lineaId?: LineaMockId;
}

/**
 * Panel flotante de simulación (Decisión 10 del plan) — abajo a la izquierda, para no
 * competir con la ficha del trufi (arriba a la derecha, `trufi-panel.tsx`).
 */
export function PanelSimulacion({ lineaId }: PanelSimulacionProps) {
  const { estado, trufis, simularInfracciones, limpiarInfracciones, togglePausa } = useFlotaMock();
  const [abierto, setAbierto] = useState(true);
  const [severidad, setSeveridad] = useState<Severidad | 'aleatoria'>('aleatoria');

  const trufisVisibles = lineaId ? trufis.filter((t) => t.lineaId === lineaId) : trufis;
  const idsVisibles = new Set(trufisVisibles.map((t) => t.id));
  const activas = estado.infracciones.filter((i) => i.estado === 'activa' && idsVisibles.has(i.trufiId)).length;
  const hayInfraccionesVisibles = estado.infracciones.some((i) => idsVisibles.has(i.trufiId));
  const disponibles = trufisSinInfraccionActiva(estado, trufisVisibles.map((t) => t.id)).length;

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

          <div className="qv-sim-panel__actions-row">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => limpiarInfracciones(lineaId)}
              disabled={!hayInfraccionesVisibles}
            >
              Limpiar infracciones
            </Button>
          </div>

          <div className="qv-sim-panel__actions-row">
            <Button size="sm" variant="secondary" onClick={togglePausa}>
              {estado.pausado ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
              {estado.pausado ? 'Reanudar' : 'Pausar'}
            </Button>
          </div>

          <span className="qv-trufi-panel__hint">
            {activas} {activas === 1 ? 'infracción activa' : 'infracciones activas'}
          </span>
        </div>
      )}
    </div>
  );
}

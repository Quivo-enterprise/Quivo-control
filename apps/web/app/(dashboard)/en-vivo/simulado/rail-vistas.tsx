'use client';

import { AlertCircle, BarChart3, Map as MapIcon, Settings2, Truck } from 'lucide-react';
import { novedadesAbiertas, type EstadoFlotaMock, type LineaMockId } from '../../../../src/lib/mock-flota';

export type VistaId = 'mapa' | 'salidas' | 'novedades' | 'analisis' | 'configuracion';

interface RailVistasProps {
  vistaActiva: VistaId;
  onCambiarVista: (vista: VistaId) => void;
  estado: EstadoFlotaMock;
  lineaId: LineaMockId | null;
}

const ITEMS: { id: VistaId; label: string; icon: typeof MapIcon }[] = [
  { id: 'mapa', label: 'Mapa', icon: MapIcon },
  { id: 'salidas', label: 'Salidas', icon: Truck },
  { id: 'novedades', label: 'Novedades', icon: AlertCircle },
  { id: 'analisis', label: 'Análisis', icon: BarChart3 },
  { id: 'configuracion', label: 'Configuración', icon: Settings2 },
];

/**
 * Rail de vistas del HUD superior izquierdo (arquitectura del plan: "un rail de vistas... Mapa
 * · Salidas · Novedades (con badge) · Análisis · Configuración"). Una sola vista abierta a la
 * vez — "Mapa" representa NINGUNA vista abierta (`vistaActiva === 'mapa'`), así que su botón es
 * el único sin panel asociado en `en-vivo-simulado.tsx`.
 */
export function RailVistas({ vistaActiva, onCambiarVista, estado, lineaId }: RailVistasProps) {
  const badge = novedadesAbiertas(estado, lineaId ?? undefined).length;
  return (
    <div className="qv-rail-vistas" role="group" aria-label="Vistas del panel">
      {ITEMS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className={`qv-rail-vistas__btn ${vistaActiva === id ? 'qv-rail-vistas__btn--active' : ''}`}
          aria-pressed={vistaActiva === id}
          aria-current={vistaActiva === id ? 'true' : undefined}
          // Ítem 11: el badge visual es `aria-hidden` (es puramente decorativo, un número suelto
          // al lado del ícono) — sin esto un lector de pantalla solo anunciaba "Novedades", sin
          // el conteo que sí ve un usuario vidente.
          aria-label={id === 'novedades' && badge > 0 ? `${label}, ${badge} abiertas` : undefined}
          onClick={() => onCambiarVista(id)}
        >
          <Icon size={14} aria-hidden="true" />
          {label}
          {id === 'novedades' && badge > 0 && (
            <span className="qv-rail-vistas__badge" aria-hidden="true">
              {badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

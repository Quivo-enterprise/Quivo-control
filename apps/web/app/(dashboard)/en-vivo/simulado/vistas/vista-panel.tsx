'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { LineaMockId } from '../../../../../src/lib/mock-flota';
import { useCierraConEscape } from '../panel-escape';
import './vistas.css';

/**
 * Contrato compartido de props de las 4 vistas grandes (Salidas/Análisis/Configuración/
 * Novedades — esta última la implementa C2, ver `docs/plan-mock-guion-delegado.md`). Vive acá
 * (no en un archivo aparte) porque `vista-panel.tsx` ya es el único archivo que las 3 vistas de
 * este subagente importan en común — evita un archivo extra fuera de la lista de propiedad del
 * plan.
 */
export interface VistaProps {
  /** Línea del filtro activo del HUD — `null` = "Todas". */
  lineaId: LineaMockId | null;
  onSeleccionarTrufi: (trufiId: string) => void;
  onCerrar: () => void;
}

/**
 * Cascarón compartido de las vistas grandes del panel del delegado (Salidas, Análisis,
 * Configuración, Novedades — ver `docs/plan-mock-guion-delegado.md`). Vive a la izquierda del
 * mapa, debajo del HUD superior (`.qv-top-hud`, ~110px de alto), con el mismo lenguaje "vidrio
 * flotante" que `.qv-trufi-panel` (`../trufi-panel.tsx`) pero anclado al costado opuesto para
 * no competir con la ficha del trufi (arriba a la derecha).
 *
 * `role="dialog"` NO bloqueante (`aria-modal={false}`, mismo criterio que `TrufiPanel`): el
 * mapa sigue visible y operable detrás. El manejo de foco/Escape replica exactamente el patrón
 * ya validado en `trufi-panel.tsx` — mismo guard para no robarle Escape a un `<Select>`/listbox
 * hijo abierto.
 */

export interface VistaPanelProps {
  titulo: string;
  icono?: ReactNode;
  onCerrar: () => void;
  children: ReactNode;
  /** `'normal'` (34rem) para Configuración; `'ancho'` (46rem) para Salidas/Análisis, que
   * necesitan más espacio horizontal (línea de tiempo 24h, gráfico de barras). */
  ancho?: 'normal' | 'ancho';
}

export function VistaPanel({ titulo, icono, onCerrar, children, ancho = 'normal' }: VistaPanelProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Foco al abrir (WAI-ARIA Authoring Practices para `role="dialog"`) — mismo patrón que
  // `trufi-panel.tsx`: mueve el foco al encabezado (`tabIndex=-1`) para que un lector de
  // pantalla anuncie de inmediato la vista que se acaba de abrir.
  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    headingRef.current?.focus();
  }, []);

  // Al desmontar (cierre de la vista), devuelve el foco al control que la abrió (el botón del
  // rail de vistas), si todavía existe en el DOM.
  useEffect(
    () => () => {
      previousFocusRef.current?.focus?.();
    },
    [],
  );

  // Escape cierra la vista — salvo que ya lo haya consumido un control hijo: el trigger de
  // `Select` llama `preventDefault()` en Escape cuando está abierto (design-system, `form.tsx`),
  // y cualquier listbox portado en `document.body` (fuera de `panelRef`) también debe
  // consumirlo primero. Sin este guard, Escape con un `Select` abierto dentro de la vista
  // cerraría el dropdown Y la vista completa de un solo golpe de tecla.
  //
  // `useCierraConEscape` (ítem 8, `../panel-escape.ts`): coordina con `TrufiPanel` para que, con
  // los DOS paneles abiertos a la vez, un solo Escape cierre solo el de encima.
  useCierraConEscape(panelRef, { activo: true, onCerrar });

  return (
    <div
      className={`qv-vista-panel ${ancho === 'ancho' ? 'qv-vista-panel--ancho' : ''}`}
      role="dialog"
      aria-labelledby={titleId}
      aria-modal={false}
      ref={panelRef}
    >
      <div className="qv-vista-panel__header">
        {icono && (
          <span className="qv-vista-panel__icon" aria-hidden="true">
            {icono}
          </span>
        )}
        <h2 className="qv-vista-panel__title" id={titleId} ref={headingRef} tabIndex={-1}>
          {titulo}
        </h2>
        <button type="button" className="qv-vista-panel__close" onClick={onCerrar} aria-label={`Cerrar ${titulo}`}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="qv-vista-panel__body">{children}</div>
    </div>
  );
}

'use client';

import { AlertOctagon, AlertTriangle, TriangleAlert } from 'lucide-react';
import type { CSSProperties } from 'react';
import { SEVERIDAD_META, type InfraccionMock, type LineaMock, type TrufiMock } from '../../../../src/lib/mock-flota';

/**
 * Marcador de un trufi sobre el mapa (Decisiones 6/7 del plan): foto redonda con marco del
 * color de línea, que parpadea entre ese color y el de la severidad mientras haya una
 * infracción ACTIVA (nunca con una ya sancionada — dejar de parpadear es la señal visual de
 * que se resolvió). Vive dentro de un `overlayMarkers.content` de `RouteMap` — es un
 * `<button>` real, no una feature GeoJSON, así que el click no compite con `onMapClick`.
 */

interface TrufiMarcadorProps {
  trufi: TrufiMock;
  linea: LineaMock;
  infraccionActiva: InfraccionMock | undefined;
  seleccionado: boolean;
  onClick: () => void;
}

const ICONO_SEVERIDAD = {
  leve: TriangleAlert,
  media: AlertTriangle,
  grave: AlertOctagon,
} as const;

export function TrufiMarcador({ trufi, linea, infraccionActiva, seleccionado, onClick }: TrufiMarcadorProps) {
  const severidad = infraccionActiva?.severidad;
  const meta = severidad ? SEVERIDAD_META[severidad] : undefined;
  const IconoSeveridad = severidad ? ICONO_SEVERIDAD[severidad] : undefined;

  const style: CSSProperties & Record<string, string> = {
    '--qv-marker-line-color': linea.color,
  };
  if (meta) {
    style['--qv-marker-severity-color'] = meta.color;
    style['--qv-blink-duration'] = `${meta.periodoParpadeoMs}ms`;
  }

  const etiquetaInfraccion = meta ? `, infracción ${meta.etiqueta.toLowerCase()}` : '';
  // `linea.nombre` a veces ya viene con el prefijo "Línea " (ej. "Línea 120") y a veces no
  // (ej. "Z12") — antepone "Línea " solo cuando hace falta, para no leer "línea Línea 120".
  const nombreLinea = /^línea\s/i.test(linea.nombre) ? linea.nombre : `Línea ${linea.nombre}`;
  const ariaLabel = `Trufi ${trufi.placa}, ${nombreLinea}${etiquetaInfraccion}`;

  return (
    <button
      type="button"
      className={[
        'qv-trufi-marker',
        infraccionActiva ? 'qv-trufi-marker--blink' : '',
        seleccionado ? 'qv-trufi-marker--selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
      onClick={(event) => {
        // El `el` que envuelve este botón (el `<div>` del `maplibregl.Marker`, ver
        // `route-map-impl.tsx`) hace `preventDefault()` en `mousedown` para no competir con
        // el paneo/drag del mapa — eso también suprime el foco automático del navegador al
        // hacer click en un botón. Se fuerza el foco a mano para que `TrufiPanel` pueda
        // capturarlo como "elemento a devolver el foco" al cerrarse (ver su `previousFocusRef`).
        event.currentTarget.focus();
        onClick();
      }}
      aria-label={ariaLabel}
      aria-pressed={seleccionado}
    >
      <span className="qv-trufi-marker__ring">
        <img
          className="qv-trufi-marker__photo"
          src={trufi.fotoUrl}
          alt=""
          width={48}
          height={48}
          draggable={false}
        />
      </span>
      {meta && IconoSeveridad && (
        <span className="qv-trufi-marker__badge" aria-hidden="true">
          <IconoSeveridad size={12} strokeWidth={2.5} />
        </span>
      )}
    </button>
  );
}

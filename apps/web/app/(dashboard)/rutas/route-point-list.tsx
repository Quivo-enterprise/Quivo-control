'use client';

import { Tooltip, type MapPoint } from '@quivo/design-system';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { eliminarPuntoTrazado, moverPuntoTrazado } from './route-utils';

interface RoutePointListProps {
  points: MapPoint[];
  selectedIndex: number | null;
  onChange: (points: MapPoint[]) => void;
  onSelect: (index: number) => void;
}

export function RoutePointList({
  points,
  selectedIndex,
  onChange,
  onSelect,
}: RoutePointListProps) {
  return (
    <section className="routes-point-editor" aria-labelledby="routes-point-editor-title">
      <div className="routes-point-editor__header">
        <span>
          <strong id="routes-point-editor-title" style={{ fontSize: '0.875rem', color: 'var(--qv-text-primary)' }}>
            Nodos del trazado ({points.length})
          </strong>
          <small style={{ display: 'block', fontSize: '0.72rem', color: 'var(--qv-text-secondary)' }}>
            Selecciona un nodo para moverlo en el mapa o usa las herramientas para reordenar.
          </small>
        </span>
      </div>

      {points.length === 0 ? (
        <div
          style={{
            padding: '0.75rem',
            textAlign: 'center',
            fontSize: '0.78rem',
            color: 'var(--qv-text-muted)',
            backgroundColor: 'var(--qv-surface-sunken)',
            borderRadius: 'var(--qv-radius-md)',
          }}
        >
          Haz clic en el mapa para agregar el primer nodo.
        </div>
      ) : (
        <ol className="routes-point-list" style={{ maxHeight: '16rem', overflowY: 'auto' }}>
          {points.map((point, index) => (
            <li
              key={`${point.lat}-${point.lng}-${index}`}
              className={`routes-point-item${selectedIndex === index ? ' routes-point-item--active' : ''}`}
            >
              <button
                type="button"
                className="routes-point-item__locator"
                aria-pressed={selectedIndex === index}
                aria-label={`Ubicar y mover nodo ${index + 1}`}
                onClick={() => onSelect(index)}
              >
                <span className="routes-point-item__sequence" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="routes-point-item__copy">
                  <strong>
                    {index === 0
                      ? 'Inicio'
                      : index === points.length - 1
                        ? 'Final'
                        : `Nodo ${index + 1}`}
                  </strong>
                  <small>
                    {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
                  </small>
                </span>
              </button>

              {/* Cápsula de Herramientas del Nodo */}
              <div className="qv-table-actions-capsule">
                <Tooltip content="Mover nodo arriba">
                  <button
                    type="button"
                    className="qv-action-pill-btn"
                    disabled={index === 0}
                    onClick={() => onChange(moverPuntoTrazado(points, index, index - 1))}
                    aria-label={`Mover nodo ${index + 1} hacia arriba`}
                  >
                    <ArrowUp size={13} />
                  </button>
                </Tooltip>
                <Tooltip content="Mover nodo abajo">
                  <button
                    type="button"
                    className="qv-action-pill-btn"
                    disabled={index === points.length - 1}
                    onClick={() => onChange(moverPuntoTrazado(points, index, index + 1))}
                    aria-label={`Mover nodo ${index + 1} hacia abajo`}
                  >
                    <ArrowDown size={13} />
                  </button>
                </Tooltip>
                <span className="qv-action-pill-divider" />
                <Tooltip content="Eliminar nodo">
                  <button
                    type="button"
                    className="qv-action-pill-btn qv-action-pill-btn--danger"
                    onClick={() => onChange(eliminarPuntoTrazado(points, index))}
                    aria-label={`Quitar nodo ${index + 1}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </Tooltip>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

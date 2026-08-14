'use client';

import { Button, type MapPoint } from '@quivo/design-system';
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
          <strong id="routes-point-editor-title">Nodos del recorrido</strong>
          <small>Corrige el orden o quita un punto antes de guardar.</small>
        </span>
      </div>

      {points.length === 0 ? (
        <div className="routes-point-editor__empty">
          Haz clic en el mapa para agregar el primer nodo.
        </div>
      ) : (
        <ol className="routes-point-list">
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
                    {point.lat.toFixed(6)}, {point.lng.toFixed(6)}
                  </small>
                </span>
              </button>
              <span className="routes-point-item__actions">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Mover nodo ${index + 1} hacia arriba`}
                  title="Mover hacia arriba"
                  disabled={index === 0}
                  onClick={() => onChange(moverPuntoTrazado(points, index, index - 1))}
                >
                  ↑
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Mover nodo ${index + 1} hacia abajo`}
                  title="Mover hacia abajo"
                  disabled={index === points.length - 1}
                  onClick={() => onChange(moverPuntoTrazado(points, index, index + 1))}
                >
                  ↓
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Quitar nodo ${index + 1}`}
                  onClick={() => onChange(eliminarPuntoTrazado(points, index))}
                >
                  Quitar
                </Button>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

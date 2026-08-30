import { Button, Input, Loader, Tag, Tooltip } from '@quivo/design-system';
import type { Parada, PuntoControl, Variante } from '@quivo/shared';
import {
  GitBranch,
  MapPin,
  Pencil,
  Plus,
  RotateCcw,
  Target,
  Trash2,
} from 'lucide-react';
import { capitalizar } from './route-utils';

/**
 * Tarjeta de detalle de paradas de una ruta con cápsula de herramientas unificada y alta legibilidad.
 */
export function ParadasCard({
  paradas,
  loadingDetalle,
  cambiandoEstado,
  onAgregar,
  onEditar,
  onReactivar,
  onEliminar,
}: {
  paradas: Parada[];
  loadingDetalle: boolean;
  cambiandoEstado: boolean;
  onAgregar: () => void;
  onEditar: (parada: Parada) => void;
  onReactivar: (id: string) => void;
  onEliminar: (id: string) => void;
}) {
  const paradasOrdenadas = paradas.slice().sort((a, b) => a.orden - b.orden);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.65rem',
        padding: '0.85rem',
        borderRadius: 'var(--qv-radius-lg)',
        backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 75%, transparent)',
        border: '1px solid var(--qv-border-glass)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <MapPin size={16} style={{ color: 'var(--qv-color-primary)' }} />
          <strong style={{ fontSize: '0.875rem', color: 'var(--qv-text-primary)' }}>
            Paradas ({paradas.length})
          </strong>
        </div>
        <Button size="sm" variant="ghost" onClick={onAgregar}>
          <Plus size={13} style={{ marginRight: '0.25rem' }} /> Parada
        </Button>
      </div>

      {loadingDetalle ? (
        <Loader label="Cargando paradas..." />
      ) : paradasOrdenadas.length === 0 ? (
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
          Sin paradas registradas en esta ruta.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', maxHeight: '18rem', overflowY: 'auto' }}>
          {paradasOrdenadas.map((p) => {
            const esOrigen = p.tipo === 'origen';
            const esDestino = p.tipo === 'destino';
            const badgeColor = esOrigen ? '#10b981' : esDestino ? '#ef4444' : 'var(--qv-color-primary)';

            return (
              <div
                key={p.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.5rem',
                  padding: '0.5rem 0.65rem',
                  borderRadius: 'var(--qv-radius-md)',
                  backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 85%, transparent)',
                  border: '1px solid var(--qv-border-glass)',
                  opacity: p.estado === 'inactivo' ? 0.6 : 1,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                  <span
                    style={{
                      width: '0.625rem',
                      height: '0.625rem',
                      borderRadius: '50%',
                      backgroundColor: badgeColor,
                      boxShadow: `0 0 6px ${badgeColor}`,
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <strong style={{ fontSize: '0.8125rem', color: 'var(--qv-text-primary)' }}>
                        #{p.orden} · {capitalizar(p.tipo)}
                      </strong>
                      {p.estado === 'inactivo' && (
                        <span style={{ fontSize: '0.65rem', color: 'var(--qv-color-danger)', fontWeight: 700 }}>
                          (Inactiva)
                        </span>
                      )}
                    </div>
                    <small
                      style={{
                        fontSize: '0.7rem',
                        color: 'var(--qv-text-secondary)',
                        fontFamily: 'monospace',
                      }}
                    >
                      {p.coord.coordinates[1].toFixed(5)}, {p.coord.coordinates[0].toFixed(5)}
                    </small>
                  </div>
                </div>

                {/* Cápsula de Herramientas */}
                <div className="qv-table-actions-capsule">
                  <Tooltip content="Editar posición de parada">
                    <button
                      type="button"
                      className="qv-action-pill-btn"
                      onClick={() => onEditar(p)}
                      aria-label="Editar parada"
                    >
                      <Pencil size={13} />
                    </button>
                  </Tooltip>
                  <span className="qv-action-pill-divider" />
                  {p.estado === 'inactivo' ? (
                    <Tooltip content="Reactivar parada">
                      <button
                        type="button"
                        className="qv-action-pill-btn"
                        disabled={cambiandoEstado}
                        onClick={() => onReactivar(p.id)}
                        aria-label="Reactivar parada"
                      >
                        <RotateCcw size={13} />
                      </button>
                    </Tooltip>
                  ) : (
                    <Tooltip content="Eliminar parada">
                      <button
                        type="button"
                        className="qv-action-pill-btn qv-action-pill-btn--danger"
                        disabled={cambiandoEstado}
                        onClick={() => onEliminar(p.id)}
                        aria-label="Eliminar parada"
                      >
                        <Trash2 size={13} />
                      </button>
                    </Tooltip>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Tarjeta de detalle de puntos de control con radios de tolerancia y cápsula de herramientas.
 */
export function PuntosControlCard({
  puntosControl,
  loadingDetalle,
  cambiandoEstado,
  onAgregar,
  onEditar,
  onReactivar,
  onEliminar,
}: {
  puntosControl: PuntoControl[];
  loadingDetalle: boolean;
  cambiandoEstado: boolean;
  onAgregar: () => void;
  onEditar: (puntoControl: PuntoControl) => void;
  onReactivar: (id: string) => void;
  onEliminar: (id: string) => void;
}) {
  const puntosOrdenados = puntosControl.slice().sort((a, b) => a.orden - b.orden);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.65rem',
        padding: '0.85rem',
        borderRadius: 'var(--qv-radius-lg)',
        backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 75%, transparent)',
        border: '1px solid var(--qv-border-glass)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <Target size={16} style={{ color: 'var(--qv-color-accent)' }} />
          <strong style={{ fontSize: '0.875rem', color: 'var(--qv-text-primary)' }}>
            Puntos de Control ({puntosControl.length})
          </strong>
        </div>
        <Button size="sm" variant="ghost" onClick={onAgregar}>
          <Plus size={13} style={{ marginRight: '0.25rem' }} /> Control
        </Button>
      </div>

      {loadingDetalle ? (
        <Loader label="Cargando puntos de control..." />
      ) : puntosOrdenados.length === 0 ? (
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
          Sin puntos de control asignados.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', maxHeight: '18rem', overflowY: 'auto' }}>
          {puntosOrdenados.map((pc) => (
            <div
              key={pc.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.5rem',
                padding: '0.5rem 0.65rem',
                borderRadius: 'var(--qv-radius-md)',
                backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 85%, transparent)',
                border: '1px solid var(--qv-border-glass)',
                opacity: pc.estado === 'inactivo' ? 0.6 : 1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                <span
                  style={{
                    width: '0.625rem',
                    height: '0.625rem',
                    borderRadius: '50%',
                    backgroundColor: 'var(--qv-color-accent)',
                    boxShadow: '0 0 6px var(--qv-color-accent)',
                    flexShrink: 0,
                  }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <strong style={{ fontSize: '0.8125rem', color: 'var(--qv-text-primary)' }}>
                      #{pc.orden} · Radio {pc.radioToleranciaM}m
                    </strong>
                    <span
                      style={{
                        fontSize: '0.65rem',
                        fontWeight: 700,
                        color: pc.obligatorio ? 'var(--qv-color-warning)' : 'var(--qv-text-muted)',
                      }}
                    >
                      {pc.obligatorio ? 'Obligatorio' : 'Opcional'}
                    </span>
                  </div>
                  <small
                    style={{
                      fontSize: '0.7rem',
                      color: 'var(--qv-text-secondary)',
                      fontFamily: 'monospace',
                    }}
                  >
                    {pc.coord.coordinates[1].toFixed(5)}, {pc.coord.coordinates[0].toFixed(5)}
                  </small>
                </div>
              </div>

              {/* Cápsula de Herramientas */}
              <div className="qv-table-actions-capsule">
                <Tooltip content="Editar punto de control">
                  <button
                    type="button"
                    className="qv-action-pill-btn"
                    onClick={() => onEditar(pc)}
                    aria-label="Editar punto de control"
                  >
                    <Pencil size={13} />
                  </button>
                </Tooltip>
                <span className="qv-action-pill-divider" />
                {pc.estado === 'inactivo' ? (
                  <Tooltip content="Reactivar control">
                    <button
                      type="button"
                      className="qv-action-pill-btn"
                      disabled={cambiandoEstado}
                      onClick={() => onReactivar(pc.id)}
                      aria-label="Reactivar control"
                    >
                      <RotateCcw size={13} />
                    </button>
                  </Tooltip>
                ) : (
                  <Tooltip content="Eliminar control">
                    <button
                      type="button"
                      className="qv-action-pill-btn qv-action-pill-btn--danger"
                      disabled={cambiandoEstado}
                      onClick={() => onEliminar(pc.id)}
                      aria-label="Eliminar control"
                    >
                      <Trash2 size={13} />
                    </button>
                  </Tooltip>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Tarjeta de variantes de recorrido con herramientas compactas.
 */
export function VariantesCard({
  variantes,
  cambiandoEstado,
  nombreVariante,
  onNombreChange,
  onAgregar,
  guardando,
  onReactivar,
  onEliminar,
}: {
  variantes: Variante[];
  cambiandoEstado: boolean;
  nombreVariante: string;
  onNombreChange: (value: string) => void;
  onAgregar: () => void;
  guardando: boolean;
  onReactivar: (id: string) => void;
  onEliminar: (id: string) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.65rem',
        padding: '0.85rem',
        borderRadius: 'var(--qv-radius-lg)',
        backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 75%, transparent)',
        border: '1px solid var(--qv-border-glass)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
        <GitBranch size={16} style={{ color: 'var(--qv-color-primary)' }} />
        <strong style={{ fontSize: '0.875rem', color: 'var(--qv-text-primary)' }}>
          Variantes ({variantes.length})
        </strong>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
        {variantes.length === 0 ? (
          <small style={{ fontSize: '0.75rem', color: 'var(--qv-text-muted)' }}>
            Sin variantes alternativas en esta ruta.
          </small>
        ) : (
          variantes.map((v) => (
            <div
              key={v.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.4rem 0.6rem',
                borderRadius: 'var(--qv-radius-md)',
                backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 85%, transparent)',
                border: '1px solid var(--qv-border-glass)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Tag>{v.nombre}</Tag>
                {v.estado === 'inactivo' && (
                  <span style={{ fontSize: '0.65rem', color: 'var(--qv-color-danger)', fontWeight: 700 }}>
                    (Inactiva)
                  </span>
                )}
              </div>
              <div className="qv-table-actions-capsule">
                {v.estado === 'inactivo' ? (
                  <Tooltip content="Reactivar variante">
                    <button
                      type="button"
                      className="qv-action-pill-btn"
                      disabled={cambiandoEstado}
                      onClick={() => onReactivar(v.id)}
                      aria-label="Reactivar variante"
                    >
                      <RotateCcw size={13} />
                    </button>
                  </Tooltip>
                ) : (
                  <Tooltip content="Eliminar variante">
                    <button
                      type="button"
                      className="qv-action-pill-btn qv-action-pill-btn--danger"
                      disabled={cambiandoEstado}
                      onClick={() => onEliminar(v.id)}
                      aria-label="Eliminar variante"
                    >
                      <Trash2 size={13} />
                    </button>
                  </Tooltip>
                )}
              </div>
            </div>
          ))
        )}

        <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.35rem' }}>
          <Input
            placeholder="Nueva variante..."
            value={nombreVariante}
            onChange={(event) => onNombreChange(event.target.value)}
          />
          <Button
            size="sm"
            onClick={onAgregar}
            disabled={!nombreVariante.trim() || guardando}
          >
            Agregar
          </Button>
        </div>
      </div>
    </div>
  );
}

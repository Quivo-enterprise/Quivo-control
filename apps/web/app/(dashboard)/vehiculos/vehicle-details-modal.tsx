'use client';

import {
  BanderitaBadge,
  Button,
  Modal,
  PlateBadge,
  StatusBadge,
  type StatusBadgeStatus,
  parsearDistintivoBanderita,
} from '@quivo/design-system';
import {
  COLORES_VEHICULO,
  TIPOS_VEHICULO,
  type Vehiculo,
} from '@quivo/shared';
import { Bus, Edit3, History, RefreshCcw, Users } from 'lucide-react';
import { NOMBRE_ESTADO } from './vehicle-state-modal';

const ESTADO_BADGE_MAP: Record<Vehiculo['estado'], StatusBadgeStatus> = {
  activo: 'active',
  inactivo: 'inactive',
  suspendido: 'warning',
  pendiente: 'idle',
  mantenimiento: 'idle',
};

export function VehicleDetailsModal({
  vehicle,
  socioNombre,
  sindicatoNombre,
  lineaNombre,
  onClose,
  onEdit,
  onChangeState,
  onHistory,
}: {
  vehicle: Vehiculo | null;
  socioNombre?: string;
  sindicatoNombre?: string;
  lineaNombre?: string;
  onClose: () => void;
  onEdit?: (vehicle: Vehiculo) => void;
  onChangeState?: (vehicle: Vehiculo) => void;
  onHistory?: (vehicle: Vehiculo) => void;
}) {
  if (!vehicle) return null;

  const colorData = COLORES_VEHICULO.find((c) => c.codigo === vehicle.color);
  const colorSecundarioData = COLORES_VEHICULO.find((c) => c.codigo === vehicle.colorSecundario);
  const tipoData = TIPOS_VEHICULO.find((t) => t.codigo === vehicle.tipo);

  return (
    <Modal
      open={Boolean(vehicle)}
      title="Ficha Técnica del Vehículo"
      description={`Consulta de registro y especificaciones de la unidad ${vehicle.placaNormalizada}`}
      className="qv-modal--wide"
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {onHistory && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  onClose();
                  onHistory(vehicle);
                }}
              >
                <History size={14} style={{ marginRight: '0.35rem' }} />
                Historial
              </Button>
            )}
            {onChangeState && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  onClose();
                  onChangeState(vehicle);
                }}
              >
                <RefreshCcw size={14} style={{ marginRight: '0.35rem' }} />
                Cambiar estado
              </Button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Button variant="ghost" onClick={onClose}>
              Cerrar
            </Button>
            {onEdit && (
              <Button
                variant="primary"
                onClick={() => {
                  onClose();
                  onEdit(vehicle);
                }}
              >
                <Edit3 size={14} style={{ marginRight: '0.35rem' }} />
                Editar
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(24rem, 1fr))',
          gap: '1rem',
          alignItems: 'start',
        }}
      >
        {/* Columna Izquierda: Identificación, Placa y Operación */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {/* Cabecera con Placa y Estado */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.85rem 1rem',
              borderRadius: 'var(--qv-radius-lg)',
              background: 'color-mix(in srgb, var(--qv-surface-card) 70%, transparent)',
              border: '1px solid var(--qv-border-glass)',
              gap: '0.75rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <PlateBadge plate={vehicle.placa} />
              {vehicle.numeroInterno && (
                <span
                  style={{
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    color: 'var(--qv-text-secondary)',
                    padding: '0.15rem 0.5rem',
                    borderRadius: 'var(--qv-radius-full)',
                    backgroundColor: 'color-mix(in srgb, var(--qv-color-primary) 12%, var(--qv-surface-card))',
                    border: '1px solid var(--qv-border-glass)',
                  }}
                >
                  N° {vehicle.numeroInterno}
                </span>
              )}
            </div>

            <StatusBadge
              circle
              status={ESTADO_BADGE_MAP[vehicle.estado]}
              label={NOMBRE_ESTADO[vehicle.estado] ?? vehicle.estado}
            />
          </div>

          {/* Identificación y Operación */}
          <div
            style={{
              padding: '0.85rem 1rem',
              borderRadius: 'var(--qv-radius-md)',
              background: 'color-mix(in srgb, var(--qv-surface-soft) 80%, transparent)',
              border: '1px solid var(--qv-border-glass)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}
          >
            <span style={{ fontSize: '0.7rem', color: 'var(--qv-text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
              Asignación Operativa
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
              <div>
                <small style={{ color: 'var(--qv-text-muted)', display: 'block', fontSize: '0.68rem' }}>Sindicato:</small>
                <strong style={{ fontSize: '0.78rem', color: 'var(--qv-text-primary)' }}>
                  {sindicatoNombre || 'Sin sindicato'}
                </strong>
              </div>
              <div>
                <small style={{ color: 'var(--qv-text-muted)', display: 'block', fontSize: '0.68rem' }}>Línea:</small>
                <strong style={{ fontSize: '0.78rem', color: 'var(--qv-color-primary)' }}>
                  {lineaNombre || 'Sin línea'}
                </strong>
              </div>
              {vehicle.distintivo && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <small style={{ color: 'var(--qv-text-muted)', display: 'block', fontSize: '0.68rem', marginBottom: '0.15rem' }}>
                    Distintivo / Banderita:
                  </small>
                  {(() => {
                    const parsed = parsearDistintivoBanderita(vehicle.distintivo);
                    return parsed.esBanderita ? (
                      <BanderitaBadge
                        texto={vehicle.distintivo}
                        patron={parsed.patron}
                        colorPrimario={parsed.colorPrimario}
                        colorSecundario={parsed.colorSecundario}
                      />
                    ) : (
                      <span style={{ fontSize: '0.78rem', color: 'var(--qv-text-primary)', fontWeight: 600 }}>
                        {vehicle.distintivo}
                      </span>
                    );
                  })()}
                </div>
              )}
              {vehicle.cartelSuperior && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <small style={{ color: 'var(--qv-text-muted)', display: 'block', fontSize: '0.68rem' }}>Cartel Superior:</small>
                  <span style={{ fontSize: '0.78rem', color: 'var(--qv-text-secondary)', fontWeight: 600 }}>
                    {vehicle.cartelSuperior}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Columna Derecha: Especificaciones Técnicas (2x2 Grid) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
          {/* Tipo de Vehículo */}
          <div
            style={{
              padding: '0.75rem 0.85rem',
              borderRadius: 'var(--qv-radius-md)',
              background: 'var(--qv-surface-glass)',
              border: '1px solid var(--qv-border-glass)',
            }}
          >
            <span style={{ fontSize: '0.68rem', color: 'var(--qv-text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
              Tipo de Unidad
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.25rem' }}>
              <Bus size={15} style={{ color: 'var(--qv-color-primary)' }} />
              <strong style={{ fontSize: '0.8rem', color: 'var(--qv-text-primary)' }}>
                {tipoData?.nombre ?? vehicle.tipo}
              </strong>
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--qv-text-secondary)', display: 'block', marginTop: '0.15rem' }}>
              Capacidad: {vehicle.capacidad} pasajeros
            </span>
          </div>

          {/* Marca y Modelo */}
          <div
            style={{
              padding: '0.75rem 0.85rem',
              borderRadius: 'var(--qv-radius-md)',
              background: 'var(--qv-surface-glass)',
              border: '1px solid var(--qv-border-glass)',
            }}
          >
            <span style={{ fontSize: '0.68rem', color: 'var(--qv-text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
              Marca y Modelo
            </span>
            <div style={{ marginTop: '0.25rem' }}>
              <strong style={{ fontSize: '0.8rem', color: 'var(--qv-text-primary)', display: 'block' }}>
                {vehicle.marca}
              </strong>
              <span style={{ fontSize: '0.7rem', color: 'var(--qv-text-secondary)' }}>
                {vehicle.modelo || 'Estándar'}
              </span>
            </div>
          </div>

          {/* Color de Carrocería con dots apilados */}
          <div
            style={{
              padding: '0.75rem 0.85rem',
              borderRadius: 'var(--qv-radius-md)',
              background: 'var(--qv-surface-glass)',
              border: '1px solid var(--qv-border-glass)',
            }}
          >
            <span style={{ fontSize: '0.68rem', color: 'var(--qv-text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
              Colores Oficiales
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
              {/* Stacked color dots */}
              <div
                style={{
                  position: 'relative',
                  width: colorSecundarioData ? '2.1rem' : '1.5rem',
                  height: '1.5rem',
                  flexShrink: 0,
                }}
              >
                {colorSecundarioData && (
                  <div
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: 0,
                      width: '1.5rem',
                      height: '1.5rem',
                      borderRadius: '50%',
                      backgroundColor: colorSecundarioData.muestra ?? '#64748b',
                      border: '1.5px solid var(--qv-border-glass)',
                      zIndex: 0,
                    }}
                  />
                )}
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: '1.5rem',
                    height: '1.5rem',
                    borderRadius: '50%',
                    backgroundColor: colorData?.muestra ?? '#64748b',
                    border: '1.5px solid var(--qv-border-glass)',
                    zIndex: 1,
                  }}
                />
              </div>
              <strong style={{ fontSize: '0.8rem', color: 'var(--qv-text-primary)' }}>
                {colorData?.nombre ?? vehicle.color}
                {colorSecundarioData && ` + ${colorSecundarioData.nombre}`}
              </strong>
            </div>
          </div>

          {/* Socio Propietario */}
          <div
            style={{
              padding: '0.75rem 0.85rem',
              borderRadius: 'var(--qv-radius-md)',
              background: 'var(--qv-surface-glass)',
              border: '1px solid var(--qv-border-glass)',
            }}
          >
            <span style={{ fontSize: '0.68rem', color: 'var(--qv-text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
              Socio Propietario
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.25rem' }}>
              <Users size={15} style={{ color: 'var(--qv-color-success)' }} />
              <strong style={{ fontSize: '0.8rem', color: 'var(--qv-text-primary)' }}>
                {socioNombre || 'Sin socio'}
              </strong>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

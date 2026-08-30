'use client';

import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  DataTable,
  Loader,
  PlateBadge,
  SearchInput,
  Select,
  Tooltip,
} from '@quivo/design-system';
import {
  COLORES_VEHICULO,
  TIPOS_VEHICULO,
  type ActualizarVehiculo,
  type CambiarEstadoVehiculo,
  type CrearVehiculo,
  type Vehiculo,
} from '@quivo/shared';
import {
  Bus,
  Eye,
  History,
  Pencil,
  Plus,
  RefreshCcw,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import { VehicleFormPanel } from './vehicle-form-panel';
import { VehicleStateModal, NOMBRE_ESTADO } from './vehicle-state-modal';
import { VehicleHistoryModal } from './vehicle-history-modal';
import { VehicleDetailsModal } from './vehicle-details-modal';
import { useVehiculos } from './use-vehiculos';
import { useVehicleHistory } from './use-vehicle-history';
import { vehiculosApi } from '../../../src/lib/api/vehiculos';
import { useSindicatoOptions } from '../../../src/lib/api/use-sindicato-options';
import { useLineaOptions } from '../../../src/lib/api/use-linea-options';
import { useAuth } from '../../../src/lib/auth/auth-context';

export default function VehiculosPage() {
  const { token, user } = useAuth();
  const { options: sindicatoOptions } = useSindicatoOptions();
  const { options: lineaOptions, lineaPorId } = useLineaOptions();
  const { rows, socios, isLoading, loadError, crear, actualizar, cambiarEstado } = useVehiculos(
    token ?? '',
  );
  const history = useVehicleHistory(token ?? '');

  const [query, setQuery] = useState('');
  const [sindicatoFilter, setSindicatoFilter] = useState('');
  const [lineaFilter, setLineaFilter] = useState('');
  const [estadoFilter, setEstadoFilter] = useState('');
  const [tipoFilter, setTipoFilter] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehiculo | null>(null);
  const [stateVehicle, setStateVehicle] = useState<Vehiculo | null>(null);
  const [detailVehicle, setDetailVehicle] = useState<Vehiculo | null>(null);

  const tipoPorCodigo = useMemo(
    () => Object.fromEntries(TIPOS_VEHICULO.map((tipo) => [tipo.codigo, tipo.nombre])),
    [],
  );
  const colorPorCodigo = useMemo(
    () => Object.fromEntries(COLORES_VEHICULO.map((color) => [color.codigo, color])),
    [],
  );
  const socioPorId = useMemo(
    () => Object.fromEntries(socios.map((socio) => [socio.id, socio.nombre])),
    [socios],
  );

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const targetLinea = lineaFilter ? lineaPorId[lineaFilter] : null;

    return rows.filter((row) => {
      if (sindicatoFilter && row.sindicatoId !== sindicatoFilter) return false;
      if (targetLinea) {
        const matchesSindicato = row.sindicatoId === targetLinea.sindicatoId;
        const matchesCodigo =
          (row.cartelSuperior && row.cartelSuperior.toLowerCase().includes(targetLinea.codigo.toLowerCase())) ||
          (row.distintivo && row.distintivo.toLowerCase().includes(targetLinea.codigo.toLowerCase())) ||
          (row.numeroInterno && row.numeroInterno.toLowerCase().includes(targetLinea.codigo.toLowerCase()));
        if (!matchesSindicato && !matchesCodigo) return false;
      }
      if (estadoFilter && row.estado !== estadoFilter) return false;
      if (tipoFilter && row.tipo !== tipoFilter) return false;
      if (!normalized) return true;
      return [
        row.placa,
        row.marca,
        row.modelo,
        row.numeroInterno,
        row.distintivo,
        row.cartelSuperior,
        socioPorId[row.socioId ?? ''],
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized));
    });
  }, [rows, query, sindicatoFilter, lineaFilter, lineaPorId, estadoFilter, tipoFilter, socioPorId]);

  const hasActiveFilters = Boolean(
    query || sindicatoFilter || lineaFilter || estadoFilter || tipoFilter,
  );

  const openCreate = () => {
    setEditingVehicle(null);
    setIsFormOpen(true);
  };

  const openEdit = (vehicle: Vehiculo) => {
    setEditingVehicle(vehicle);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingVehicle(null);
  };

  const saveVehicle = async (data: CrearVehiculo | ActualizarVehiculo) => {
    if (editingVehicle) {
      await actualizar(editingVehicle.id, data as ActualizarVehiculo);
    } else {
      await crear(data as CrearVehiculo);
    }
    closeForm();
  };

  const changeState = async (data: CambiarEstadoVehiculo) => {
    if (!stateVehicle) return;
    await cambiarEstado(stateVehicle.id, data);
    setStateVehicle(null);
  };

  return (
    <div className="vehicles-page" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', position: 'relative' }}>
      {/* Si el formulario inline está abierto, se muestra en lugar de la tabla */}
      {isFormOpen ? (
        <VehicleFormPanel
          vehicle={editingVehicle}
          sindicatoIdDelActor={user?.sindicatoId ?? null}
          esAdminQuivo={user?.rol === 'admin_quivo'}
          sindicatoOptions={sindicatoOptions}
          socios={socios}
          onClose={closeForm}
          onSave={saveVehicle}
          onVerifyPlate={(placa) => vehiculosApi.verificarPlaca(token ?? '', placa)}
        />
      ) : (
        <>
          {/* Barra Unificada de Identidad, Búsqueda y Filtros */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.85rem',
              flexWrap: 'wrap',
              padding: '0.75rem 1.15rem',
              background: 'var(--qv-surface-glass)',
              backdropFilter: 'blur(24px) saturate(180%)',
              WebkitBackdropFilter: 'blur(24px) saturate(180%)',
              borderRadius: 'var(--qv-radius-xl)',
              border: '1px solid var(--qv-border-glass)',
              boxShadow: 'var(--qv-shadow-sm)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', flex: '1 1 auto' }}>
              <h1
                style={{
                  margin: 0,
                  fontSize: '1.05rem',
                  fontWeight: 800,
                  color: 'var(--qv-text-primary)',
                  letterSpacing: '-0.02em',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}
              >
                Vehículos y Flota
              </h1>

              <div style={{ width: '1px', height: '1.4rem', backgroundColor: 'var(--qv-border-glass)' }} />

              <div style={{ flex: '1 1 14rem', maxWidth: '24rem' }}>
                <SearchInput
                  placeholder="Buscar por placa, interno, cartel o socio..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onClear={() => setQuery('')}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '1.85rem',
                    height: '1.85rem',
                    borderRadius: 'var(--qv-radius-md)',
                    backgroundColor: 'color-mix(in srgb, var(--qv-color-primary) 8%, var(--qv-surface-card))',
                    border: '1px solid var(--qv-border-glass)',
                    color: 'var(--qv-color-primary)',
                  }}
                >
                  <SlidersHorizontal size={14} />
                </span>

                {user?.rol === 'admin_quivo' && sindicatoOptions.length > 0 && (
                  <div style={{ minWidth: '11rem' }}>
                    <Select
                      aria-label="Filtrar por sindicato"
                      options={[
                        { label: 'Todos los sindicatos', value: '' },
                        ...sindicatoOptions,
                      ]}
                      placeholder="Todos los sindicatos"
                      value={sindicatoFilter}
                      onChange={(event) => setSindicatoFilter(event.target.value)}
                    />
                  </div>
                )}

                <div style={{ minWidth: '10rem' }}>
                  <Select
                    aria-label="Filtrar por tipo"
                    options={[
                      { label: 'Todos los tipos', value: '' },
                      ...TIPOS_VEHICULO.map((tipo) => ({
                        label: tipo.nombre,
                        value: tipo.codigo,
                      })),
                    ]}
                    placeholder="Todos los tipos"
                    value={tipoFilter}
                    onChange={(event) => setTipoFilter(event.target.value)}
                  />
                </div>

                <div style={{ minWidth: '11rem' }}>
                  <Select
                    aria-label="Filtrar por línea"
                    options={[
                      { label: 'Todas las líneas', value: '' },
                      ...lineaOptions,
                    ]}
                    placeholder="Todas las líneas"
                    value={lineaFilter}
                    onChange={(event) => setLineaFilter(event.target.value)}
                  />
                </div>

                <div style={{ minWidth: '10rem' }}>
                  <Select
                    aria-label="Filtrar por estado"
                    options={[
                      { label: 'Todos los estados', value: '' },
                      ...Object.entries(NOMBRE_ESTADO).map(([value, label]) => ({
                        value,
                        label,
                      })),
                    ]}
                    placeholder="Todos los estados"
                    value={estadoFilter}
                    onChange={(event) => setEstadoFilter(event.target.value)}
                  />
                </div>

                {hasActiveFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setQuery('');
                      setSindicatoFilter('');
                      setLineaFilter('');
                      setTipoFilter('');
                      setEstadoFilter('');
                    }}
                  >
                    Limpiar
                  </Button>
                )}
              </div>
            </div>

            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                color: 'var(--qv-text-secondary)',
                padding: '0.25rem 0.65rem',
                borderRadius: 'var(--qv-radius-full)',
                backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 70%, transparent)',
                border: '1px solid var(--qv-border-glass)',
                whiteSpace: 'nowrap',
              }}
            >
              {filteredRows.length} {filteredRows.length === 1 ? 'unidad' : 'unidades'}
              {hasActiveFilters && filteredRows.length !== rows.length && (
                <span style={{ color: 'var(--qv-color-primary)', marginLeft: '0.25rem' }}>
                  (de {rows.length})
                </span>
              )}
            </span>
          </div>

          {loadError && (
            <Alert variant="danger" title="No se pudo cargar">
              {loadError}
            </Alert>
          )}

          {isLoading ? (
            <div style={{ padding: '3rem', textAlign: 'center' }}>
              <Loader label="Cargando parque automotor..." />
            </div>
          ) : (
            <DataTable
              rows={filteredRows}
              empty={
                query || estadoFilter || tipoFilter
                  ? 'No hay vehículos que coincidan con los filtros.'
                  : 'Sin vehículos registrados.'
              }
              columns={[
                {
                  key: 'placa',
                  header: 'Placa',
                  render: (row) => <PlateBadge plate={row.placaNormalizada} />,
                },
                {
                  key: 'numeroInterno',
                  header: 'Identificador',
                  render: (row) => (
                    <div className="vehicle-identity-cell">
                      <strong>{row.numeroInterno || row.distintivo || 'Sin asignar'}</strong>
                      <small>{row.cartelSuperior || 'Usa el cartel de la línea'}</small>
                    </div>
                  ),
                },
                {
                  key: 'tipo',
                  header: 'Tipo',
                  render: (row) => (
                    <div className="vehicle-type-cell">
                      <span className="vehicle-type-cell__icon" aria-hidden="true">
                        <Bus size={17} />
                      </span>
                      <div>
                        <strong>{tipoPorCodigo[row.tipo] ?? row.tipo}</strong>
                        <small>{row.capacidad} pasajeros</small>
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'marca',
                  header: 'Marca / modelo',
                  render: (row) => (
                    <div className="vehicle-model-cell">
                      <strong>{row.marca}</strong>
                      <small>{row.modelo || 'Sin especificar'}</small>
                    </div>
                  ),
                },
                {
                  key: 'socioId',
                  header: 'Socio propietario',
                  render: (row) => (
                    <div className="vehicle-owner-cell">
                      <span className="vehicle-owner-cell__icon" aria-hidden="true">
                        <Users size={16} />
                      </span>
                      <span>{socioPorId[row.socioId ?? ''] || 'Sin socio asignado'}</span>
                    </div>
                  ),
                },
                {
                  key: 'color',
                  header: 'Color',
                  render: (row) => {
                    const colorData = colorPorCodigo[row.color];
                    const nombre = colorData?.nombre ?? row.color;
                    const colorSecData = row.colorSecundario ? colorPorCodigo[row.colorSecundario] : null;
                    const tooltipText = colorSecData
                      ? `${nombre} + ${colorSecData.nombre}`
                      : `Color: ${nombre}`;
                    return (
                      <Tooltip content={tooltipText}>
                        {/* Contenedor con posición relativa para apilar los dots */}
                        <div
                          style={{
                            position: 'relative',
                            width: colorSecData ? '2.5rem' : '1.85rem',
                            height: '1.85rem',
                            cursor: 'pointer',
                            flexShrink: 0,
                          }}
                          aria-label={tooltipText}
                        >
                          {/* Dot secundario (detrás, offset a la derecha) */}
                          {colorSecData && (
                            <div
                              style={{
                                position: 'absolute',
                                right: 0,
                                top: 0,
                                width: '1.85rem',
                                height: '1.85rem',
                                borderRadius: 'var(--qv-radius-full)',
                                backgroundColor: colorSecData.muestra ?? '#64748b',
                                border: colorSecData.codigo === 'blanco'
                                  ? '2px solid rgba(255,255,255,0.4)'
                                  : '2px solid var(--qv-border-glass)',
                                boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
                                zIndex: 0,
                              }}
                            />
                          )}
                          {/* Dot principal (delante) */}
                          <div
                            style={{
                              position: 'absolute',
                              left: 0,
                              top: 0,
                              width: '1.85rem',
                              height: '1.85rem',
                              borderRadius: 'var(--qv-radius-full)',
                              backgroundColor: colorData?.muestra ?? '#64748b',
                              border: colorData?.codigo === 'blanco'
                                ? '2px solid rgba(255,255,255,0.4)'
                                : '2px solid var(--qv-border-glass)',
                              boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
                              zIndex: 1,
                              transition: 'transform var(--qv-transition-fast)',
                            }}
                          />
                        </div>
                      </Tooltip>
                    );
                  },
                },
                {
                  key: 'estado',
                  header: 'Estado',
                  render: (row) => {
                    const nombre = NOMBRE_ESTADO[row.estado] ?? row.estado;
                    const color =
                      row.estado === 'activo'
                        ? 'var(--qv-color-success)'
                        : row.estado === 'inactivo'
                          ? 'var(--qv-color-danger)'
                          : row.estado === 'suspendido'
                            ? 'var(--qv-color-warning)'
                            : 'var(--qv-color-accent)';
                    return (
                      <Tooltip content={`Estado: ${nombre}`}>
                        <div
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '1.85rem',
                            height: '1.85rem',
                            borderRadius: 'var(--qv-radius-full)',
                            backgroundColor: `color-mix(in srgb, ${color} 16%, var(--qv-surface-card))`,
                            border: `1px solid color-mix(in srgb, ${color} 40%, var(--qv-border-glass))`,
                            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.1)',
                            cursor: 'pointer',
                            transition: 'transform var(--qv-transition-fast)',
                          }}
                          aria-label={`Estado ${nombre}`}
                        >
                          <span
                            style={{
                              width: '0.625rem',
                              height: '0.625rem',
                              borderRadius: 'var(--qv-radius-full)',
                              backgroundColor: color,
                              boxShadow: `0 0 8px ${color}`,
                            }}
                          />
                        </div>
                      </Tooltip>
                    );
                  },
                },
              ]}
              actions={(row) => (
                <div className="qv-table-actions-capsule">
                  <Tooltip content={`Ver detalles de ${row.placa}`}>
                    <button
                      type="button"
                      className="qv-action-pill-btn"
                      onClick={() => setDetailVehicle(row)}
                      aria-label={`Ver detalles de ${row.placa}`}
                    >
                      <Eye size={13} />
                    </button>
                  </Tooltip>
                  <span className="qv-action-pill-divider" />
                  <Tooltip content="Editar vehículo">
                    <button
                      type="button"
                      className="qv-action-pill-btn"
                      onClick={() => openEdit(row)}
                      aria-label="Editar"
                    >
                      <Pencil size={13} />
                    </button>
                  </Tooltip>
                  <span className="qv-action-pill-divider" />
                  <Tooltip content="Cambiar estado de operación">
                    <button
                      type="button"
                      className="qv-action-pill-btn"
                      onClick={() => setStateVehicle(row)}
                      aria-label={`Cambiar estado de ${row.placa}`}
                    >
                      <RefreshCcw size={13} />
                    </button>
                  </Tooltip>
                  <span className="qv-action-pill-divider" />
                  <Tooltip content={`Ver historial de ${row.placa}`}>
                    <button
                      type="button"
                      className="qv-action-pill-btn"
                      onClick={() => history.open(row)}
                      aria-label={`Ver historial de ${row.placa}`}
                    >
                      <History size={13} />
                    </button>
                  </Tooltip>
                </div>
              )}
            />
          )}

          {/* Botón Flotante Abajo a la Derecha */}
          <button
            type="button"
            className="qv-floating-fab-bottom-right"
            onClick={openCreate}
          >
            <Plus size={18} strokeWidth={2.5} />
            <span>Nuevo vehículo</span>
          </button>
        </>
      )}

      <VehicleDetailsModal
        vehicle={detailVehicle}
        socioNombre={detailVehicle?.socioId ? socioPorId[detailVehicle.socioId] : undefined}
        sindicatoNombre={
          detailVehicle
            ? sindicatoOptions.find((s) => s.value === detailVehicle.sindicatoId)?.label
            : undefined
        }
        onClose={() => setDetailVehicle(null)}
        onEdit={openEdit}
        onChangeState={setStateVehicle}
        onHistory={history.open}
      />

      <VehicleStateModal
        vehicle={stateVehicle}
        onClose={() => setStateVehicle(null)}
        onSave={changeState}
      />

      <VehicleHistoryModal
        vehicle={history.vehicle}
        rows={history.rows}
        isLoading={history.isLoading}
        error={history.error}
        onClose={history.close}
      />
    </div>
  );
}

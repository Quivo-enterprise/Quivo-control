'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  DataTable,
  FormField,
  Input,
  Loader,
  MetricStrip,
  Modal,
  PageHeader,
  PlateBadge,
  SearchInput,
  Select,
  StatusBadge,
  Tooltip,
  type StatusBadgeStatus,
} from '@quivo/design-system';
import {
  CambiarEstadoVehiculoSchema,
  COLORES_VEHICULO,
  TIPOS_VEHICULO,
  type ActualizarVehiculo,
  type CambiarEstadoVehiculo,
  type CrearVehiculo,
  type EstadoVehiculo,
  type HistorialEstadoVehiculo,
  type Socio,
  type Vehiculo,
} from '@quivo/shared';
import { Bus, History, Pencil, Plus, RefreshCcw, SlidersHorizontal, Users } from 'lucide-react';
import { VehicleFormPanel } from './vehicle-form-panel';
import { sociosApi } from '../../../src/lib/api/socios';
import { vehiculosApi } from '../../../src/lib/api/vehiculos';
import { useSindicatoOptions } from '../../../src/lib/api/use-sindicato-options';
import { useAuth } from '../../../src/lib/auth/auth-context';

const ESTADO_BADGE: Record<Vehiculo['estado'], StatusBadgeStatus> = {
  pendiente: 'idle',
  activo: 'active',
  inactivo: 'inactive',
  suspendido: 'warning',
  mantenimiento: 'idle',
};

const NOMBRE_ESTADO: Record<EstadoVehiculo, string> = {
  pendiente: 'Pendiente',
  activo: 'Activo',
  inactivo: 'Inactivo',
  suspendido: 'Suspendido',
  mantenimiento: 'Mantenimiento',
};

const TRANSICIONES: Record<EstadoVehiculo, EstadoVehiculo[]> = {
  pendiente: ['activo', 'inactivo'],
  activo: ['inactivo', 'suspendido', 'mantenimiento'],
  inactivo: ['activo'],
  suspendido: ['activo', 'inactivo'],
  mantenimiento: ['activo', 'inactivo'],
};

export default function VehiculosPage() {
  const { token, user } = useAuth();
  const { options: sindicatoOptions, nombrePorId } = useSindicatoOptions();
  const [rows, setRows] = useState<Vehiculo[]>([]);
  const [socios, setSocios] = useState<Socio[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [estadoFilter, setEstadoFilter] = useState('');
  const [tipoFilter, setTipoFilter] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehiculo | null>(null);
  const [stateVehicle, setStateVehicle] = useState<Vehiculo | null>(null);
  const [historyVehicle, setHistoryVehicle] = useState<Vehiculo | null>(null);
  const [historyRows, setHistoryRows] = useState<HistorialEstadoVehiculo[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    Promise.all([vehiculosApi.listar(token ?? ''), sociosApi.listar(token ?? '')])
      .then(([vehiculos, sociosData]) => {
        if (cancelled) return;
        setRows(vehiculos);
        setSocios(sociosData);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setLoadError(
            error instanceof Error ? error.message : 'No se pudieron cargar los vehículos.',
          );
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

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
    return rows.filter((row) => {
      if (estadoFilter && row.estado !== estadoFilter) return false;
      if (tipoFilter && row.tipo !== tipoFilter) return false;
      if (!normalized) return true;
      return [row.placa, row.marca, row.modelo, socioPorId[row.socioId ?? '']]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized));
    });
  }, [rows, query, estadoFilter, tipoFilter, socioPorId]);
  const fleetMetrics = useMemo(() => {
    const activos = rows.filter((row) => row.estado === 'activo').length;
    const pendientes = rows.filter((row) => row.estado === 'pendiente').length;
    const requierenAtencion = rows.filter(
      (row) => row.estado === 'suspendido' || row.estado === 'mantenimiento',
    ).length;
    const disponibilidad = rows.length === 0 ? 0 : Math.round((activos / rows.length) * 100);

    return [
      { label: 'Unidades registradas', value: String(rows.length), helper: 'Flota total' },
      {
        label: 'Vehículos activos',
        value: String(activos),
        helper: `${disponibilidad}% disponible`,
      },
      { label: 'Pendientes', value: String(pendientes), helper: 'Requieren validación' },
      {
        label: 'Atención operativa',
        value: String(requierenAtencion),
        helper: 'Suspendidos o en taller',
      },
    ];
  }, [rows]);
  const hasActiveFilters = Boolean(query || estadoFilter || tipoFilter);

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
    const saved = editingVehicle
      ? await vehiculosApi.actualizar(token ?? '', editingVehicle.id, data as ActualizarVehiculo)
      : await vehiculosApi.crear(token ?? '', data as CrearVehiculo);
    setRows((previous) =>
      editingVehicle
        ? previous.map((row) => (row.id === saved.id ? saved : row))
        : [saved, ...previous],
    );
    closeForm();
  };

  const changeState = async (data: CambiarEstadoVehiculo) => {
    if (!stateVehicle) return;
    const saved = await vehiculosApi.cambiarEstado(token ?? '', stateVehicle.id, data);
    setRows((previous) => previous.map((row) => (row.id === saved.id ? saved : row)));
    setStateVehicle(null);
  };

  const openHistory = async (vehicle: Vehiculo) => {
    setHistoryVehicle(vehicle);
    setHistoryRows([]);
    setHistoryError(null);
    setIsLoadingHistory(true);
    try {
      setHistoryRows(await vehiculosApi.historialEstados(token ?? '', vehicle.id));
    } catch (error: unknown) {
      setHistoryError(error instanceof Error ? error.message : 'No se pudo cargar el historial.');
    } finally {
      setIsLoadingHistory(false);
    }
  };

  return (
    <div className="vehicles-page">
      <PageHeader
        title="Vehículos"
        subtitle="Administra la flota de vehículos de los sindicatos."
        actions={
          !isFormOpen ? (
            <Button onClick={openCreate}>
              <Plus size={16} style={{ marginRight: '6px' }} />
              Nuevo vehículo
            </Button>
          ) : undefined
        }
      />

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
          <section className="vehicles-overview" aria-label="Resumen de la flota">
            <div className="vehicles-overview__heading">
              <div>
                <span className="vehicles-overview__eyebrow">Control operativo</span>
                <h2>Estado general de la flota</h2>
              </div>
              <span className="vehicles-overview__live">
                <span aria-hidden="true" /> Datos actualizados
              </span>
            </div>
            <MetricStrip metrics={fleetMetrics} className="vehicles-metrics" />
          </section>

          <section className="vehicles-fleet" aria-label="Listado de vehículos">
            <div className="vehicles-toolbar">
              <SearchInput
                placeholder="Buscar por placa, marca, modelo o propietario..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onClear={() => setQuery('')}
              />
              <div className="vehicles-toolbar__filters" aria-label="Filtros de vehículos">
                <span className="vehicles-toolbar__filter-icon" aria-hidden="true">
                  <SlidersHorizontal size={17} />
                </span>
                <Select
                  aria-label="Filtrar por tipo"
                  options={TIPOS_VEHICULO.map((tipo) => ({
                    label: tipo.nombre,
                    value: tipo.codigo,
                  }))}
                  placeholder="Todos los tipos"
                  value={tipoFilter}
                  onChange={(event) => setTipoFilter(event.target.value)}
                />
                <Select
                  aria-label="Filtrar por estado"
                  options={Object.entries(NOMBRE_ESTADO).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                  placeholder="Todos los estados"
                  value={estadoFilter}
                  onChange={(event) => setEstadoFilter(event.target.value)}
                />
                {hasActiveFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setQuery('');
                      setTipoFilter('');
                      setEstadoFilter('');
                    }}
                  >
                    Limpiar
                  </Button>
                )}
              </div>
            </div>

            <div className="vehicles-results-meta" aria-live="polite">
              <div>
                <strong>{filteredRows.length}</strong>
                <span>{filteredRows.length === 1 ? ' unidad visible' : ' unidades visibles'}</span>
                {filteredRows.length !== rows.length && <small> de {rows.length}</small>}
              </div>
              {hasActiveFilters && (
                <span className="vehicles-results-meta__tag">Filtros activos</span>
              )}
            </div>

            {loadError && (
              <Alert variant="danger" title="No se pudo cargar">
                {loadError}
              </Alert>
            )}

            {isLoading ? (
              <Loader label="Cargando vehículos..." />
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
                        <small>{row.modelo}</small>
                      </div>
                    ),
                  },
                  {
                    key: 'capacidad',
                    header: 'Color',
                    render: (row) => (
                      <div className="vehicle-color-cell">
                        <span
                          aria-hidden="true"
                          style={{ background: colorPorCodigo[row.color]?.muestra ?? '#94a3b8' }}
                        />
                        {colorPorCodigo[row.color]?.nombre ?? row.color}
                      </div>
                    ),
                  },
                  {
                    key: 'socioId',
                    header: 'Propietario',
                    render: (row) =>
                      socioPorId[row.socioId ?? ''] ? (
                        <div className="vehicle-owner-cell">
                          <Users size={15} aria-hidden="true" />
                          <span>{socioPorId[row.socioId ?? '']}</span>
                        </div>
                      ) : (
                        <span className="vehicle-missing-data">Sin asignar</span>
                      ),
                  },
                  ...(user?.rol === 'admin_quivo'
                    ? [
                        {
                          key: 'sindicatoId' as const,
                          header: 'Sindicato',
                          render: (row: Vehiculo) =>
                            nombrePorId[row.sindicatoId] ?? row.sindicatoId,
                        },
                      ]
                    : []),
                  {
                    key: 'estado',
                    header: 'Estado',
                    render: (row) => (
                      <StatusBadge
                        status={ESTADO_BADGE[row.estado]}
                        label={NOMBRE_ESTADO[row.estado]}
                      />
                    ),
                  },
                ]}
                actions={(row) => (
                  <div className="vehicles-table-actions">
                    <Tooltip content="Ver historial">
                      <Button
                        className="vehicle-action-button"
                        variant="ghost"
                        size="sm"
                        onClick={() => openHistory(row)}
                        aria-label={`Ver historial de ${row.placa}`}
                      >
                        <History size={16} aria-hidden="true" />
                      </Button>
                    </Tooltip>
                    <Tooltip content="Cambiar estado">
                      <Button
                        className="vehicle-action-button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setStateVehicle(row)}
                        aria-label={`Cambiar estado de ${row.placa}`}
                      >
                        <RefreshCcw size={16} aria-hidden="true" />
                      </Button>
                    </Tooltip>
                    <Tooltip content="Editar vehículo">
                      <Button
                        className="vehicle-action-button"
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(row)}
                        aria-label={`Editar ${row.placa}`}
                      >
                        <Pencil size={16} aria-hidden="true" />
                      </Button>
                    </Tooltip>
                  </div>
                )}
              />
            )}
          </section>
        </>
      )}

      <VehicleStateModal
        vehicle={stateVehicle}
        onClose={() => setStateVehicle(null)}
        onSave={changeState}
      />
      <VehicleHistoryModal
        vehicle={historyVehicle}
        rows={historyRows}
        isLoading={isLoadingHistory}
        error={historyError}
        onClose={() => setHistoryVehicle(null)}
      />
    </div>
  );
}

function VehicleStateModal({
  vehicle,
  onClose,
  onSave,
}: {
  vehicle: Vehiculo | null;
  onClose: () => void;
  onSave: (data: CambiarEstadoVehiculo) => Promise<void>;
}) {
  const opciones = vehicle ? TRANSICIONES[vehicle.estado] : [];
  const [estado, setEstado] = useState<EstadoVehiculo | ''>('');
  const [motivo, setMotivo] = useState('');
  const [observacion, setObservacion] = useState('');
  const [retornoEstimado, setRetornoEstimado] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!vehicle) return;
    setEstado(TRANSICIONES[vehicle.estado][0] ?? '');
    setMotivo('');
    setObservacion('');
    setRetornoEstimado('');
    setErrors({});
    setFormError(null);
  }, [vehicle]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    const parsed = CambiarEstadoVehiculoSchema.safeParse({
      estado,
      motivo: motivo || null,
      observacion: observacion || null,
      retornoEstimado: retornoEstimado ? `${retornoEstimado}T12:00:00.000Z` : null,
    });
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
        ),
      );
      return;
    }
    setIsSaving(true);
    try {
      await onSave(parsed.data);
    } catch (error: unknown) {
      setFormError(error instanceof Error ? error.message : 'No se pudo cambiar el estado.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      open={vehicle !== null}
      title="Cambiar estado"
      description={
        vehicle
          ? `${vehicle.placaNormalizada} · Estado actual: ${NOMBRE_ESTADO[vehicle.estado]}`
          : undefined
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSaving}>
            Cancelar
          </Button>
          <Button type="submit" form="vehicle-state-form" disabled={isSaving}>
            {isSaving ? 'Guardando...' : 'Confirmar cambio'}
          </Button>
        </>
      }
    >
      {formError && (
        <Alert variant="danger" title="No se pudo cambiar">
          {formError}
        </Alert>
      )}
      <form id="vehicle-state-form" className="vehicle-state-form" onSubmit={submit}>
        <FormField label="Nuevo estado" htmlFor="vehicle-new-state" required error={errors.estado}>
          <Select
            id="vehicle-new-state"
            options={opciones.map((value) => ({ value, label: NOMBRE_ESTADO[value] }))}
            value={estado}
            onChange={(event) => setEstado(event.target.value as EstadoVehiculo)}
            fullWidth
          />
        </FormField>
        {estado !== 'activo' && (
          <FormField label="Motivo" htmlFor="vehicle-state-reason" required error={errors.motivo}>
            <Input
              id="vehicle-state-reason"
              value={motivo}
              onChange={(event) => setMotivo(event.target.value)}
              maxLength={200}
              fullWidth
            />
          </FormField>
        )}
        <FormField
          label="Observación"
          htmlFor="vehicle-state-observation"
          error={errors.observacion}
        >
          <Input
            id="vehicle-state-observation"
            value={observacion}
            onChange={(event) => setObservacion(event.target.value)}
            maxLength={500}
            fullWidth
          />
        </FormField>
        {estado === 'mantenimiento' && (
          <FormField
            label="Retorno estimado"
            htmlFor="vehicle-return-date"
            error={errors.retornoEstimado}
          >
            <Input
              id="vehicle-return-date"
              type="date"
              value={retornoEstimado}
              onChange={(event) => setRetornoEstimado(event.target.value)}
              fullWidth
            />
          </FormField>
        )}
        {estado === 'activo' && (
          <Alert variant="info" title="Validación de activación">
            El backend comprobará placa, propietario, tipo, marca, modelo, color y capacidad antes
            de activar.
          </Alert>
        )}
      </form>
    </Modal>
  );
}

function VehicleHistoryModal({
  vehicle,
  rows,
  isLoading,
  error,
  onClose,
}: {
  vehicle: Vehiculo | null;
  rows: HistorialEstadoVehiculo[];
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={vehicle !== null}
      title="Historial de estados"
      description={vehicle ? `Trazabilidad de ${vehicle.placaNormalizada}` : undefined}
      onClose={onClose}
      footer={<Button onClick={onClose}>Cerrar</Button>}
    >
      {error && (
        <Alert variant="danger" title="No se pudo cargar">
          {error}
        </Alert>
      )}
      {isLoading ? (
        <Loader label="Cargando historial..." />
      ) : rows.length === 0 && !error ? (
        <p className="vehicle-history-empty">Este vehículo todavía no tiene cambios registrados.</p>
      ) : (
        <ol className="vehicle-history">
          {rows.map((row) => (
            <li key={row.id}>
              <span className="vehicle-history__marker" aria-hidden="true" />
              <div>
                <strong>
                  {row.estadoDesde ? `${NOMBRE_ESTADO[row.estadoDesde]} → ` : ''}
                  {NOMBRE_ESTADO[row.estadoHasta]}
                </strong>
                <time dateTime={row.createdAt}>
                  {new Intl.DateTimeFormat('es-BO', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(row.createdAt))}
                </time>
                {row.motivo && <p>{row.motivo}</p>}
                <small>Responsable: {row.actorId}</small>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}

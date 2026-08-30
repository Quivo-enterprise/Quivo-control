'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  Grid,
  Loader,
  MetricCard,
  Modal,
  PageHeader,
  PlateBadge,
  Select,
  StatusBadge,
  Tabs,
  Tooltip,
  type StatusBadgeStatus,
} from '@quivo/design-system';
import type { EstadoSancion, Regla, Sancion } from '@quivo/shared';
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  Bus,
  Calendar,
  CheckCircle2,
  Clock,
  Eye,
  Filter,
  Plus,
  Scale,
  ShieldAlert,
  Sparkles,
  Trash2,
  User,
  Users,
} from 'lucide-react';
import {
  ModuleTablePage,
  type EntityFieldConfig,
  type ModuleDataSource,
  type TableFilterConfig,
} from '../../../src/components/module-table-page';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { reglasApi } from '../../../src/lib/api/reglas';
import { useSindicatoOptions } from '../../../src/lib/api/use-sindicato-options';
import { NuevaSancionModal, SUJETO_TIPOS } from './nueva-sancion-modal';
import { useSanciones, FILTROS_SANCIONES_VACIOS, type Transicion } from './use-sanciones';
import { ReglaPreviewCard } from './regla-preview';

function GravedadBadge({ gravedad }: { gravedad: Regla['gravedad'] | string }) {
  const g = gravedad?.toLowerCase();
  if (g === 'gravisima' || g === 'gravísima') {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.35rem',
          padding: '0.2rem 0.6rem',
          borderRadius: '999px',
          fontSize: '0.72rem',
          fontWeight: 700,
          letterSpacing: '0.03em',
          backgroundColor: 'rgba(239, 68, 68, 0.15)',
          color: '#f87171',
          border: '1px solid rgba(239, 68, 68, 0.45)',
          boxShadow: '0 0 10px rgba(239, 68, 68, 0.25)',
        }}
      >
        <ShieldAlert size={12} style={{ color: '#f87171', flexShrink: 0 }} />
        <span>GRAVÍSIMA</span>
      </span>
    );
  }

  if (g === 'grave') {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.35rem',
          padding: '0.2rem 0.6rem',
          borderRadius: '999px',
          fontSize: '0.72rem',
          fontWeight: 700,
          letterSpacing: '0.03em',
          backgroundColor: 'rgba(245, 158, 11, 0.15)',
          color: '#fbbf24',
          border: '1px solid rgba(245, 158, 11, 0.45)',
          boxShadow: '0 0 10px rgba(245, 158, 11, 0.25)',
        }}
      >
        <AlertTriangle size={12} style={{ color: '#fbbf24', flexShrink: 0 }} />
        <span>GRAVE</span>
      </span>
    );
  }

  // Leve (default)
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        padding: '0.2rem 0.6rem',
        borderRadius: '999px',
        fontSize: '0.72rem',
        fontWeight: 700,
        letterSpacing: '0.03em',
        backgroundColor: 'rgba(16, 185, 129, 0.15)',
        color: '#34d399',
        border: '1px solid rgba(16, 185, 129, 0.45)',
        boxShadow: '0 0 10px rgba(16, 185, 129, 0.25)',
      }}
    >
      <CheckCircle2 size={12} style={{ color: '#34d399', flexShrink: 0 }} />
      <span>LEVE</span>
    </span>
  );
}

const ESTADO_REGLA_BADGE: Record<Regla['estado'], StatusBadgeStatus> = {
  activo: 'active',
  inactivo: 'inactive',
};

const ESTADO_SANCION_BADGE: Record<EstadoSancion, StatusBadgeStatus> = {
  pendiente: 'pending',
  aplicada: 'warning',
  apelada: 'idle',
  pagada: 'active',
  anulada: 'canceled',
};

const TRANSICIONES_POR_ESTADO: Record<EstadoSancion, Transicion[]> = {
  pendiente: ['aplicar', 'anular'],
  aplicada: ['apelar', 'pagar', 'anular'],
  apelada: ['aplicar', 'anular'],
  pagada: [],
  anulada: [],
};

const LABEL_TRANSICION: Record<Transicion, string> = {
  aplicar: 'Aplicar',
  anular: 'Anular',
  apelar: 'Apelar',
  pagar: 'Marcar pagada',
};

const ICONO_TRANSICION: Record<Transicion, typeof CheckCircle2> = {
  aplicar: CheckCircle2,
  anular: ShieldAlert,
  apelar: Scale,
  pagar: CheckCircle2,
};

export default function ReglasPage() {
  const [tab, setTab] = useState('reglas');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader
        title="Reglas y Sanciones"
        subtitle="Estatutos sindicales, tipificación de faltas y control disciplinario de la flota."
      />
      <div style={{ maxWidth: '24rem' }}>
        <Tabs
          items={[
            { value: 'reglas', label: 'Estatutos y Reglas' },
            { value: 'sanciones', label: 'Sanciones Operativas' },
          ]}
          value={tab}
          onValueChange={setTab}
        />
      </div>
      {tab === 'reglas' ? <ReglasTab /> : <SancionesTab />}
    </div>
  );
}

function ReglasTab() {
  const { token, user } = useAuth();
  const { options: sindicatoOptions } = useSindicatoOptions();

  const [tiposExistentes, setTiposExistentes] = useState<string[]>([]);
  useEffect(() => {
    if (!token) return;
    reglasApi
      .listar(token)
      .then((reglas) => setTiposExistentes(Array.from(new Set(reglas.map((r) => r.tipo))).sort()))
      .catch(() => {});
  }, [token]);

  const fields = useMemo<EntityFieldConfig[]>(() => {
    const base: EntityFieldConfig[] = [
      { key: 'nombre', label: 'Nombre de la regla', kind: 'text', required: true },
      { key: 'tipo', label: 'Tipo / Categoría', kind: 'text', required: true, suggestions: tiposExistentes },
      {
        key: 'gravedad',
        label: 'Nivel de Gravedad',
        kind: 'select',
        options: [
          { label: 'Leve', value: 'leve' },
          { label: 'Grave', value: 'grave' },
          { label: 'Gravísima', value: 'gravisima' },
        ],
        required: true,
      },
      {
        key: 'aplicaA',
        label: 'Aplica a',
        kind: 'select',
        options: SUJETO_TIPOS,
        required: true,
      },
      { key: 'descripcion', label: 'Descripción / Detalle de la infracción', kind: 'text' },
    ];
    if (user?.rol === 'admin_quivo') {
      base.push({
        key: 'sindicatoId',
        label: 'Sindicato',
        kind: 'select',
        options: sindicatoOptions,
        required: true,
      });
    }
    base.push({
      key: 'estado',
      label: 'Estado',
      kind: 'select',
      options: [
        { label: 'Activo', value: 'activo' },
        { label: 'Inactivo', value: 'inactivo' },
      ],
    });
    return base;
  }, [user?.rol, sindicatoOptions, tiposExistentes]);

  const filters = useMemo<TableFilterConfig<Regla>[]>(() => {
    const list: TableFilterConfig<Regla>[] = [];

    if (user?.rol === 'admin_quivo') {
      list.push({
        key: 'sindicatoId',
        label: 'Sindicato',
        placeholder: 'Todos los sindicatos',
        options: [{ label: 'Todos los sindicatos', value: '' }, ...sindicatoOptions],
      });
    }

    list.push({
      key: 'gravedad',
      label: 'Gravedad',
      placeholder: 'Todas las gravedades',
      options: [
        { label: 'Todas las gravedades', value: '' },
        { label: 'Leve', value: 'leve' },
        { label: 'Grave', value: 'grave' },
        { label: 'Gravísima', value: 'gravisima' },
      ],
    });

    list.push({
      key: 'aplicaA',
      label: 'Aplica a',
      placeholder: 'Todos los sujetos',
      options: [
        { label: 'Todos los sujetos', value: '' },
        { label: 'Conductor', value: 'conductor' },
        { label: 'Vehículo', value: 'vehiculo' },
        { label: 'Socio', value: 'socio' },
      ],
    });

    list.push({
      key: 'estado',
      label: 'Estado',
      placeholder: 'Todos los estados',
      options: [
        { label: 'Todos los estados', value: '' },
        { label: 'Activo', value: 'activo' },
        { label: 'Inactivo', value: 'inactivo' },
      ],
    });

    return list;
  }, [user?.rol, sindicatoOptions]);

  const dataSource = useMemo<ModuleDataSource<Regla>>(
    () => ({
      list: () => reglasApi.listar(token ?? ''),
      create: (values) => reglasApi.crear(token ?? '', values as never),
      update: (id, values) => reglasApi.actualizar(token ?? '', id, values as never),
    }),
    [token],
  );

  const [detalleRegla, setDetalleRegla] = useState<Regla | null>(null);

  return (
    <>
      <ModuleTablePage<Regla>
        title="Estatutos y Reglas"
        subtitle="Catálogo oficial de normas, infracciones y políticas disciplinarias del sindicato."
        entityLabel="regla"
        searchPlaceholder="Buscar por nombre, tipo o descripción..."
        searchKeys={['nombre', 'tipo', 'descripcion']}
        filters={filters}
        fields={fields}
        formPresentation="inline"
        renderFormPreview={(values) => (
          <ReglaPreviewCard values={values} sindicatoOptions={sindicatoOptions} />
        )}
        createDefaults={{
          gravedad: 'leve',
          aplicaA: 'conductor',
          estado: 'activo',
          sindicatoId: user?.sindicatoId ?? '',
        }}
        dataSource={dataSource}
        renderRowActions={(row) => (
          <Tooltip content="Ver detalle de la regla">
            <button
              type="button"
              className="qv-action-pill-btn"
              onClick={() => setDetalleRegla(row)}
              aria-label="Ver detalle"
            >
              <Eye size={13} />
            </button>
          </Tooltip>
        )}
        columns={[
          {
            key: 'nombre',
            header: 'Regla e Infracción',
            render: (row) => (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div
                  style={{
                    width: '2.25rem',
                    height: '2.25rem',
                    borderRadius: 'var(--qv-radius-md)',
                    backgroundColor: 'color-mix(in srgb, var(--qv-color-primary) 12%, var(--qv-surface-card))',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--qv-color-primary)',
                    flexShrink: 0,
                  }}
                >
                  <Scale size={16} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                  <strong style={{ fontSize: '0.875rem', color: '#ffffff' }}>
                    {row.nombre}
                  </strong>
                  {row.descripcion ? (
                    <span
                      style={{
                        fontSize: '0.75rem',
                        color: 'var(--qv-text-secondary)',
                        maxWidth: '22rem',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {row.descripcion}
                    </span>
                  ) : null}
                </div>
              </div>
            ),
          },
          {
            key: 'tipo',
            header: 'Tipo',
            render: (row) => (
              <span
                style={{
                  display: 'inline-block',
                  padding: '0.18rem 0.6rem',
                  borderRadius: 'var(--qv-radius-full)',
                  backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 70%, transparent)',
                  border: '1px solid var(--qv-border-glass)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: 'var(--qv-text-secondary)',
                }}
              >
                {row.tipo}
              </span>
            ),
          },
          {
            key: 'gravedad',
            header: 'Gravedad',
            render: (row) => <GravedadBadge gravedad={row.gravedad} />,
          },
          {
            key: 'aplicaA',
            header: 'Aplica a',
            render: (row) => {
              const Icon = row.aplicaA === 'conductor' ? User : row.aplicaA === 'vehiculo' ? Bus : Users;
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8125rem', color: '#ffffff' }}>
                  <Icon size={14} style={{ color: 'var(--qv-color-primary)' }} />
                  <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>{row.aplicaA}</span>
                </div>
              );
            },
          },
          {
            key: 'estado',
            header: 'Estado',
            render: (row) => (
              <StatusBadge
                circle
                status={ESTADO_REGLA_BADGE[row.estado]}
                label={`Estado: ${row.estado.toUpperCase()}`}
              />
            ),
          },
        ]}
      />

      {/* Modal de Detalle Completo de la Regla */}
      <Modal
        open={detalleRegla !== null}
        title={detalleRegla ? `Detalle de Regla — ${detalleRegla.nombre}` : ''}
        onClose={() => setDetalleRegla(null)}
      >
        {detalleRegla && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                borderRadius: 'var(--qv-radius-lg)',
                backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                border: '1px solid var(--qv-border-glass)',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Scale size={16} style={{ color: 'var(--qv-color-primary)', flexShrink: 0 }} />
                <strong style={{ fontSize: '0.9375rem', color: '#ffffff' }}>
                  {detalleRegla.nombre}
                </strong>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <GravedadBadge gravedad={detalleRegla.gravedad} />
                <StatusBadge
                  circle
                  status={ESTADO_REGLA_BADGE[detalleRegla.estado]}
                  label={detalleRegla.estado.toUpperCase()}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '0.75rem' }}>
              <div
                style={{
                  padding: '0.65rem 0.85rem',
                  borderRadius: 'var(--qv-radius-md)',
                  backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                  border: '1px solid var(--qv-border-glass)',
                }}
              >
                <span style={{ fontSize: '0.6875rem', color: 'var(--qv-text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Categoría / Tipo
                </span>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8125rem', color: '#ffffff', fontWeight: 600 }}>
                  {detalleRegla.tipo}
                </p>
              </div>

              <div
                style={{
                  padding: '0.65rem 0.85rem',
                  borderRadius: 'var(--qv-radius-md)',
                  backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                  border: '1px solid var(--qv-border-glass)',
                }}
              >
                <span style={{ fontSize: '0.6875rem', color: 'var(--qv-text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Sujeto de Aplicación
                </span>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8125rem', color: '#ffffff', fontWeight: 600, textTransform: 'capitalize' }}>
                  {detalleRegla.aplicaA}
                </p>
              </div>
            </div>

            {detalleRegla.descripcion && (
              <div
                style={{
                  padding: '0.75rem 0.85rem',
                  borderRadius: 'var(--qv-radius-md)',
                  backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                  border: '1px solid var(--qv-border-glass)',
                }}
              >
                <span style={{ fontSize: '0.6875rem', color: 'var(--qv-text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Descripción / Tipificación
                </span>
                <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.8125rem', color: '#ffffff', lineHeight: 1.45 }}>
                  {detalleRegla.descripcion}
                </p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

function SancionesTab() {
  const { token, user } = useAuth();
  const { options: sindicatoOptions } = useSindicatoOptions();

  const [sindicatoSeleccionado, setSindicatoSeleccionado] = useState('');
  const sindicatoId =
    user?.rol === 'admin_quivo' ? sindicatoSeleccionado : (user?.sindicatoId ?? '');

  const {
    reglas,
    vehiculos,
    conductores,
    socios,
    sanciones,
    loading,
    cargandoMas,
    hasMore,
    error,
    setFiltrosAplicados,
    cargarMas,
    refrescar,
    aplicarTransicion,
  } = useSanciones(token, sindicatoId);

  const [modalNueva, setModalNueva] = useState(false);
  const [detalleSancion, setDetalleSancion] = useState<Sancion | null>(null);
  const [confirmacion, setConfirmacion] = useState<{
    sancion: Sancion;
    transicion: Transicion;
  } | null>(null);
  const [procesando, setProcesando] = useState(false);

  const [filtroEstado, setFiltroEstado] = useState('');
  const [filtroReglaId, setFiltroReglaId] = useState('');

  function aplicarFiltros() {
    setFiltrosAplicados({
      estado: filtroEstado as EstadoSancion | '',
      reglaId: filtroReglaId,
    });
  }

  function limpiarFiltros() {
    setFiltroEstado('');
    setFiltroReglaId('');
    setFiltrosAplicados(FILTROS_SANCIONES_VACIOS);
  }

  const reglaPorId = useMemo(() => new Map(reglas.map((r) => [r.id, r])), [reglas]);
  const vehiculoPorId = useMemo(() => new Map(vehiculos.map((v) => [v.id, v])), [vehiculos]);
  const conductorPorId = useMemo(() => new Map(conductores.map((c) => [c.id, c])), [conductores]);
  const socioPorId = useMemo(() => new Map(socios.map((s) => [s.id, s])), [socios]);

  // Resumen estadístico
  const totalPendientes = useMemo(() => sanciones.filter((s) => s.estado === 'pendiente').length, [sanciones]);
  const totalAplicadas = useMemo(() => sanciones.filter((s) => s.estado === 'aplicada').length, [sanciones]);
  const totalApeladas = useMemo(() => sanciones.filter((s) => s.estado === 'apelada').length, [sanciones]);
  const totalPagadas = useMemo(() => sanciones.filter((s) => s.estado === 'pagada').length, [sanciones]);

  async function confirmarTransicion() {
    if (!confirmacion) return;
    setProcesando(true);
    try {
      await aplicarTransicion(confirmacion.sancion, confirmacion.transicion);
    } finally {
      setProcesando(false);
      setConfirmacion(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {error && (
        <Alert variant="danger" title="Error">
          {error}
        </Alert>
      )}

      {/* Selector de Sindicato (admin_quivo) */}
      {user?.rol === 'admin_quivo' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            padding: '0.85rem 1.15rem',
            background: 'var(--qv-surface-glass)',
            backdropFilter: 'blur(20px)',
            borderRadius: 'var(--qv-radius-xl)',
            border: '1px solid var(--qv-border-glass)',
            boxShadow: 'var(--qv-shadow-sm)',
          }}
        >
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '2.25rem',
              height: '2.25rem',
              borderRadius: 'var(--qv-radius-lg)',
              backgroundColor: 'color-mix(in srgb, var(--qv-color-primary) 12%, var(--qv-surface-card))',
              color: 'var(--qv-color-primary)',
              flexShrink: 0,
            }}
          >
            <Building2 size={18} />
          </span>
          <div style={{ flex: '1 1 18rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--qv-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Sindicato Operativo
            </span>
            <Select
              id="sindicato-selector"
              aria-label="Seleccionar sindicato"
              options={[{ label: 'Seleccionar sindicato...', value: '' }, ...sindicatoOptions]}
              value={sindicatoSeleccionado}
              onChange={(e) => {
                setSindicatoSeleccionado(e.target.value);
                setFiltroEstado('');
                setFiltroReglaId('');
                setFiltrosAplicados(FILTROS_SANCIONES_VACIOS);
                setModalNueva(false);
              }}
            />
          </div>
        </div>
      )}

      {user?.rol === 'admin_quivo' && !sindicatoId && (
        <Alert variant="info" title="Selecciona un sindicato">
          Elige un sindicato para consultar sus sanciones registradas o emitir una nueva.
        </Alert>
      )}

      {sindicatoId && (
        <>
          {/* Métricas KPI de Sanciones */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(13.5rem, 1fr))',
              gap: '0.875rem',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.875rem',
                padding: '0.9rem 1.15rem',
                background: 'var(--qv-surface-glass)',
                backdropFilter: 'blur(24px) saturate(190%)',
                WebkitBackdropFilter: 'blur(24px) saturate(190%)',
                borderRadius: 'var(--qv-radius-xl)',
                border: '1px solid var(--qv-border-glass)',
                boxShadow: 'var(--qv-shadow-sm)',
              }}
            >
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '2.6rem',
                  height: '2.6rem',
                  borderRadius: 'var(--qv-radius-lg)',
                  backgroundColor: 'color-mix(in srgb, var(--qv-color-warning) 14%, var(--qv-surface-card))',
                  color: 'var(--qv-color-warning)',
                  boxShadow: '0 0 12px color-mix(in srgb, var(--qv-color-warning) 25%, transparent)',
                  flexShrink: 0,
                }}
              >
                <Clock size={19} />
              </span>
              <div>
                <span style={{ fontSize: '0.72rem', color: 'var(--qv-text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Pendientes de Revisión
                </span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', marginTop: '0.2rem' }}>
                  <strong style={{ fontSize: '1.25rem', color: '#ffffff', fontWeight: 800 }}>
                    {totalPendientes}
                  </strong>
                  <span style={{ fontSize: '0.78rem', color: 'var(--qv-text-secondary)', fontWeight: 500 }}>
                    por confirmar
                  </span>
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.875rem',
                padding: '0.9rem 1.15rem',
                background: 'var(--qv-surface-glass)',
                backdropFilter: 'blur(24px) saturate(190%)',
                WebkitBackdropFilter: 'blur(24px) saturate(190%)',
                borderRadius: 'var(--qv-radius-xl)',
                border: '1px solid var(--qv-border-glass)',
                boxShadow: 'var(--qv-shadow-sm)',
              }}
            >
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '2.6rem',
                  height: '2.6rem',
                  borderRadius: 'var(--qv-radius-lg)',
                  backgroundColor: 'color-mix(in srgb, var(--qv-color-danger) 14%, var(--qv-surface-card))',
                  color: 'var(--qv-color-danger)',
                  boxShadow: '0 0 12px color-mix(in srgb, var(--qv-color-danger) 25%, transparent)',
                  flexShrink: 0,
                }}
              >
                <AlertCircle size={19} />
              </span>
              <div>
                <span style={{ fontSize: '0.72rem', color: 'var(--qv-text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Sanciones Aplicadas
                </span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', marginTop: '0.2rem' }}>
                  <strong style={{ fontSize: '1.25rem', color: '#ffffff', fontWeight: 800 }}>
                    {totalAplicadas}
                  </strong>
                  <span style={{ fontSize: '0.78rem', color: 'var(--qv-text-secondary)', fontWeight: 500 }}>
                    en curso
                  </span>
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.875rem',
                padding: '0.9rem 1.15rem',
                background: 'var(--qv-surface-glass)',
                backdropFilter: 'blur(24px) saturate(190%)',
                WebkitBackdropFilter: 'blur(24px) saturate(190%)',
                borderRadius: 'var(--qv-radius-xl)',
                border: '1px solid var(--qv-border-glass)',
                boxShadow: 'var(--qv-shadow-sm)',
              }}
            >
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '2.6rem',
                  height: '2.6rem',
                  borderRadius: 'var(--qv-radius-lg)',
                  backgroundColor: 'color-mix(in srgb, var(--qv-color-accent) 14%, var(--qv-surface-card))',
                  color: 'var(--qv-color-accent)',
                  boxShadow: '0 0 12px color-mix(in srgb, var(--qv-color-accent) 25%, transparent)',
                  flexShrink: 0,
                }}
              >
                <Scale size={19} />
              </span>
              <div>
                <span style={{ fontSize: '0.72rem', color: 'var(--qv-text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  En Apelación
                </span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', marginTop: '0.2rem' }}>
                  <strong style={{ fontSize: '1.25rem', color: '#ffffff', fontWeight: 800 }}>
                    {totalApeladas}
                  </strong>
                  <span style={{ fontSize: '0.78rem', color: 'var(--qv-text-secondary)', fontWeight: 500 }}>
                    en tribunal
                  </span>
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.875rem',
                padding: '0.9rem 1.15rem',
                background: 'var(--qv-surface-glass)',
                backdropFilter: 'blur(24px) saturate(190%)',
                WebkitBackdropFilter: 'blur(24px) saturate(190%)',
                borderRadius: 'var(--qv-radius-xl)',
                border: '1px solid var(--qv-border-glass)',
                boxShadow: 'var(--qv-shadow-sm)',
              }}
            >
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '2.6rem',
                  height: '2.6rem',
                  borderRadius: 'var(--qv-radius-lg)',
                  backgroundColor: 'color-mix(in srgb, var(--qv-color-success) 14%, var(--qv-surface-card))',
                  color: 'var(--qv-color-success)',
                  boxShadow: '0 0 12px color-mix(in srgb, var(--qv-color-success) 25%, transparent)',
                  flexShrink: 0,
                }}
              >
                <CheckCircle2 size={19} />
              </span>
              <div>
                <span style={{ fontSize: '0.72rem', color: 'var(--qv-text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Pagadas / Cumplidas
                </span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', marginTop: '0.2rem' }}>
                  <strong style={{ fontSize: '1.25rem', color: '#ffffff', fontWeight: 800 }}>
                    {totalPagadas}
                  </strong>
                  <span style={{ fontSize: '0.78rem', color: 'var(--qv-text-secondary)', fontWeight: 500 }}>
                    regularizadas
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Barra de Filtros y Acción Superpuesta */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              flexWrap: 'wrap',
              padding: '0.85rem 1.15rem',
              backgroundColor: 'var(--qv-surface-glass)',
              backdropFilter: 'blur(24px) saturate(180%)',
              border: '1px solid var(--qv-border-glass)',
              borderRadius: 'var(--qv-radius-xl)',
              boxShadow: 'var(--qv-shadow-sm)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', flex: '1 1 auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--qv-text-secondary)', fontSize: '0.8125rem', fontWeight: 600 }}>
                <Filter size={15} style={{ color: 'var(--qv-color-primary)' }} />
                <span>Filtros:</span>
              </div>

              <div style={{ minWidth: '11rem' }}>
                <Select
                  id="filtro-estado"
                  aria-label="Estado de sanción"
                  placeholder="Todos los estados"
                  options={[
                    { label: 'Todos los estados', value: '' },
                    { label: 'Pendiente', value: 'pendiente' },
                    { label: 'Aplicada', value: 'aplicada' },
                    { label: 'Apelada', value: 'apelada' },
                    { label: 'Pagada', value: 'pagada' },
                    { label: 'Anulada', value: 'anulada' },
                  ]}
                  value={filtroEstado}
                  onChange={(e) => setFiltroEstado(e.target.value)}
                />
              </div>

              <div style={{ minWidth: '14rem' }}>
                <Select
                  id="filtro-regla"
                  aria-label="Regla infringida"
                  placeholder="Todas las reglas"
                  options={[
                    { label: 'Todas las reglas', value: '' },
                    ...reglas.map((r) => ({ label: `${r.nombre} (${r.gravedad})`, value: r.id })),
                  ]}
                  value={filtroReglaId}
                  onChange={(e) => setFiltroReglaId(e.target.value)}
                />
              </div>

              <Button size="sm" onClick={aplicarFiltros}>
                Aplicar filtros
              </Button>

              {(filtroEstado || filtroReglaId) && (
                <Button size="sm" variant="ghost" onClick={limpiarFiltros}>
                  Limpiar filtros
                </Button>
              )}
            </div>

            <button
              type="button"
              className="qv-floating-cta"
              onClick={() => setModalNueva(true)}
            >
              <Plus size={16} />
              <span>Nueva sanción</span>
            </button>
          </div>

          {/* Listado de Sanciones en Tabla Glassmorphic */}
          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center' }}>
              <Loader label="Cargando historial de sanciones..." />
            </div>
          ) : sanciones.length === 0 ? (
            <Card>
              <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--qv-text-muted)' }}>
                <ShieldAlert size={32} style={{ margin: '0 auto 0.75rem', opacity: 0.5 }} />
                <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--qv-text-secondary)', margin: '0 0 0.25rem 0' }}>
                  Sin sanciones registradas
                </p>
                <span style={{ fontSize: '0.8125rem' }}>
                  No se encontraron sanciones para los filtros seleccionados.
                </span>
              </div>
            </Card>
          ) : (
            <div className="qv-table-container">
              <table className="qv-table">
                <thead>
                  <tr>
                    <th>Fecha del hecho</th>
                    <th>Regla e Infracción</th>
                    <th>Sujeto Infractor</th>
                    <th>Motivo de la Sanción</th>
                    <th>Estado</th>
                    <th style={{ textAlign: 'right' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {sanciones.map((s) => {
                    const regla = reglaPorId.get(s.reglaId);
                    const vehiculo = s.sujetoTipo === 'vehiculo' ? vehiculoPorId.get(s.sujetoId) : undefined;
                    const conductor = s.sujetoTipo === 'conductor' ? conductorPorId.get(s.sujetoId) : undefined;
                    const socio = s.sujetoTipo === 'socio' ? socioPorId.get(s.sujetoId) : undefined;

                    return (
                      <tr key={s.id} role="row">
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8125rem' }}>
                            <Calendar size={14} style={{ color: 'var(--qv-color-primary)' }} />
                            <span style={{ fontWeight: 600, color: '#ffffff' }}>{formatearFecha(s.fechaHecho)}</span>
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                            <strong style={{ fontSize: '0.875rem', color: '#ffffff' }}>
                              {regla?.nombre ?? s.reglaId}
                            </strong>
                            {regla && (
                              <div>
                                <GravedadBadge gravedad={regla.gravedad} />
                              </div>
                            )}
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {s.sujetoTipo === 'vehiculo' ? (
                              <>
                                <Bus size={15} style={{ color: 'var(--qv-color-primary)', flexShrink: 0 }} />
                                <div>
                                  {vehiculo ? (
                                    <PlateBadge plate={vehiculo.placaNormalizada ?? vehiculo.placa} />
                                  ) : (
                                    <span style={{ color: '#ffffff', fontWeight: 600 }}>{s.sujetoId}</span>
                                  )}
                                </div>
                              </>
                            ) : s.sujetoTipo === 'conductor' ? (
                              <>
                                <User size={15} style={{ color: 'var(--qv-color-primary)', flexShrink: 0 }} />
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                  <strong style={{ fontSize: '0.8125rem', color: '#ffffff' }}>
                                    {conductor?.nombre ?? s.sujetoId}
                                  </strong>
                                  <span style={{ fontSize: '0.7rem', color: 'var(--qv-text-secondary)', fontWeight: 600 }}>
                                    Conductor
                                  </span>
                                </div>
                              </>
                            ) : (
                              <>
                                <Users size={15} style={{ color: 'var(--qv-color-primary)', flexShrink: 0 }} />
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                  <strong style={{ fontSize: '0.8125rem', color: '#ffffff' }}>
                                    {socio?.nombre ?? s.sujetoId}
                                  </strong>
                                  <span style={{ fontSize: '0.7rem', color: 'var(--qv-text-secondary)', fontWeight: 600 }}>
                                    Socio
                                  </span>
                                </div>
                              </>
                            )}
                          </div>
                        </td>
                        <td>
                          <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--qv-text-secondary)', maxWidth: '24rem', lineHeight: 1.4 }}>
                            {s.motivo}
                          </p>
                        </td>
                        <td>
                          <StatusBadge
                            circle
                            status={ESTADO_SANCION_BADGE[s.estado]}
                            label={`Estado: ${s.estado.toUpperCase()}`}
                          />
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div className="qv-table-actions-capsule">
                            <Tooltip content="Ver detalle de la sanción">
                              <button
                                type="button"
                                className="qv-action-pill-btn"
                                onClick={() => setDetalleSancion(s)}
                                aria-label="Ver detalle"
                              >
                                <Eye size={13} />
                              </button>
                            </Tooltip>
                            {TRANSICIONES_POR_ESTADO[s.estado].map((t) => {
                              const IconComponent = ICONO_TRANSICION[t];
                              return (
                                <Fragment key={t}>
                                  <span className="qv-action-pill-divider" />
                                  <Tooltip content={LABEL_TRANSICION[t]}>
                                    <button
                                      type="button"
                                      className={`qv-action-pill-btn${t === 'anular' ? ' qv-action-pill-btn--danger' : ''}`}
                                      onClick={() => setConfirmacion({ sancion: s, transicion: t })}
                                      aria-label={LABEL_TRANSICION[t]}
                                    >
                                      <IconComponent size={13} />
                                    </button>
                                  </Tooltip>
                                </Fragment>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {hasMore && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '0.5rem' }}>
              <Button variant="secondary" onClick={cargarMas} disabled={cargandoMas}>
                {cargandoMas ? 'Cargando más sanciones...' : 'Cargar más registros'}
              </Button>
            </div>
          )}
        </>
      )}

      {/* Modal de Detalle Completo de la Sanción */}
      <Modal
        open={detalleSancion !== null}
        title={detalleSancion ? `Expediente de Sanción — #${detalleSancion.id.slice(-6).toUpperCase()}` : ''}
        onClose={() => setDetalleSancion(null)}
      >
        {detalleSancion && (() => {
          const regla = reglaPorId.get(detalleSancion.reglaId);
          const vehiculo = vehiculoPorId.get(detalleSancion.sujetoId);
          const conductor = conductorPorId.get(detalleSancion.sujetoId);
          const socio = socioPorId.get(detalleSancion.sujetoId);

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Resumen Superior: Regla, Gravedad y Estado */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                  padding: '0.75rem 1rem',
                  borderRadius: 'var(--qv-radius-lg)',
                  backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                  border: '1px solid var(--qv-border-glass)',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Scale size={16} style={{ color: 'var(--qv-color-primary)', flexShrink: 0 }} />
                  <strong style={{ fontSize: '0.9375rem', color: '#ffffff' }}>
                    {regla?.nombre ?? detalleSancion.reglaId}
                  </strong>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {regla && <GravedadBadge gravedad={regla.gravedad} />}
                  <StatusBadge
                    circle
                    status={ESTADO_SANCION_BADGE[detalleSancion.estado]}
                    label={detalleSancion.estado.toUpperCase()}
                  />
                </div>
              </div>

              {/* Fichas Informativas: Sujeto y Fecha */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '0.75rem' }}>
                <div
                  style={{
                    padding: '0.65rem 0.85rem',
                    borderRadius: 'var(--qv-radius-md)',
                    backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                    border: '1px solid var(--qv-border-glass)',
                  }}
                >
                  <span style={{ fontSize: '0.6875rem', color: 'var(--qv-text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Sujeto Sancionado
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                    {detalleSancion.sujetoTipo === 'vehiculo' ? (
                      <>
                        <Bus size={15} style={{ color: 'var(--qv-color-primary)', flexShrink: 0 }} />
                        {vehiculo ? (
                          <PlateBadge plate={vehiculo.placaNormalizada ?? vehiculo.placa} />
                        ) : (
                          <strong style={{ color: '#ffffff', fontSize: '0.8125rem' }}>{detalleSancion.sujetoId}</strong>
                        )}
                      </>
                    ) : detalleSancion.sujetoTipo === 'conductor' ? (
                      <>
                        <User size={15} style={{ color: 'var(--qv-color-primary)', flexShrink: 0 }} />
                        <strong style={{ color: '#ffffff', fontSize: '0.8125rem' }}>{conductor?.nombre ?? detalleSancion.sujetoId}</strong>
                      </>
                    ) : (
                      <>
                        <Users size={15} style={{ color: 'var(--qv-color-primary)', flexShrink: 0 }} />
                        <strong style={{ color: '#ffffff', fontSize: '0.8125rem' }}>{socio?.nombre ?? detalleSancion.sujetoId}</strong>
                      </>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    padding: '0.65rem 0.85rem',
                    borderRadius: 'var(--qv-radius-md)',
                    backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                    border: '1px solid var(--qv-border-glass)',
                  }}
                >
                  <span style={{ fontSize: '0.6875rem', color: 'var(--qv-text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Fecha y Registro
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginTop: '0.25rem' }}>
                    <Calendar size={14} style={{ color: 'var(--qv-color-primary)' }} />
                    <strong style={{ color: '#ffffff', fontSize: '0.8125rem' }}>
                      {formatearFecha(detalleSancion.fechaHecho)}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Motivo de la Sanción */}
              <div
                style={{
                  padding: '0.75rem 0.85rem',
                  borderRadius: 'var(--qv-radius-md)',
                  backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                  border: '1px solid var(--qv-border-glass)',
                }}
              >
                <span style={{ fontSize: '0.6875rem', color: 'var(--qv-text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Motivo / Descripción de la Infracción
                </span>
                <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.8125rem', color: '#ffffff', lineHeight: 1.45 }}>
                  {detalleSancion.motivo}
                </p>
              </div>

              {/* Evidencia / Referencia si existe */}
              {detalleSancion.evidenciaRef && (
                <div
                  style={{
                    padding: '0.75rem 0.85rem',
                    borderRadius: 'var(--qv-radius-md)',
                    backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                    border: '1px solid var(--qv-border-glass)',
                  }}
                >
                  <span style={{ fontSize: '0.6875rem', color: 'var(--qv-text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Referencia de Evidencia / Telemetría
                  </span>
                  <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.8125rem', color: '#38bdf8', fontFamily: 'monospace' }}>
                    {detalleSancion.evidenciaRef}
                  </p>
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      <ConfirmDialog
        open={confirmacion !== null}
        title={confirmacion ? `${LABEL_TRANSICION[confirmacion.transicion]} sanción` : ''}
        message={
          confirmacion?.transicion === 'anular'
            ? 'La sanción quedará anulada formalmente y no podrá volver a modificarse.'
            : confirmacion?.transicion === 'pagar'
              ? 'La sanción quedará registrada como pagada / regularizada.'
              : confirmacion?.transicion === 'apelar'
                ? 'La sanción pasará al tribunal sindical para revisión de la apelación.'
                : 'La sanción quedará aplicada y en curso de cumplimiento.'
        }
        variant={confirmacion?.transicion === 'anular' ? 'danger' : 'primary'}
        confirmLabel={procesando ? 'Procesando...' : 'Confirmar'}
        onConfirm={confirmarTransicion}
        onCancel={() => setConfirmacion(null)}
      />

      {sindicatoId && modalNueva && (
        <NuevaSancionModal
          token={token}
          sindicatoId={sindicatoId}
          reglas={reglas}
          vehiculos={vehiculos}
          conductores={conductores}
          socios={socios}
          onClose={() => setModalNueva(false)}
          onCreada={() => {
            setModalNueva(false);
            void refrescar();
          }}
        />
      )}
    </div>
  );
}

function formatearFecha(fecha: Date): string {
  return new Date(fecha).toLocaleDateString('es-BO', { timeZone: 'UTC' });
}

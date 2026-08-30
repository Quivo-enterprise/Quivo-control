'use client';

import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  Input,
  Loader,
  PageHeader,
  PlateBadge,
  Select,
  StatusBadge,
} from '@quivo/design-system';
import type { Asignacion, EstadoRotacion, Turno } from '@quivo/shared';
import {
  Building2,
  Calendar,
  CalendarDays,
  Clock,
  Moon,
  Plus,
  Route,
  Sparkles,
  Sun,
  Sunrise,
  User,
  Users,
} from 'lucide-react';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { useSindicatoOptions } from '../../../src/lib/api/use-sindicato-options';
import { useRotaciones } from './use-rotaciones';
import { etiquetaHorario, rangoDeFechas } from './rotacion-constants';
import { AsignacionModal } from './asignacion-modal';
import { NuevaAsignacionModal } from './nueva-asignacion-modal';
import { GenerarRotacionModal } from './generar-rotacion-modal';

interface EdicionAsignacion {
  asignacion: Asignacion;
}

interface FiltrosRotaciones {
  periodo: string;
  estado: EstadoRotacion | '';
}

const FILTROS_ROTACIONES_VACIOS: FiltrosRotaciones = { periodo: '', estado: '' };

function capitalizar(texto: string): string {
  if (!texto) return '';
  return texto.charAt(0).toUpperCase() + texto.slice(1).toLowerCase();
}

export default function RotacionesPage() {
  const { token, user } = useAuth();
  const { options: sindicatoOptions } = useSindicatoOptions();

  const [sindicatoSeleccionado, setSindicatoSeleccionado] = useState('');
  const sindicatoId =
    user?.rol === 'admin_quivo' ? sindicatoSeleccionado : (user?.sindicatoId ?? '');

  const data = useRotaciones(token, sindicatoId);

  const [filtrosRotaciones, setFiltrosRotaciones] =
    useState<FiltrosRotaciones>(FILTROS_ROTACIONES_VACIOS);
  const [filtrosRotacionesAplicados, setFiltrosRotacionesAplicados] =
    useState<FiltrosRotaciones>(FILTROS_ROTACIONES_VACIOS);

  const [confirmacion, setConfirmacion] = useState<'publicar' | 'anular' | null>(null);
  const [modalAsignacion, setModalAsignacion] = useState<EdicionAsignacion | null>(null);
  const [modalNuevaAsignacion, setModalNuevaAsignacion] = useState(false);
  const [modalGenerador, setModalGenerador] = useState(false);

  const vehiculoPorId = useMemo(
    () => new Map(data.vehiculos.map((v) => [v.id, v])),
    [data.vehiculos],
  );
  const rutaPorId = useMemo(() => new Map(data.rutas.map((r) => [r.id, r])), [data.rutas]);
  const conductorPorId = useMemo(
    () => new Map(data.conductores.map((c) => [c.id, c])),
    [data.conductores],
  );

  const rotacionesFiltradas = useMemo(() => {
    const periodoBuscado = filtrosRotacionesAplicados.periodo.trim().toLocaleLowerCase();
    return data.rotaciones.filter(
      (rotacion) =>
        (!periodoBuscado || rotacion.periodo.toLocaleLowerCase().includes(periodoBuscado)) &&
        (!filtrosRotacionesAplicados.estado ||
          rotacion.estado === filtrosRotacionesAplicados.estado),
    );
  }, [filtrosRotacionesAplicados, data.rotaciones]);

  function seleccionarSindicato(siguienteSindicatoId: string) {
    setSindicatoSeleccionado(siguienteSindicatoId);
    data.reset();
    setConfirmacion(null);
    setModalAsignacion(null);
    setModalNuevaAsignacion(false);
    setModalGenerador(false);
    setFiltrosRotaciones(FILTROS_ROTACIONES_VACIOS);
    setFiltrosRotacionesAplicados(FILTROS_ROTACIONES_VACIOS);
  }

  function aplicarFiltrosRotaciones() {
    setFiltrosRotacionesAplicados({ ...filtrosRotaciones });
  }

  function limpiarFiltrosRotaciones() {
    setFiltrosRotaciones(FILTROS_ROTACIONES_VACIOS);
    setFiltrosRotacionesAplicados(FILTROS_ROTACIONES_VACIOS);
  }

  async function handleEjecutarGeneracion(params: {
    periodo: string;
    fechaInicio: string;
    fechaFin: string;
    horarios: Turno[];
    rutasSeleccionadas: string[];
  }) {
    await data.generarRotacion(
      {
        esAdminQuivo: user?.rol === 'admin_quivo',
        periodo: params.periodo,
        fechas: rangoDeFechas(params.fechaInicio, params.fechaFin),
        rutaIds: params.rutasSeleccionadas,
        horarios: params.horarios,
      },
      () => {
        setFiltrosRotaciones(FILTROS_ROTACIONES_VACIOS);
        setFiltrosRotacionesAplicados(FILTROS_ROTACIONES_VACIOS);
        setModalGenerador(false);
      },
    );
  }

  async function confirmarPublicarOAnular() {
    if (!data.rotacionActual || !confirmacion) return;
    if (confirmacion === 'publicar') {
      await data.publicar(data.rotacionActual.id);
    } else {
      await data.anular(data.rotacionActual.id);
    }
    setConfirmacion(null);
  }

  const columnasGrilla = useMemo(() => {
    if (!data.rotacionActual) return [];
    const claves = new Map<string, { fecha: string; horario: Turno }>();
    for (const asignacion of data.rotacionActual.asignaciones) {
      const fecha = new Date(asignacion.fecha).toISOString().slice(0, 10);
      claves.set(`${fecha}|${asignacion.horario}`, { fecha, horario: asignacion.horario });
    }
    return [...claves.values()].sort(
      (a, b) => a.fecha.localeCompare(b.fecha) || a.horario.localeCompare(b.horario),
    );
  }, [data.rotacionActual]);

  const filasGrilla = useMemo(() => {
    if (!data.rotacionActual) return [];
    const vehiculoIds = [...new Set(data.rotacionActual.asignaciones.map((a) => a.vehiculoId))];
    return vehiculoIds.sort((a, b) =>
      (vehiculoPorId.get(a)?.placa ?? '').localeCompare(vehiculoPorId.get(b)?.placa ?? ''),
    );
  }, [data.rotacionActual, vehiculoPorId]);

  const totalConductoresAsignados = useMemo(() => {
    if (!data.rotacionActual) return 0;
    const condIds = new Set(
      data.rotacionActual.asignaciones.map((a) => a.conductorId).filter(Boolean),
    );
    return condIds.size;
  }, [data.rotacionActual]);

  const totalRutasAsignadas = useMemo(() => {
    if (!data.rotacionActual) return 0;
    const rIds = new Set(data.rotacionActual.asignaciones.map((a) => a.rutaId).filter(Boolean));
    return rIds.size;
  }, [data.rotacionActual]);

  function celda(vehiculoId: string, fecha: string, horario: Turno): Asignacion | undefined {
    return data.rotacionActual?.asignaciones.find(
      (a) =>
        a.vehiculoId === vehiculoId &&
        new Date(a.fecha).toISOString().slice(0, 10) === fecha &&
        a.horario === horario,
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader
        title="Planificación y Rotación de Turnos"
        subtitle="Administra y publica el cronograma operativo de horarios, recorridos y conductores asignados a la flota."
        actions={
          sindicatoId ? (
            <button
              type="button"
              className="qv-floating-cta"
              onClick={() => setModalGenerador(true)}
            >
              <Sparkles size={16} />
              <span>Nueva rotación asistida</span>
            </button>
          ) : undefined
        }
      />

      {data.error && (
        <Alert variant="danger" title="Error">
          {data.error}
        </Alert>
      )}
      {data.avisoGeneracion && (
        <Alert variant="warning" title="Reparto parcial">
          {data.avisoGeneracion}
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
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--qv-text-muted)', textTransform: 'uppercase' }}>
              Sindicato Activo
            </span>
            <Select
              id="sindicato"
              name="sindicato"
              aria-label="Seleccionar sindicato"
              options={[{ label: 'Seleccionar sindicato...', value: '' }, ...sindicatoOptions]}
              value={sindicatoSeleccionado}
              onChange={(event) => seleccionarSindicato(event.target.value)}
            />
          </div>
        </div>
      )}

      {user?.rol === 'admin_quivo' && !sindicatoId && (
        <Alert variant="info" title="Selecciona un sindicato">
          Elige una organización de transporte para consultar o generar sus rotaciones operativas.
        </Alert>
      )}

      {sindicatoId && (
        <>
          {/* Tira de Resumen Operativo / KPIs del Cronograma */}
          {data.rotacionActual && (
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
                    backgroundColor: 'color-mix(in srgb, var(--qv-color-primary) 14%, var(--qv-surface-card))',
                    color: 'var(--qv-color-primary)',
                    boxShadow: '0 0 12px color-mix(in srgb, var(--qv-color-primary) 25%, transparent)',
                    flexShrink: 0,
                  }}
                >
                  <CalendarDays size={19} />
                </span>
                <div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--qv-text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Período Seleccionado
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.2rem' }}>
                    <strong style={{ fontSize: '1.05rem', color: '#ffffff', letterSpacing: '0.02em' }}>
                      {data.rotacionActual.periodo}
                    </strong>
                    <StatusBadge
                      status={data.rotacionActual.estado === 'publicada' ? 'active' : 'pending'}
                      label={data.rotacionActual.estado}
                    />
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
                  <Route size={19} />
                </span>
                <div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--qv-text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Vehículos Programados
                  </span>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', marginTop: '0.2rem' }}>
                    <strong style={{ fontSize: '1.25rem', color: '#ffffff', fontWeight: 800 }}>
                      {filasGrilla.length}
                    </strong>
                    <span style={{ fontSize: '0.78rem', color: 'var(--qv-text-secondary)', fontWeight: 500 }}>
                      unidades en turno
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
                    Turnos / Asignaciones
                  </span>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', marginTop: '0.2rem' }}>
                    <strong style={{ fontSize: '1.25rem', color: '#ffffff', fontWeight: 800 }}>
                      {data.rotacionActual.asignaciones.length}
                    </strong>
                    <span style={{ fontSize: '0.78rem', color: 'var(--qv-text-secondary)', fontWeight: 500 }}>
                      slots cubiertos
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
                  <Users size={19} />
                </span>
                <div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--qv-text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Conductores Asignados
                  </span>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', marginTop: '0.2rem' }}>
                    <strong style={{ fontSize: '1.25rem', color: '#ffffff', fontWeight: 800 }}>
                      {totalConductoresAsignados}
                    </strong>
                    <span style={{ fontSize: '0.78rem', color: 'var(--qv-text-secondary)', fontWeight: 500 }}>
                      en {totalRutasAsignadas} rutas
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Espacio de Trabajo: Catálogo de Períodos + Matriz Interactiva */}
          <div className="qv-rotaciones-workspace">
            {/* Panel Izquierdo: Catálogo y Filtros de Periodos */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <Card header="Catálogo de Períodos">
                {data.loadingRotaciones ? (
                  <Loader label="Cargando cronogramas..." />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <Input
                      label="Buscar por período"
                      placeholder="Ej. 2026-08"
                      value={filtrosRotaciones.periodo}
                      onChange={(event) =>
                        setFiltrosRotaciones((actual) => ({ ...actual, periodo: event.target.value }))
                      }
                    />
                    <Select
                      label="Estado"
                      options={[
                        { label: 'Todos los estados', value: '' },
                        { label: 'Borrador', value: 'borrador' },
                        { label: 'Publicada', value: 'publicada' },
                      ]}
                      value={filtrosRotaciones.estado}
                      onChange={(event) =>
                        setFiltrosRotaciones((actual) => ({
                          ...actual,
                          estado: event.target.value as EstadoRotacion | '',
                        }))
                      }
                    />
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <Button size="sm" onClick={aplicarFiltrosRotaciones}>
                        Aplicar filtros
                      </Button>
                      <Button size="sm" variant="ghost" onClick={limpiarFiltrosRotaciones}>
                        Limpiar filtros
                      </Button>
                    </div>

                    <div style={{ margin: '0.5rem 0 0.25rem', fontSize: '0.72rem', fontWeight: 700, color: 'var(--qv-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Cronogramas ({rotacionesFiltradas.length})
                    </div>

                    {rotacionesFiltradas.length === 0 ? (
                      <span style={{ fontSize: '0.8125rem', color: 'var(--qv-text-muted)' }}>
                        {data.rotaciones.length === 0
                          ? 'Sin rotaciones todavía.'
                          : 'No hay rotaciones que coincidan con los filtros aplicados.'}
                      </span>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '24rem', overflowY: 'auto' }}>
                        {rotacionesFiltradas.map((r) => {
                          const activa = r.id === data.rotacionActual?.id;
                          return (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => data.setRotacionActual(r)}
                              className={`qv-rotacion-catalog-card${activa ? ' qv-rotacion-catalog-card--active' : ''}`}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <strong style={{ color: '#ffffff', fontSize: '0.875rem' }}>
                                  {r.periodo}
                                </strong>
                                <StatusBadge
                                  status={r.estado === 'publicada' ? 'active' : 'pending'}
                                  label={r.estado}
                                />
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--qv-text-secondary)' }}>
                                <span>{r.asignaciones.length} asignaciones</span>
                                <span>{new Set(r.asignaciones.map((a) => a.vehiculoId)).size} unidades</span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <div style={{ borderTop: '1px solid var(--qv-border-glass)', paddingTop: '0.75rem', marginTop: '0.25rem' }}>
                      <Button
                        size="sm"
                        variant="ghost"
                        style={{ width: '100%', justifyContent: 'center' }}
                        onClick={() => setModalGenerador(true)}
                      >
                        <Sparkles size={14} style={{ marginRight: '6px' }} />
                        + Generar nuevo período
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            </div>

            {/* Panel Derecho: Matriz Visual de Asignaciones */}
            <Card
              header={data.rotacionActual ? `Rotación ${data.rotacionActual.periodo}` : 'Rotación'}
              footer={
                data.rotacionActual ? (
                  <div style={{ display: 'flex', gap: '0.625rem', justifyContent: 'flex-end', flexWrap: 'wrap', width: '100%' }}>
                    {data.rotacionActual.estado === 'borrador' && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setModalNuevaAsignacion(true)}>
                          <Plus size={14} style={{ marginRight: '4px' }} />
                          + Agregar asignación
                        </Button>
                        <Button
                          size="sm"
                          variant="accent"
                          onClick={() => setConfirmacion('publicar')}
                          disabled={data.procesando}
                        >
                          Publicar
                        </Button>
                      </>
                    )}
                    {data.rotacionActual.estado === 'publicada' && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => setConfirmacion('anular')}
                        disabled={data.procesando}
                      >
                        Anular
                      </Button>
                    )}
                  </div>
                ) : undefined
              }
            >
              {!data.rotacionActual ? (
                <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--qv-text-muted)' }}>
                  <Calendar size={36} style={{ margin: '0 auto 0.75rem', opacity: 0.4 }} />
                  <p style={{ fontSize: '0.9375rem' }}>Elegí una rotación de la lista o generá una nueva.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                      <StatusBadge
                        status={data.rotacionActual.estado === 'publicada' ? 'active' : 'pending'}
                        label={data.rotacionActual.estado}
                      />
                      <span style={{ fontSize: '0.8125rem', color: 'var(--qv-text-secondary)' }}>
                        {data.rotacionActual.estado === 'borrador'
                          ? 'Modo borrador — haz clic en cualquier celda para editar ruta o conductor.'
                          : 'Publicada y activa — sincronizada con las apps móviles.'}
                      </span>
                    </div>
                  </div>

                  {filasGrilla.length === 0 ? (
                    <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--qv-text-muted)' }}>
                      <span>Esta rotación no tiene asignaciones.</span>
                    </div>
                  ) : (
                    <div className="qv-rotacion-matrix-wrapper">
                      <table className="qv-rotacion-matrix-table">
                        <thead>
                          <tr>
                            <th className="qv-rotacion-matrix-th" style={{ textAlign: 'left', minWidth: '10.5rem', paddingLeft: '1rem' }}>
                              Vehículo
                            </th>
                            {columnasGrilla.map((col) => {
                              const ShiftIcon =
                                col.horario === 'manana'
                                  ? Sunrise
                                  : col.horario === 'tarde'
                                    ? Sun
                                    : Moon;
                              const iconColor =
                                col.horario === 'manana'
                                  ? '#f59e0b'
                                  : col.horario === 'tarde'
                                    ? '#f97316'
                                    : '#818cf8';
                              return (
                                <th key={`${col.fecha}|${col.horario}`} className="qv-rotacion-matrix-th">
                                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
                                    <span style={{ fontSize: '0.72rem', color: 'var(--qv-text-secondary)', fontFamily: 'monospace' }}>
                                      {col.fecha}
                                    </span>
                                    <span
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.35rem',
                                        fontSize: '0.8125rem',
                                        color: '#ffffff',
                                        fontWeight: 700,
                                      }}
                                    >
                                      <ShiftIcon size={14} style={{ color: iconColor }} />
                                      <span>{etiquetaHorario(col.horario)}</span>
                                    </span>
                                  </div>
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {filasGrilla.map((vehiculoId) => {
                            const vehiculo = vehiculoPorId.get(vehiculoId);
                            return (
                              <tr key={vehiculoId}>
                                <td className="qv-rotacion-matrix-td" style={{ paddingLeft: '1rem' }}>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                    {vehiculo ? (
                                      <PlateBadge plate={vehiculo.placaNormalizada ?? vehiculo.placa} />
                                    ) : (
                                      <strong style={{ color: '#ffffff' }}>{vehiculoId}</strong>
                                    )}
                                    {vehiculo?.numeroInterno && (
                                      <small style={{ fontSize: '0.72rem', color: 'var(--qv-text-secondary)', fontWeight: 600 }}>
                                        Int. {vehiculo.numeroInterno}
                                      </small>
                                    )}
                                  </div>
                                </td>
                                {columnasGrilla.map((col) => {
                                  const asignacion = celda(vehiculoId, col.fecha, col.horario);
                                  const ruta = asignacion ? rutaPorId.get(asignacion.rutaId) : null;
                                  const conductor = asignacion?.conductorId ? conductorPorId.get(asignacion.conductorId) : null;
                                  const esBorrador = data.rotacionActual?.estado === 'borrador';

                                  return (
                                    <td key={`${col.fecha}|${col.horario}`} className="qv-rotacion-matrix-td">
                                      {asignacion ? (
                                        <button
                                          type="button"
                                          onClick={() => esBorrador && setModalAsignacion({ asignacion })}
                                          className={`qv-rotacion-slot-btn${!esBorrador ? ' qv-rotacion-slot-btn--readonly' : ''}`}
                                          title={esBorrador ? 'Clic para editar asignación' : undefined}
                                        >
                                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                            <span
                                              style={{
                                                width: '0.55rem',
                                                height: '0.55rem',
                                                borderRadius: '50%',
                                                backgroundColor: ruta?.linea.color ?? 'var(--qv-color-primary)',
                                                boxShadow: `0 0 6px ${ruta?.linea.color ?? 'var(--qv-color-primary)'}`,
                                                flexShrink: 0,
                                              }}
                                            />
                                            <strong style={{ fontSize: '0.8125rem', color: '#ffffff' }}>
                                              {ruta?.linea.codigo ?? ''} · {capitalizar(ruta?.sentido ?? asignacion.rutaId)}
                                            </strong>
                                          </div>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: conductor ? 'var(--qv-text-secondary)' : 'var(--qv-text-muted)' }}>
                                            <User size={12} style={{ color: conductor ? 'var(--qv-color-primary)' : 'inherit' }} />
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                              {conductor ? conductor.nombre : 'Sin conductor'}
                                            </span>
                                          </div>
                                        </button>
                                      ) : (
                                        <div style={{ textAlign: 'center', color: 'var(--qv-text-muted)', fontSize: '0.875rem' }}>
                                          —
                                        </div>
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      {/* Modal Guiado de Generación Asistida */}
      <GenerarRotacionModal
        open={modalGenerador}
        onClose={() => setModalGenerador(false)}
        rutas={data.rutas}
        generando={data.generando}
        onGenerar={handleEjecutarGeneracion}
      />

      {/* Dialogo de Confirmación para Publicar o Anular */}
      <ConfirmDialog
        open={confirmacion !== null}
        title={confirmacion === 'publicar' ? 'Publicar rotación' : 'Anular rotación'}
        message={
          confirmacion === 'publicar'
            ? 'Una vez publicada, esta rotación queda activa y disponible inmediatamente en las aplicaciones móviles de los conductores.'
            : 'La rotación volverá a estado de borrador y dejará de alimentar las aplicaciones móviles hasta que se publique nuevamente.'
        }
        variant={confirmacion === 'anular' ? 'danger' : 'primary'}
        confirmLabel={data.procesando ? 'Procesando...' : 'Confirmar'}
        onConfirm={confirmarPublicarOAnular}
        onCancel={() => setConfirmacion(null)}
      />

      {/* Modales de Asignación Individual */}
      {data.rotacionActual && modalAsignacion && (
        <AsignacionModal
          token={token}
          rotacion={data.rotacionActual}
          asignacion={modalAsignacion.asignacion}
          rutas={data.rutas}
          vehiculos={data.vehiculos}
          conductores={data.conductores}
          onClose={() => setModalAsignacion(null)}
          onGuardado={() => {
            setModalAsignacion(null);
            void data.refrescarRotacion(data.rotacionActual!.id);
          }}
        />
      )}

      {data.rotacionActual && modalNuevaAsignacion && (
        <NuevaAsignacionModal
          token={token}
          rotacion={data.rotacionActual}
          rutas={data.rutas}
          vehiculos={data.vehiculos}
          conductores={data.conductores}
          onClose={() => setModalNuevaAsignacion(false)}
          onGuardado={() => {
            setModalNuevaAsignacion(false);
            void data.refrescarRotacion(data.rotacionActual!.id);
          }}
        />
      )}
    </div>
  );
}

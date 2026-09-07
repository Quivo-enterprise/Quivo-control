'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Grid,
  Loader,
  MetricCard,
  PageHeader,
  Select,
} from '@quivo/design-system';
import type {
  AgrupacionActividad,
  AgrupacionCumplimiento,
  CumplimientoFila,
  EstadoSancion,
  SujetoTipo,
} from '@quivo/shared';
import {
  Activity,
  ArrowRight,
  Bus,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Filter,
  GitBranch,
  Route,
  TrendingUp,
} from 'lucide-react';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { reportesApi } from '../../../src/lib/api/reportes';
import { exportesApi } from '../../../src/lib/api/exportes';
import { ApiError } from '../../../src/lib/api/client';

const OPCIONES_ACTIVIDAD: { label: string; value: AgrupacionActividad }[] = [
  { label: 'Vehículo', value: 'vehiculo' },
  { label: 'Conductor', value: 'conductor' },
];

const OPCIONES_AGRUPACION: { label: string; value: AgrupacionCumplimiento }[] = [
  { label: 'Línea', value: 'linea' },
  { label: 'Vehículo', value: 'vehiculo' },
  { label: 'Ruta', value: 'ruta' },
];

const OPCIONES_ESTADO_SANCION: { label: string; value: EstadoSancion | '' }[] = [
  { label: 'Todos los estados', value: '' },
  { label: 'Pendiente', value: 'pendiente' },
  { label: 'Aplicada', value: 'aplicada' },
  { label: 'Anulada', value: 'anulada' },
  { label: 'Apelada', value: 'apelada' },
  { label: 'Pagada', value: 'pagada' },
];

const OPCIONES_SUJETO_SANCION: { label: string; value: SujetoTipo | '' }[] = [
  { label: 'Todos los sujetos', value: '' },
  { label: 'Vehículo', value: 'vehiculo' },
  { label: 'Conductor', value: 'conductor' },
  { label: 'Socio', value: 'socio' },
];

export default function ReportesPage() {
  return (
    <Suspense fallback={<Loader label="Cargando módulo de reportes..." />}>
      <ReportesContent />
    </Suspense>
  );
}

function ReportesContent() {
  const { token } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const porParam = (searchParams.get('por') as AgrupacionCumplimiento | null) ?? 'linea';
  const desdeParam = searchParams.get('desde') ?? '';
  const hastaParam = searchParams.get('hasta') ?? '';

  const [por, setPor] = useState<AgrupacionCumplimiento>(porParam);
  const [desde, setDesde] = useState(desdeParam);
  const [hasta, setHasta] = useState(hastaParam);

  useEffect(() => {
    setPor(porParam);
    setDesde(desdeParam);
    setHasta(hastaParam);
  }, [porParam, desdeParam, hastaParam]);

  const [filas, setFilas] = useState<CumplimientoFila[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [porActividad, setPorActividad] = useState<AgrupacionActividad>('vehiculo');
  const [estadoSancion, setEstadoSancion] = useState<EstadoSancion | ''>('');
  const [sujetoTipoSancion, setSujetoTipoSancion] = useState<SujetoTipo | ''>('');
  const [exportando, setExportando] = useState<string | null>(null);

  const rangoFechasInvalido = Boolean(desde && hasta && desde > hasta);

  useEffect(() => {
    if (!token) return;
    let cancelado = false;
    setLoading(true);
    setError(null);
    reportesApi
      .cumplimiento(token, {
        por: porParam,
        desde: desdeParam ? new Date(desdeParam) : undefined,
        hasta: hastaParam ? new Date(hastaParam) : undefined,
      })
      .then((rows) => {
        if (!cancelado) setFilas(rows);
      })
      .catch((err: unknown) => {
        if (!cancelado) setError(mensajeError(err));
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });
    return () => {
      cancelado = true;
    };
  }, [token, porParam, desdeParam, hastaParam]);

  const puntosTotales = filas.reduce((acc, f) => acc + f.puntosTotales, 0);
  const puntosCumplidos = filas.reduce((acc, f) => acc + f.puntosCumplidos, 0);
  const porcentajeGeneral = puntosTotales > 0 ? (puntosCumplidos / puntosTotales) * 100 : 0;
  const recorridosAsignados = filas.reduce((acc, f) => acc + f.recorridosAsignados, 0);
  const recorridosCompletados = filas.reduce((acc, f) => acc + f.recorridosCompletados, 0);

  const aplicarFiltros = useCallback(() => {
    if (rangoFechasInvalido) return;
    const usp = new URLSearchParams();
    usp.set('por', por);
    if (desde) usp.set('desde', desde);
    if (hasta) usp.set('hasta', hasta);
    router.replace(`/reportes?${usp.toString()}`);
  }, [rangoFechasInvalido, por, desde, hasta, router]);

  const limpiarFiltros = useCallback(() => {
    setPor('linea');
    setDesde('');
    setHasta('');
    router.replace('/reportes');
  }, [router]);

  async function exportar(reporte: 'cumplimiento' | 'recorridos' | 'sanciones' | 'actividad') {
    if (!token) return;
    setExportando(reporte);
    setError(null);
    try {
      const rango = { desde: desdeParam || undefined, hasta: hastaParam || undefined };
      if (reporte === 'cumplimiento') {
        await exportesApi.cumplimiento(token, { ...rango, por: porParam });
      } else if (reporte === 'recorridos') {
        await exportesApi.recorridos(token, rango);
      } else if (reporte === 'sanciones') {
        await exportesApi.sanciones(token, {
          ...rango,
          estado: estadoSancion || undefined,
          sujetoTipo: sujetoTipoSancion || undefined,
        });
      } else {
        await exportesApi.actividad(token, { ...rango, por: porActividad });
      }
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setExportando(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader
        title="Reportes"
        subtitle="Cumplimiento de puntos de control, recorridos completados y exportaciones analíticas."
        actions={
          <Button variant="secondary" onClick={() => router.push('/reportes/recorridos')}>
            <span>Ver recorridos (RNF-24)</span>
            <ArrowRight size={14} style={{ marginLeft: '0.4rem' }} />
          </Button>
        }
      />

      {error && (
        <Alert variant="danger" title="Error">
          {error}
        </Alert>
      )}

      {/* Tarjetas KPI de Resumen Operativo */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))',
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
            <TrendingUp size={19} />
          </span>
          <div>
            <span style={{ fontSize: '0.72rem', color: 'var(--qv-text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Cumplimiento General
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', marginTop: '0.2rem' }}>
              <strong style={{ fontSize: '1.25rem', color: 'var(--qv-text-primary)', fontWeight: 800 }}>
                {porcentajeGeneral.toFixed(1)}%
              </strong>
              <span style={{ fontSize: '0.78rem', color: 'var(--qv-text-secondary)', fontWeight: 500 }}>
                ponderado
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
            <CheckCircle2 size={19} />
          </span>
          <div>
            <span style={{ fontSize: '0.72rem', color: 'var(--qv-text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Puntos de Control
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', marginTop: '0.2rem' }}>
              <strong style={{ fontSize: '1.25rem', color: 'var(--qv-text-primary)', fontWeight: 800 }}>
                {puntosCumplidos}
              </strong>
              <span style={{ fontSize: '0.78rem', color: 'var(--qv-text-secondary)', fontWeight: 500 }}>
                / {puntosTotales} validados
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
            <Bus size={19} />
          </span>
          <div>
            <span style={{ fontSize: '0.72rem', color: 'var(--qv-text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Recorridos Completados
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', marginTop: '0.2rem' }}>
              <strong style={{ fontSize: '1.25rem', color: 'var(--qv-text-primary)', fontWeight: 800 }}>
                {recorridosCompletados}
              </strong>
              <span style={{ fontSize: '0.78rem', color: 'var(--qv-text-secondary)', fontWeight: 500 }}>
                / {recorridosAsignados} asignados
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Barra de Filtros Glassmorphic */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          padding: '1.15rem',
          backgroundColor: 'var(--qv-surface-glass)',
          backdropFilter: 'blur(24px) saturate(180%)',
          border: '1px solid var(--qv-border-glass)',
          borderRadius: 'var(--qv-radius-xl)',
          boxShadow: 'var(--qv-shadow-sm)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--qv-text-secondary)', fontSize: '0.875rem', fontWeight: 600 }}>
          <Filter size={16} style={{ color: 'var(--qv-color-primary)' }} />
          <span>Filtros de Análisis de Cumplimiento</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))', gap: '1rem' }}>
          <Select
            label="Agrupar por"
            options={OPCIONES_AGRUPACION}
            value={por}
            onChange={(e) => setPor(e.target.value as AgrupacionCumplimiento)}
          />
          <DatePicker label="Desde" value={desde} onChange={(e) => setDesde(e.target.value)} />
          <DatePicker label="Hasta" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>

        {rangoFechasInvalido && (
          <Alert variant="warning" title="Revisa el rango de fechas">
            La fecha de inicio no puede ser posterior a la fecha de fin.
          </Alert>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <Button onClick={aplicarFiltros} disabled={rangoFechasInvalido}>
            Aplicar filtros
          </Button>
          {(por !== 'linea' || desde || hasta) && (
            <Button variant="ghost" onClick={limpiarFiltros}>
              Limpiar filtros
            </Button>
          )}
        </div>
      </div>

      {/* Tabla Glassmorphic de Cumplimiento */}
      {loading ? (
        <div style={{ padding: '3rem', textAlign: 'center' }}>
          <Loader label="Calculando métricas de cumplimiento..." />
        </div>
      ) : filas.length === 0 ? (
        <Card>
          <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--qv-text-muted)' }}>
            <Activity size={32} style={{ margin: '0 auto 0.75rem', opacity: 0.5 }} />
            <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--qv-text-secondary)', margin: '0 0 0.25rem 0' }}>
              Sin datos de cumplimiento
            </p>
            <span style={{ fontSize: '0.8125rem' }}>
              No se registraron datos de cumplimiento para los filtros y fechas seleccionadas.
            </span>
          </div>
        </Card>
      ) : (
        <div className="qv-table-wrap">
          <table className="qv-table">
            <thead>
              <tr>
                <th>{por === 'linea' ? 'Línea de Transporte' : por === 'vehiculo' ? 'Vehículo / Placa' : 'Recorrido / Ruta'}</th>
                <th>% Cumplimiento</th>
                <th>Puntos de Control</th>
                <th>Recorridos Completados</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f, idx) => {
                const Icon = por === 'linea' ? GitBranch : por === 'vehiculo' ? Bus : Route;
                const porcentaje = f.porcentajeCumplimiento;
                const colorBarra =
                  porcentaje >= 85
                    ? '#10b981'
                    : porcentaje >= 60
                      ? '#f59e0b'
                      : '#ef4444';

                return (
                  <tr key={`${f.nombre}-${idx}`}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                        <div
                          style={{
                            width: '2rem',
                            height: '2rem',
                            borderRadius: 'var(--qv-radius-md)',
                            backgroundColor: 'color-mix(in srgb, var(--qv-color-primary) 12%, var(--qv-surface-card))',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--qv-color-primary)',
                            flexShrink: 0,
                          }}
                        >
                          <Icon size={15} />
                        </div>
                        <strong style={{ fontSize: '0.875rem', color: 'var(--qv-text-primary)' }}>
                          {f.nombre}
                        </strong>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: '8.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--qv-text-primary)' }}>
                            {f.porcentajeCumplimiento.toFixed(1)}%
                          </span>
                        </div>
                        <div
                          style={{
                            width: '100%',
                            height: '6px',
                            backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                            borderRadius: '999px',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              width: `${Math.min(100, Math.max(0, porcentaje))}%`,
                              height: '100%',
                              backgroundColor: colorBarra,
                              boxShadow: `0 0 8px ${colorBarra}`,
                              borderRadius: '999px',
                              transition: 'width 0.3s ease',
                            }}
                          />
                        </div>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--qv-text-primary)' }}>
                        {f.puntosCumplidos} <span style={{ color: 'var(--qv-text-secondary)', fontWeight: 500 }}>/ {f.puntosTotales}</span>
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--qv-text-primary)' }}>
                        {f.recorridosCompletados} <span style={{ color: 'var(--qv-text-secondary)', fontWeight: 500 }}>/ {f.recorridosAsignados}</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Centro de Exportación Analítica */}
      <Card header="Exportar reportes (RF-78..80)">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--qv-text-secondary)' }}>
            Descarga consolidados oficiales en formato CSV compatibles con Microsoft Excel, Google Sheets y sistemas de auditoría.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(18rem, 1fr))', gap: '1.25rem' }}>
            {/* Exportar Cumplimiento y Recorridos */}
            <div
              style={{
                padding: '1rem',
                borderRadius: 'var(--qv-radius-lg)',
                backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                border: '1px solid var(--qv-border-glass)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8125rem', fontWeight: 700, color: 'var(--qv-text-primary)' }}>
                <FileSpreadsheet size={16} style={{ color: 'var(--qv-color-primary)' }} />
                <span>Métricas Operativas Generales</span>
              </div>
              <div style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap' }}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={exportando !== null}
                  onClick={() => exportar('cumplimiento')}
                >
                  <Download size={14} style={{ marginRight: '0.35rem' }} />
                  {exportando === 'cumplimiento' ? 'Exportando...' : 'Cumplimiento (CSV)'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={exportando !== null}
                  onClick={() => exportar('recorridos')}
                >
                  <Download size={14} style={{ marginRight: '0.35rem' }} />
                  {exportando === 'recorridos' ? 'Exportando...' : 'Recorridos por periodo (CSV)'}
                </Button>
              </div>
            </div>

            {/* Exportar Sanciones */}
            <div
              style={{
                padding: '1rem',
                borderRadius: 'var(--qv-radius-lg)',
                backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                border: '1px solid var(--qv-border-glass)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8125rem', fontWeight: 700, color: 'var(--qv-text-primary)' }}>
                <FileSpreadsheet size={16} style={{ color: 'var(--qv-color-accent)' }} />
                <span>Historial de Sanciones</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <Select
                  label="Estado de sanción"
                  options={OPCIONES_ESTADO_SANCION}
                  value={estadoSancion}
                  onChange={(e) => setEstadoSancion(e.target.value as EstadoSancion | '')}
                />
                <Select
                  label="Sujeto de sanción"
                  options={OPCIONES_SUJETO_SANCION}
                  value={sujetoTipoSancion}
                  onChange={(e) => setSujetoTipoSancion(e.target.value as SujetoTipo | '')}
                />
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={exportando !== null}
                onClick={() => exportar('sanciones')}
              >
                <Download size={14} style={{ marginRight: '0.35rem' }} />
                {exportando === 'sanciones' ? 'Exportando...' : 'Sanciones (CSV)'}
              </Button>
            </div>

            {/* Exportar Actividad */}
            <div
              style={{
                padding: '1rem',
                borderRadius: 'var(--qv-radius-lg)',
                backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                border: '1px solid var(--qv-border-glass)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8125rem', fontWeight: 700, color: 'var(--qv-text-primary)' }}>
                <FileSpreadsheet size={16} style={{ color: 'var(--qv-color-success)' }} />
                <span>Actividad de Flota y Personal</span>
              </div>
              <Select
                label="Actividad por"
                options={OPCIONES_ACTIVIDAD}
                value={porActividad}
                onChange={(e) => setPorActividad(e.target.value as AgrupacionActividad)}
              />
              <Button
                variant="secondary"
                size="sm"
                disabled={exportando !== null}
                onClick={() => exportar('actividad')}
              >
                <Download size={14} style={{ marginRight: '0.35rem' }} />
                {exportando === 'actividad' ? 'Exportando...' : 'Actividad (CSV)'}
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function mensajeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Error inesperado';
}

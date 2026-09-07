'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Loader,
  PageHeader,
  PlateBadge,
  StatusBadge,
  type StatusBadgeStatus,
} from '@quivo/design-system';
import type { RecorridoResumen } from '@quivo/shared';
import {
  ArrowLeft,
  ArrowRight,
  Bus,
  Calendar,
  Filter,
  GitBranch,
  Route,
  User,
} from 'lucide-react';
import { useAuth } from '../../../../src/lib/auth/auth-context';
import { recorridosApi } from '../../../../src/lib/api/recorridos';
import { ApiError } from '../../../../src/lib/api/client';

const ESTADO_RECORRIDO_BADGE: Record<string, StatusBadgeStatus> = {
  completado: 'active',
  activo: 'pending',
  incompleto: 'warning',
  cancelado: 'canceled',
};

export default function RecorridosPage() {
  const { token } = useAuth();
  const router = useRouter();

  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [filas, setFilas] = useState<RecorridoResumen[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    recorridosApi
      .listar(token, {
        desde: desde ? new Date(desde) : undefined,
        hasta: hasta ? new Date(hasta) : undefined,
      })
      .then(setFilas)
      .catch((err: unknown) => setError(mensajeError(err)))
      .finally(() => setLoading(false));
  }, [token, desde, hasta]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader
        title="Historial de Recorridos"
        subtitle="Reconstrucción de sesiones operativas: traza GPS real vs. ruta asignada, cumplimiento de puntos de control y telemetría."
        actions={
          <Button variant="ghost" onClick={() => router.push('/reportes')}>
            <ArrowLeft size={14} style={{ marginRight: '0.4rem' }} />
            <span>Volver a Reportes</span>
          </Button>
        }
      />

      {error && (
        <Alert variant="danger" title="Error">
          {error}
        </Alert>
      )}

      {/* Barra de Filtros */}
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
          <span>Filtro por Rango de Fechas</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: '1rem' }}>
          <DatePicker label="Desde" value={desde} onChange={(e) => setDesde(e.target.value)} />
          <DatePicker label="Hasta" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>

        {(desde || hasta) && (
          <div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDesde('');
                setHasta('');
              }}
            >
              Limpiar fechas
            </Button>
          </div>
        )}
      </div>

      {/* Listado de Recorridos */}
      {loading ? (
        <div style={{ padding: '3rem', textAlign: 'center' }}>
          <Loader label="Cargando historial de recorridos..." />
        </div>
      ) : filas.length === 0 ? (
        <Card>
          <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--qv-text-muted)' }}>
            <Route size={32} style={{ margin: '0 auto 0.75rem', opacity: 0.5 }} />
            <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--qv-text-secondary)', margin: '0 0 0.25rem 0' }}>
              Sin recorridos registrados
            </p>
            <span style={{ fontSize: '0.8125rem' }}>
              No se encontraron recorridos para las fechas seleccionadas.
            </span>
          </div>
        </Card>
      ) : (
        <div className="qv-table-wrap">
          <table className="qv-table">
            <thead>
              <tr>
                <th>Fecha y Hora Inicio</th>
                <th>Línea</th>
                <th>Vehículo</th>
                <th>Conductor</th>
                <th>Estado</th>
                <th style={{ textAlign: 'right' }}>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} role="row">
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8125rem' }}>
                      <Calendar size={14} style={{ color: 'var(--qv-color-primary)' }} />
                      <span style={{ fontWeight: 600, color: '#ffffff' }}>{new Date(f.inicio).toLocaleString('es-BO')}</span>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8125rem' }}>
                      <GitBranch size={14} style={{ color: 'var(--qv-color-primary)' }} />
                      <strong style={{ color: '#ffffff' }}>{f.lineaNombre}</strong>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <Bus size={14} style={{ color: 'var(--qv-color-primary)' }} />
                      <PlateBadge plate={f.vehiculoPlaca} />
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8125rem' }}>
                      <User size={14} style={{ color: 'var(--qv-color-primary)' }} />
                      <span style={{ color: '#ffffff', fontWeight: 600 }}>{f.conductorNombre}</span>
                    </div>
                  </td>
                  <td>
                    <StatusBadge
                      status={ESTADO_RECORRIDO_BADGE[f.estado] ?? 'idle'}
                      label={f.estado.toUpperCase()}
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => router.push(`/reportes/recorridos/${f.id}`)}
                    >
                      <span>Ver recorrido</span>
                      <ArrowRight size={13} style={{ marginLeft: '0.35rem' }} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function mensajeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Error inesperado';
}

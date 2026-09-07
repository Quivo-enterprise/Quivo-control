'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Grid,
  Input,
  Loader,
  MetricCard,
  Modal,
  PageHeader,
  Tooltip,
} from '@quivo/design-system';
import type { SyncErrorEntry } from '@quivo/shared';
import {
  AlertCircle,
  Calendar,
  Cpu,
  Eye,
  Filter,
  Radio,
  Smartphone,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { syncErroresApi } from '../../../src/lib/api/sync-errores';
import { ApiError } from '../../../src/lib/api/client';

const TAMANO_PAGINA = 200;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface FiltrosSync {
  deviceId: string;
  sesionId: string;
  desde: string;
  hasta: string;
}

const FILTROS_VACIOS: FiltrosSync = {
  deviceId: '',
  sesionId: '',
  desde: '',
  hasta: '',
};

export default function SyncErroresPage() {
  const { token } = useAuth();

  const [deviceId, setDeviceId] = useState('');
  const [sesionId, setSesionId] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [filtrosAplicados, setFiltrosAplicados] = useState<FiltrosSync>(FILTROS_VACIOS);

  const [filas, setFilas] = useState<SyncErrorEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<SyncErrorEntry | null>(null);

  const sesionIdInvalida = sesionId.trim() !== '' && !UUID_REGEX.test(sesionId.trim());
  const rangoFechasInvalido = Boolean(desde && hasta && desde > hasta);
  const filtrosInvalidos = sesionIdInvalida || rangoFechasInvalido;

  useEffect(() => {
    if (!token) return;
    let cancelado = false;
    setLoading(true);
    setError(null);
    setHasMore(false);
    syncErroresApi
      .listar(token, aFiltrosDeConsulta(filtrosAplicados))
      .then((rows) => {
        if (cancelado) return;
        setFilas(rows);
        setHasMore(rows.length === TAMANO_PAGINA);
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
  }, [token, filtrosAplicados]);

  function aplicarFiltros() {
    if (filtrosInvalidos) return;
    setFiltrosAplicados({ deviceId, sesionId, desde, hasta });
  }

  function limpiarFiltros() {
    setDeviceId('');
    setSesionId('');
    setDesde('');
    setHasta('');
    setFiltrosAplicados(FILTROS_VACIOS);
  }

  async function cargarMas() {
    if (!token) return;
    setCargandoMas(true);
    setError(null);
    try {
      const rows = await syncErroresApi.listar(token, {
        ...aFiltrosDeConsulta(filtrosAplicados),
        skip: filas.length,
      });
      setFilas((actual) => [...actual, ...rows]);
      setHasMore(rows.length === TAMANO_PAGINA);
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setCargandoMas(false);
    }
  }

  const totalDispositivos = useMemo(() => new Set(filas.map((f) => f.deviceId)).size, [filas]);
  const totalSesiones = useMemo(
    () => new Set(filas.filter((f) => f.sesionId).map((f) => f.sesionId)).size,
    [filas],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader
        title="Errores de Sincronización"
        subtitle="Monitoreo de paquetes móviles y eventos telemétricos rechazados por el worker de ingesta."
      />

      {error && (
        <Alert variant="danger" title="Error">
          {error}
        </Alert>
      )}

      {/* Tarjetas KPI de Diagnóstico */}
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
              backgroundColor: 'color-mix(in srgb, var(--qv-color-danger) 14%, var(--qv-surface-card))',
              color: 'var(--qv-color-danger)',
              boxShadow: '0 0 12px color-mix(in srgb, var(--qv-color-danger) 25%, transparent)',
              flexShrink: 0,
            }}
          >
            <XCircle size={19} />
          </span>
          <div>
            <span style={{ fontSize: '0.72rem', color: 'var(--qv-text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Eventos Rechazados
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', marginTop: '0.2rem' }}>
              <strong style={{ fontSize: '1.25rem', color: '#ffffff', fontWeight: 800 }}>
                {filas.length}
              </strong>
              <span style={{ fontSize: '0.78rem', color: 'var(--qv-text-secondary)', fontWeight: 500 }}>
                en ventana
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
            <Smartphone size={19} />
          </span>
          <div>
            <span style={{ fontSize: '0.72rem', color: 'var(--qv-text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Terminales con Error
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', marginTop: '0.2rem' }}>
              <strong style={{ fontSize: '1.25rem', color: '#ffffff', fontWeight: 800 }}>
                {totalDispositivos}
              </strong>
              <span style={{ fontSize: '0.78rem', color: 'var(--qv-text-secondary)', fontWeight: 500 }}>
                dispositivos
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
            <Radio size={19} />
          </span>
          <div>
            <span style={{ fontSize: '0.72rem', color: 'var(--qv-text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Sesiones Afectadas
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', marginTop: '0.2rem' }}>
              <strong style={{ fontSize: '1.25rem', color: '#ffffff', fontWeight: 800 }}>
                {totalSesiones}
              </strong>
              <span style={{ fontSize: '0.78rem', color: 'var(--qv-text-secondary)', fontWeight: 500 }}>
                jornadas
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
          <span>Filtros de Diagnóstico</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))', gap: '0.85rem' }}>
          <Input
            label="Dispositivo"
            placeholder="Filtrar por Device ID"
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
          />
          <Input
            label="Sesión (id)"
            placeholder="UUID de la sesión operativa"
            value={sesionId}
            onChange={(e) => setSesionId(e.target.value)}
            aria-invalid={sesionIdInvalida}
            helperText={sesionIdInvalida ? 'Ingresá un UUID de sesión válido.' : undefined}
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
          <Button onClick={aplicarFiltros} disabled={filtrosInvalidos}>
            Aplicar filtros
          </Button>
          <Button variant="ghost" onClick={limpiarFiltros}>
            Limpiar filtros
          </Button>
        </div>
      </div>

      {/* Tabla Glassmorphic de Errores */}
      {loading ? (
        <div style={{ padding: '3rem', textAlign: 'center' }}>
          <Loader label="Consultando registros de sincronización..." />
        </div>
      ) : filas.length === 0 ? (
        <Card>
          <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--qv-text-muted)' }}>
            <Cpu size={32} style={{ margin: '0 auto 0.75rem', opacity: 0.5 }} />
            <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--qv-text-secondary)', margin: '0 0 0.25rem 0' }}>
              Sin errores de sync
            </p>
            <span style={{ fontSize: '0.8125rem' }}>
              Todos los paquetes telemétricos fueron procesados e ingeridos correctamente por el worker.
            </span>
          </div>
        </Card>
      ) : (
        <div className="qv-table-wrap">
          <table className="qv-table">
            <thead>
              <tr>
                <th>Fecha y Hora</th>
                <th>Dispositivo Móvil</th>
                <th>Sesión Operativa</th>
                <th>Motivo del Rechazo</th>
                <th style={{ textAlign: 'right' }}>Payload</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} role="row">
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8125rem' }}>
                      <Calendar size={14} style={{ color: 'var(--qv-color-primary)' }} />
                      <span style={{ fontWeight: 600, color: '#ffffff' }}>{new Date(f.ts).toLocaleString('es-BO')}</span>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8125rem' }}>
                      <Smartphone size={14} style={{ color: 'var(--qv-color-primary)' }} />
                      <strong style={{ color: '#ffffff' }}>{f.deviceId}</strong>
                    </div>
                  </td>
                  <td>
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontFamily: 'monospace',
                        color: f.sesionId ? '#ffffff' : 'var(--qv-text-secondary)',
                      }}
                    >
                      {f.sesionId ?? '—'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <AlertCircle size={14} style={{ color: 'var(--qv-color-danger)', flexShrink: 0 }} />
                      <span style={{ fontSize: '0.8125rem', color: '#f87171', fontWeight: 600 }}>
                        {f.error}
                      </span>
                    </div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="qv-table-actions-capsule">
                      <Tooltip content="Ver payload JSON rechazado">
                        <button
                          type="button"
                          className="qv-action-pill-btn"
                          onClick={() => setDetalle(f)}
                          aria-label="Ver payload"
                        >
                          <Eye size={13} />
                        </button>
                      </Tooltip>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasMore && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '0.5rem' }}>
          <Button variant="secondary" onClick={cargarMas} disabled={cargandoMas}>
            {cargandoMas ? 'Cargando más eventos...' : 'Cargar más registros'}
          </Button>
        </div>
      )}

      {/* Modal de Detalle de Payload */}
      <Modal
        open={detalle !== null}
        title={detalle ? `Evento Rechazado — ${detalle.deviceId}` : ''}
        onClose={() => setDetalle(null)}
      >
        {detalle && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div
                style={{
                  padding: '0.65rem 0.85rem',
                  borderRadius: 'var(--qv-radius-md)',
                  backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                  border: '1px solid var(--qv-border-glass)',
                }}
              >
                <span style={{ fontSize: '0.6875rem', color: 'var(--qv-text-muted)', fontWeight: 600 }}>
                  Dispositivo Móvil
                </span>
                <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.8125rem', fontWeight: 700, color: 'var(--qv-text-primary)' }}>
                  {detalle.deviceId}
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
                <span style={{ fontSize: '0.6875rem', color: 'var(--qv-text-muted)', fontWeight: 600 }}>
                  ID de Sesión
                </span>
                <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.8125rem', fontFamily: 'monospace', color: 'var(--qv-text-primary)' }}>
                  {detalle.sesionId ?? '—'}
                </p>
              </div>
            </div>

            <div
              style={{
                padding: '0.65rem 0.85rem',
                borderRadius: 'var(--qv-radius-md)',
                backgroundColor: 'color-mix(in srgb, var(--qv-color-danger) 10%, var(--qv-surface-card))',
                border: '1px solid color-mix(in srgb, var(--qv-color-danger) 30%, transparent)',
              }}
            >
              <span style={{ fontSize: '0.6875rem', color: 'var(--qv-color-danger)', fontWeight: 700 }}>
                Motivo del Rechazo por el Ingesta Worker:
              </span>
              <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--qv-text-primary)' }}>
                {detalle.error}
              </p>
            </div>

            <div>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--qv-text-secondary)', display: 'block', marginBottom: '0.35rem' }}>
                Payload JSON del Paquete Rechazado:
              </span>
              <pre
                style={{
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  overflowX: 'auto',
                  background: 'rgba(0, 0, 0, 0.35)',
                  color: '#f87171',
                  padding: '0.85rem',
                  borderRadius: 'var(--qv-radius-md)',
                  fontFamily: 'monospace',
                  fontSize: '0.8125rem',
                  lineHeight: 1.4,
                  border: '1px solid var(--qv-border-glass)',
                }}
              >
                {JSON.stringify(detalle.payload, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function aFiltrosDeConsulta({ deviceId, sesionId, desde, hasta }: FiltrosSync) {
  return {
    deviceId: deviceId.trim() || undefined,
    sesionId: sesionId.trim() || undefined,
    desde: desde ? new Date(desde) : undefined,
    hasta: hasta ? new Date(hasta) : undefined,
  };
}

function mensajeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Error inesperado';
}

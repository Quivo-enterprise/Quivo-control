'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AuditLog,
  Button,
  DatePicker,
  Grid,
  Input,
  MetricCard,
  Modal,
  PageHeader,
  Select,
  Tooltip,
} from '@quivo/design-system';
import type { AuditLogEntry } from '@quivo/shared';
import {
  Edit3,
  Eye,
  Filter,
  PlusCircle,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { auditoriaApi } from '../../../src/lib/api/auditoria';
import { ApiError } from '../../../src/lib/api/client';

const ENTIDADES = [
  'sindicato',
  'socio',
  'vehiculo',
  'conductor',
  'linea',
  'ruta',
  'variante',
  'parada',
  'punto_control',
  'rotacion',
  'asignacion',
];

const ACCIONES = ['crear', 'editar', 'anular', 'publicar'];

const TAMANO_PAGINA = 200;

interface FiltrosAuditoria {
  entidad: string;
  accion: string;
  usuarioId: string;
  desde: string;
  hasta: string;
}

const FILTROS_VACIOS: FiltrosAuditoria = {
  entidad: '',
  accion: '',
  usuarioId: '',
  desde: '',
  hasta: '',
};

export default function AuditoriaPage() {
  const { token } = useAuth();

  const [entidad, setEntidad] = useState('');
  const [accion, setAccion] = useState('');
  const [usuarioId, setUsuarioId] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [filtrosAplicados, setFiltrosAplicados] = useState<FiltrosAuditoria>(FILTROS_VACIOS);

  const [filas, setFilas] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<AuditLogEntry | null>(null);

  const rangoFechasInvalido = Boolean(desde && hasta && desde > hasta);

  useEffect(() => {
    if (!token) return;
    let cancelado = false;
    setLoading(true);
    setError(null);
    setHasMore(false);
    auditoriaApi
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
    if (rangoFechasInvalido) return;
    setFiltrosAplicados({ entidad, accion, usuarioId, desde, hasta });
  }

  function limpiarFiltros() {
    setEntidad('');
    setAccion('');
    setUsuarioId('');
    setDesde('');
    setHasta('');
    setFiltrosAplicados(FILTROS_VACIOS);
  }

  async function cargarMas() {
    if (!token) return;
    setCargandoMas(true);
    setError(null);
    try {
      const rows = await auditoriaApi.listar(token, {
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

  const conteoCrear = useMemo(() => filas.filter((f) => f.accion === 'crear').length, [filas]);
  const conteoEditar = useMemo(() => filas.filter((f) => f.accion === 'editar').length, [filas]);
  const conteoAnular = useMemo(() => filas.filter((f) => f.accion === 'anular').length, [filas]);
  const conteoPublicar = useMemo(() => filas.filter((f) => f.accion === 'publicar').length, [filas]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader
        title="Auditoría"
        subtitle="Registro inmutable de trazabilidad, seguridad y cambios en recursos críticos del sistema."
      />

      {error && (
        <Alert variant="danger" title="Error">
          {error}
        </Alert>
      )}


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
          <span>Filtros de Búsqueda de Logs</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '0.85rem' }}>
          <Select
            label="Entidad"
            options={[
              { label: 'Todas las entidades', value: '' },
              ...ENTIDADES.map((e) => ({ label: e, value: e })),
            ]}
            value={entidad}
            onChange={(e) => setEntidad(e.target.value)}
          />
          <Select
            label="Acción"
            options={[
              { label: 'Todas las acciones', value: '' },
              ...ACCIONES.map((a) => ({ label: a, value: a })),
            ]}
            value={accion}
            onChange={(e) => setAccion(e.target.value)}
          />
          <Input
            label="Usuario (id)"
            placeholder="Filtrar por ID de usuario"
            value={usuarioId}
            onChange={(e) => setUsuarioId(e.target.value)}
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
          <Button variant="ghost" onClick={limpiarFiltros}>
            Limpiar filtros
          </Button>
        </div>
      </div>

      {/* Lista de Registros AuditLog */}
      <AuditLog
        loading={loading}
        logs={filas.map((f) => ({
          id: f.id,
          action: f.accion,
          user: f.usuarioId,
          timestamp: new Date(f.ts).toLocaleString('es-BO'),
          details: `${f.entidad} (${f.entidadId})`,
        }))}
        actions={(log) => {
          const fila = filas.find((f) => f.id === log.id);
          return fila ? (
            <div className="qv-table-actions-capsule">
              <Tooltip content="Ver diferencias (diff JSON)">
                <button
                  type="button"
                  className="qv-action-pill-btn"
                  onClick={() => setDetalle(fila)}
                  aria-label="Ver diff"
                >
                  <Eye size={13} />
                </button>
              </Tooltip>
            </div>
          ) : null;
        }}
      />

      {hasMore && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '0.5rem' }}>
          <Button variant="secondary" onClick={cargarMas} disabled={cargandoMas}>
            {cargandoMas ? 'Cargando más registros...' : 'Cargar más logs'}
          </Button>
        </div>
      )}

      {/* Modal de Detalle y Diff JSON */}
      <Modal
        open={detalle !== null}
        title={detalle ? `Detalle de Evento — ${detalle.entidad.toUpperCase()} (${detalle.accion.toUpperCase()})` : ''}
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
                  Entidad Afectada
                </span>
                <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.8125rem', fontWeight: 700, color: 'var(--qv-text-primary)' }}>
                  {detalle.entidad} <span style={{ fontWeight: 400, color: 'var(--qv-text-muted)' }}>({detalle.entidadId})</span>
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
                  Usuario Responsable
                </span>
                <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.8125rem', fontWeight: 700, color: 'var(--qv-text-primary)' }}>
                  {detalle.usuarioId}
                </p>
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
              <span style={{ fontSize: '0.6875rem', color: 'var(--qv-text-muted)', fontWeight: 600 }}>
                Fecha y Hora Exacta
              </span>
              <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.8125rem', fontWeight: 700, color: 'var(--qv-text-primary)' }}>
                {new Date(detalle.ts).toLocaleString('es-BO')}
              </p>
            </div>

            <div>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--qv-text-secondary)', display: 'block', marginBottom: '0.35rem' }}>
                Cambios / Diff del Payload:
              </span>
              <pre
                style={{
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  overflowX: 'auto',
                  background: 'rgba(0, 0, 0, 0.35)',
                  color: '#38bdf8',
                  padding: '0.85rem',
                  borderRadius: 'var(--qv-radius-md)',
                  fontFamily: 'monospace',
                  fontSize: '0.8125rem',
                  lineHeight: 1.4,
                  border: '1px solid var(--qv-border-glass)',
                }}
              >
                {JSON.stringify(detalle.diff, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function aFiltrosDeConsulta({ entidad, accion, usuarioId, desde, hasta }: FiltrosAuditoria) {
  return {
    entidad: entidad || undefined,
    accion: accion || undefined,
    usuarioId: usuarioId.trim() || undefined,
    desde: desde ? new Date(desde) : undefined,
    hasta: hasta ? new Date(hasta) : undefined,
  };
}

function mensajeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Error inesperado';
}

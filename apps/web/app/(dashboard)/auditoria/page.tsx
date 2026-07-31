'use client';

import { useEffect, useState } from 'react';
import { Alert, AuditLog, Button, Card, DatePicker, Input, Modal, PageHeader, Select } from '@quivo/design-system';
import type { AuditLogEntry } from '@quivo/shared';
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

/** RF-81..84 (QUI-248) — reemplaza el modo demo, consume `GET /v1/auditoria` (QUI-230). */
export default function AuditoriaPage() {
  const { token } = useAuth();

  const [entidad, setEntidad] = useState('');
  const [accion, setAccion] = useState('');
  const [usuarioId, setUsuarioId] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  const [filas, setFilas] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<AuditLogEntry | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    auditoriaApi
      .listar(token, {
        entidad: entidad || undefined,
        accion: accion || undefined,
        usuarioId: usuarioId.trim() || undefined,
        desde: desde ? new Date(desde) : undefined,
        hasta: hasta ? new Date(hasta) : undefined,
      })
      .then(setFilas)
      .catch((err: unknown) => setError(mensajeError(err)))
      .finally(() => setLoading(false));
  }, [token, entidad, accion, usuarioId, desde, hasta]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <PageHeader title="Auditoría" subtitle="RF-81..84 — historial de acciones críticas (QUI-248)." />
      {error && <Alert variant="danger" title="Error">{error}</Alert>}

      <Card header="Filtros">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem' }}>
          <Select
            label="Entidad"
            options={[{ label: 'Todas', value: '' }, ...ENTIDADES.map((e) => ({ label: e, value: e }))]}
            value={entidad}
            onChange={(e) => setEntidad(e.target.value)}
          />
          <Select
            label="Acción"
            options={[{ label: 'Todas', value: '' }, ...ACCIONES.map((a) => ({ label: a, value: a }))]}
            value={accion}
            onChange={(e) => setAccion(e.target.value)}
          />
          <Input label="Usuario (id)" value={usuarioId} onChange={(e) => setUsuarioId(e.target.value)} />
          <DatePicker label="Desde" value={desde} onChange={(e) => setDesde(e.target.value)} />
          <DatePicker label="Hasta" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
      </Card>

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
            <Button size="sm" variant="ghost" onClick={() => setDetalle(fila)}>
              Ver diff
            </Button>
          ) : null;
        }}
      />

      <Modal
        open={detalle !== null}
        title={detalle ? `${detalle.entidad} — ${detalle.accion}` : ''}
        onClose={() => setDetalle(null)}
      >
        {detalle && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <span>
              <strong>Entidad:</strong> {detalle.entidad} ({detalle.entidadId})
            </span>
            <span>
              <strong>Usuario:</strong> {detalle.usuarioId}
            </span>
            <span>
              <strong>Fecha:</strong> {new Date(detalle.ts).toLocaleString('es-BO')}
            </span>
            <pre style={{ whiteSpace: 'pre-wrap', overflowX: 'auto', background: 'rgba(0,0,0,0.15)', padding: '0.75rem', borderRadius: '0.5rem' }}>
              {JSON.stringify(detalle.diff, null, 2)}
            </pre>
          </div>
        )}
      </Modal>
    </div>
  );
}

function mensajeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Error inesperado';
}

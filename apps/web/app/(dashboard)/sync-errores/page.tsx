'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Card, DataTable, DatePicker, Input, Modal, PageHeader } from '@quivo/design-system';
import type { SyncErrorEntry } from '@quivo/shared';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { syncErroresApi } from '../../../src/lib/api/sync-errores';
import { ApiError } from '../../../src/lib/api/client';

/** RNF-35 (QUI-242) — lotes/eventos que el worker de ingesta (QUI-241) rechazó. Nada se
 * descarta en silencio: queda visible acá con motivo. Mismo patrón de página que
 * `/auditoria` (QUI-248), con `DataTable` genérico en vez del componente `AuditLog`
 * (pensado específicamente para el shape de `audit_log`). */
export default function SyncErroresPage() {
  const { token } = useAuth();

  const [deviceId, setDeviceId] = useState('');
  const [sesionId, setSesionId] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  const [filas, setFilas] = useState<SyncErrorEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<SyncErrorEntry | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    syncErroresApi
      .listar(token, {
        deviceId: deviceId.trim() || undefined,
        sesionId: sesionId.trim() || undefined,
        desde: desde ? new Date(desde) : undefined,
        hasta: hasta ? new Date(hasta) : undefined,
      })
      .then(setFilas)
      .catch((err: unknown) => setError(mensajeError(err)))
      .finally(() => setLoading(false));
  }, [token, deviceId, sesionId, desde, hasta]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <PageHeader
        title="Errores de sync"
        subtitle="RNF-35 — lotes/eventos móviles rechazados por el worker de ingesta (QUI-241)."
      />
      {error && <Alert variant="danger" title="Error">{error}</Alert>}

      <Card header="Filtros">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
          <Input label="Dispositivo" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} />
          <Input label="Sesión (id)" value={sesionId} onChange={(e) => setSesionId(e.target.value)} />
          <DatePicker label="Desde" value={desde} onChange={(e) => setDesde(e.target.value)} />
          <DatePicker label="Hasta" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
      </Card>

      <DataTable<SyncErrorEntry>
        loading={loading}
        rows={filas}
        empty="Sin errores de sync para mostrar."
        columns={[
          { key: 'ts', header: 'Fecha', render: (f) => new Date(f.ts).toLocaleString('es-BO') },
          { key: 'deviceId', header: 'Dispositivo' },
          { key: 'sesionId', header: 'Sesión', render: (f) => f.sesionId ?? '—' },
          { key: 'error', header: 'Motivo' },
        ]}
        actions={(f) => (
          <Button size="sm" variant="ghost" onClick={() => setDetalle(f)}>
            Ver payload
          </Button>
        )}
      />

      <Modal
        open={detalle !== null}
        title={detalle ? `Evento rechazado — ${detalle.deviceId}` : ''}
        onClose={() => setDetalle(null)}
      >
        {detalle && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <span>
              <strong>Dispositivo:</strong> {detalle.deviceId}
            </span>
            <span>
              <strong>Sesión:</strong> {detalle.sesionId ?? '—'}
            </span>
            <span>
              <strong>Evento:</strong> {detalle.eventId ?? '—'}
            </span>
            <span>
              <strong>Fecha:</strong> {new Date(detalle.ts).toLocaleString('es-BO')}
            </span>
            <span>
              <strong>Motivo:</strong> {detalle.error}
            </span>
            <pre style={{ whiteSpace: 'pre-wrap', overflowX: 'auto', background: 'rgba(0,0,0,0.15)', padding: '0.75rem', borderRadius: '0.5rem' }}>
              {JSON.stringify(detalle.payload, null, 2)}
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

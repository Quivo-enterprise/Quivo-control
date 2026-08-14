'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Card, DataTable, DatePicker, PageHeader } from '@quivo/design-system';
import type { RecorridoResumen } from '@quivo/shared';
import { useAuth } from '../../../../src/lib/auth/auth-context';
import { recorridosApi } from '../../../../src/lib/api/recorridos';
import { ApiError } from '../../../../src/lib/api/client';

/** RNF-24 (QUI-247) — listado de sesiones operativas para elegir cuál reconstruir. */
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <PageHeader
        title="Recorridos"
        subtitle="RNF-24 — reconstrucción de una sesión operativa: traza GPS real vs. ruta asignada, puntos de control y timeline."
      />
      {error && <Alert variant="danger" title="Error">{error}</Alert>}

      <Card header="Filtros">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
          <DatePicker label="Desde" value={desde} onChange={(e) => setDesde(e.target.value)} />
          <DatePicker label="Hasta" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
      </Card>

      <DataTable<RecorridoResumen>
        loading={loading}
        rows={filas}
        empty="Sin recorridos para mostrar."
        columns={[
          { key: 'inicio', header: 'Inicio', render: (f) => new Date(f.inicio).toLocaleString('es-BO') },
          { key: 'lineaNombre', header: 'Línea' },
          { key: 'vehiculoPlaca', header: 'Vehículo' },
          { key: 'conductorNombre', header: 'Conductor' },
          { key: 'estado', header: 'Estado' },
        ]}
        actions={(f) => (
          <Button size="sm" variant="ghost" onClick={() => router.push(`/reportes/recorridos/${f.id}`)}>
            Ver recorrido
          </Button>
        )}
      />
    </div>
  );
}

function mensajeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Error inesperado';
}

'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Alert, Badge, Button, Card, PageHeader, RouteMap, type MapPoint, type MapRoute } from '@quivo/design-system';
import type { RecorridoDetalle } from '@quivo/shared';
import { useAuth } from '../../../../../src/lib/auth/auth-context';
import { recorridosApi } from '../../../../../src/lib/api/recorridos';
import { ApiError } from '../../../../../src/lib/api/client';

type ItemTimeline = {
  ts: string;
  tipo: 'evento' | 'cumplimiento';
  titulo: string;
  detalle: string;
};

export default function RecorridoDetallePage() {
  const { token } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();

  const [detalle, setDetalle] = useState<RecorridoDetalle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !params.id) return;
    setLoading(true);
    setError(null);
    recorridosApi
      .obtener(token, params.id)
      .then(setDetalle)
      .catch((err: unknown) => setError(mensajeError(err)))
      .finally(() => setLoading(false));
  }, [token, params.id]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <PageHeader
        title={detalle ? `Recorrido — ${detalle.linea.nombre}` : 'Recorrido'}
        subtitle={
          detalle
            ? `${detalle.vehiculo.placa} · ${detalle.conductor.nombre} · ${new Date(detalle.sesion.inicio).toLocaleString('es-BO')}`
            : undefined
        }
      />
      <Button size="sm" variant="ghost" onClick={() => router.push('/reportes/recorridos')}>
        ← Volver a recorridos
      </Button>
      {error && <Alert variant="danger" title="Error">{error}</Alert>}
      {loading && !detalle && <span>Cargando recorrido...</span>}

      {detalle && (
        <>
          <RouteMap
            routes={construirRutas(detalle)}
            markers={construirMarcadores(detalle)}
            height="480px"
          />
          <Card header="Timeline">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {construirTimeline(detalle).map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '1rem',
                    padding: '0.5rem 0',
                    borderBottom: '1px solid rgba(128,128,128,0.2)',
                  }}
                >
                  <span>
                    <Badge variant={item.tipo === 'cumplimiento' ? 'accent' : 'neutral'}>{item.titulo}</Badge>{' '}
                    {item.detalle}
                  </span>
                  <span>{new Date(item.ts).toLocaleTimeString('es-BO')}</span>
                </div>
              ))}
              {construirTimeline(detalle).length === 0 && <span>Sin eventos registrados.</span>}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function construirRutas(detalle: RecorridoDetalle): MapRoute[] {
  const rutas: MapRoute[] = [
    {
      id: 'ruta-asignada',
      label: 'Ruta asignada',
      color: detalle.linea.color,
      dashed: true,
      points: detalle.ruta.geometria.coordinates.map(([lng, lat]) => ({ lat, lng })),
    },
  ];
  if (detalle.trazaGps.length > 0) {
    rutas.push({
      id: 'traza-gps',
      label: 'Traza GPS real',
      color: '#2563eb',
      points: detalle.trazaGps.map((p) => ({ lat: p.lat, lng: p.lng })),
    });
  }
  return rutas;
}

function construirMarcadores(detalle: RecorridoDetalle): MapPoint[] {
  return detalle.puntosControl.map((pc, index) => {
    const cumplimientoWorker = detalle.cumplimientos.find(
      (c) => c.puntoControlId === pc.id && c.validadoPor === 'worker',
    );
    const cumplido = cumplimientoWorker?.cumplido ?? false;
    return {
      lat: pc.coord.coordinates[1],
      lng: pc.coord.coordinates[0],
      label: `Punto de control ${index + 1}`,
      description: cumplimientoWorker
        ? `${cumplido ? 'Cumplido' : 'No cumplido'} — ${cumplimientoWorker.distanciaM.toFixed(0)}m`
        : 'Sin validación del worker',
      color: cumplido ? '#16a34a' : '#dc2626',
      pinType: 'stop',
    };
  });
}

function construirTimeline(detalle: RecorridoDetalle): ItemTimeline[] {
  const items: ItemTimeline[] = [
    ...detalle.eventos.map((e) => ({
      ts: e.ts,
      tipo: 'evento' as const,
      titulo: e.tipo,
      detalle: '',
    })),
    ...detalle.cumplimientos.map((c) => ({
      ts: c.ts,
      tipo: 'cumplimiento' as const,
      titulo: c.validadoPor === 'worker' ? 'Cumplimiento (worker)' : 'Cumplimiento (app)',
      detalle: `${c.cumplido ? 'Cumplido' : 'No cumplido'} a ${c.distanciaM.toFixed(0)}m`,
    })),
  ];
  return items.sort((a, b) => a.ts.localeCompare(b.ts));
}

function mensajeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Error inesperado';
}

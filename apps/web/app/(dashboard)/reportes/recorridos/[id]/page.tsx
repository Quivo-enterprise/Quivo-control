'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Alert,
  Button,
  Card,
  Grid,
  Loader,
  MetricCard,
  PageHeader,
  PlateBadge,
  RouteMap,
  type MapPoint,
  type MapRoute,
} from '@quivo/design-system';
import type { RecorridoDetalle } from '@quivo/shared';
import {
  ArrowLeft,
  Bus,
  Calendar,
  CheckCircle2,
  Clock,
  GitBranch,
  MapPin,
  User,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../../../../../src/lib/auth/auth-context';
import { recorridosApi } from '../../../../../src/lib/api/recorridos';
import { ApiError } from '../../../../../src/lib/api/client';

type ItemTimeline = {
  ts: string;
  tipo: 'evento' | 'cumplimiento';
  titulo: string;
  detalle: string;
  cumplido?: boolean;
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

  const puntosValidados = detalle
    ? detalle.puntosControl.filter((pc) =>
        detalle.cumplimientos.some(
          (c) => c.puntoControlId === pc.id && c.validadoPor === 'worker' && c.cumplido,
        ),
      ).length
    : 0;

  const totalPuntos = detalle?.puntosControl.length ?? 0;

  // Referencias estables para el mapa: sin memo, cada render re-proyectaría todo el trazado.
  const rutasMapa = useMemo(() => (detalle ? construirRutas(detalle) : []), [detalle]);
  const marcadoresMapa = useMemo(() => (detalle ? construirMarcadores(detalle) : []), [detalle]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader
        title={detalle ? `Recorrido — ${detalle.linea.nombre}` : 'Detalle del Recorrido'}
        subtitle="Reconstrucción de telemetría GPS, puntos de control validados y línea de tiempo de eventos."
        actions={
          <Button variant="ghost" onClick={() => router.push('/reportes/recorridos')}>
            <ArrowLeft size={14} style={{ marginRight: '0.4rem' }} />
            <span>Volver a Recorridos</span>
          </Button>
        }
      />

      {error && <Alert variant="danger" title="Error">{error}</Alert>}

      {loading && !detalle && (
        <div style={{ padding: '3rem', textAlign: 'center' }}>
          <Loader label="Reconstruyendo trazado y eventos de la sesión..." />
        </div>
      )}

      {detalle && (
        <>
          {/* Ficha Resumen de la Sesión */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              flexWrap: 'wrap',
              padding: '0.9rem 1.25rem',
              backgroundColor: 'var(--qv-surface-glass)',
              backdropFilter: 'blur(24px) saturate(190%)',
              WebkitBackdropFilter: 'blur(24px) saturate(190%)',
              border: '1px solid var(--qv-border-glass)',
              borderRadius: 'var(--qv-radius-xl)',
              boxShadow: 'var(--qv-shadow-sm)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <GitBranch size={16} style={{ color: detalle.linea.color ?? 'var(--qv-color-primary)' }} />
                <strong style={{ fontSize: '0.9375rem', color: 'var(--qv-text-primary)' }}>
                  {detalle.linea.nombre}
                </strong>
              </div>

              <div style={{ width: '1px', height: '1.5rem', backgroundColor: 'var(--qv-border-glass)' }} />

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <Bus size={15} style={{ color: 'var(--qv-color-primary)' }} />
                <PlateBadge plate={detalle.vehiculo.placa} />
              </div>

              <div style={{ width: '1px', height: '1.5rem', backgroundColor: 'var(--qv-border-glass)' }} />

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.8125rem' }}>
                <User size={15} style={{ color: 'var(--qv-color-primary)' }} />
                <span style={{ fontWeight: 600, color: 'var(--qv-text-primary)' }}>{detalle.conductor.nombre}</span>
              </div>

              <div style={{ width: '1px', height: '1.5rem', backgroundColor: 'var(--qv-border-glass)' }} />

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.8125rem', color: 'var(--qv-text-secondary)' }}>
                <Calendar size={14} style={{ color: 'var(--qv-color-primary)' }} />
                <span>{new Date(detalle.sesion.inicio).toLocaleString('es-BO')}</span>
              </div>
            </div>
          </div>

          {/* Tarjetas KPI del Recorrido */}
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
                  backgroundColor:
                    puntosValidados === totalPuntos
                      ? 'color-mix(in srgb, var(--qv-color-success) 14%, var(--qv-surface-card))'
                      : 'color-mix(in srgb, var(--qv-color-warning) 14%, var(--qv-surface-card))',
                  color: puntosValidados === totalPuntos ? 'var(--qv-color-success)' : 'var(--qv-color-warning)',
                  boxShadow: `0 0 12px ${
                    puntosValidados === totalPuntos
                      ? 'color-mix(in srgb, var(--qv-color-success) 25%, transparent)'
                      : 'color-mix(in srgb, var(--qv-color-warning) 25%, transparent)'
                  }`,
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
                    {puntosValidados}
                  </strong>
                  <span style={{ fontSize: '0.78rem', color: 'var(--qv-text-secondary)', fontWeight: 500 }}>
                    / {totalPuntos} validados
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
                  backgroundColor: 'color-mix(in srgb, var(--qv-color-primary) 14%, var(--qv-surface-card))',
                  color: 'var(--qv-color-primary)',
                  boxShadow: '0 0 12px color-mix(in srgb, var(--qv-color-primary) 25%, transparent)',
                  flexShrink: 0,
                }}
              >
                <MapPin size={19} />
              </span>
              <div>
                <span style={{ fontSize: '0.72rem', color: 'var(--qv-text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Puntos GPS
                </span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', marginTop: '0.2rem' }}>
                  <strong style={{ fontSize: '1.25rem', color: 'var(--qv-text-primary)', fontWeight: 800 }}>
                    {detalle.trazaGps.length}
                  </strong>
                  <span style={{ fontSize: '0.78rem', color: 'var(--qv-text-secondary)', fontWeight: 500 }}>
                    fijaciones
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
                <Clock size={19} />
              </span>
              <div>
                <span style={{ fontSize: '0.72rem', color: 'var(--qv-text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Eventos Registrados
                </span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', marginTop: '0.2rem' }}>
                  <strong style={{ fontSize: '1.25rem', color: 'var(--qv-text-primary)', fontWeight: 800 }}>
                    {detalle.eventos.length + detalle.cumplimientos.length}
                  </strong>
                  <span style={{ fontSize: '0.78rem', color: 'var(--qv-text-secondary)', fontWeight: 500 }}>
                    hitos en sesión
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Mapa de Trazado Reconstruido */}
          <div
            style={{
              borderRadius: 'var(--qv-radius-xl)',
              overflow: 'hidden',
              border: '1px solid var(--qv-border-glass)',
              boxShadow: 'var(--qv-shadow-floating)',
            }}
          >
            <RouteMap
              routes={rutasMapa}
              markers={marcadoresMapa}
              height="480px"
              engine="google"
              googleMapsApiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}
              googleMapsMapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID}
            />
          </div>

          {/* Timeline de Eventos */}
          <Card header="Línea de Tiempo Operativa (Eventos y Puntos de Control)">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
              {construirTimeline(detalle).map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '1rem',
                    padding: '0.65rem 0.85rem',
                    borderRadius: 'var(--qv-radius-md)',
                    backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                    border: '1px solid var(--qv-border-glass)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                    {item.tipo === 'cumplimiento' ? (
                      item.cumplido ? (
                        <CheckCircle2 size={16} style={{ color: 'var(--qv-color-success)', flexShrink: 0 }} />
                      ) : (
                        <XCircle size={16} style={{ color: 'var(--qv-color-danger)', flexShrink: 0 }} />
                      )
                    ) : (
                      <Clock size={16} style={{ color: 'var(--qv-color-primary)', flexShrink: 0 }} />
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--qv-text-primary)' }}>
                        {item.titulo}
                      </span>
                      {item.detalle && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--qv-text-secondary)' }}>
                          {item.detalle}
                        </span>
                      )}
                    </div>
                  </div>

                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--qv-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                    {new Date(item.ts).toLocaleTimeString('es-BO')}
                  </span>
                </div>
              ))}
              {construirTimeline(detalle).length === 0 && (
                <span style={{ color: 'var(--qv-text-muted)', fontSize: '0.8125rem', textAlign: 'center', padding: '1rem' }}>
                  Sin eventos registrados para esta sesión.
                </span>
              )}
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
      titulo: c.validadoPor === 'worker' ? 'Punto de Control (Worker)' : 'Punto de Control (App)',
      detalle: `${c.cumplido ? 'Validado con éxito' : 'Fuera de rango'} a ${c.distanciaM.toFixed(0)}m`,
      cumplido: c.cumplido,
    })),
  ];
  return items.sort((a, b) => a.ts.localeCompare(b.ts));
}

function mensajeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Error inesperado';
}

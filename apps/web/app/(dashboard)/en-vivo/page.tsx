'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Loader, RouteMap } from '@quivo/design-system';
import {
  AlertTriangle,
  ArrowLeft,
  Bus,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Maximize2,
  Navigation,
  Radio,
  RefreshCw,
  User,
} from 'lucide-react';
import { useAuth } from '../../../src/lib/auth/auth-context';
import {
  useContextoEnVivo,
  useRecargarTraza,
  useSesionesEnVivo,
  useTrazaEnVivo,
} from '../../../src/lib/en-vivo/use-en-vivo';
import {
  antiguedadViva,
  formatearAntiguedad,
  intervaloPoll,
  PRESENTACION_FRESCURA,
} from '../../../src/lib/en-vivo/traza';
import { useAdminCity } from '../../../src/lib/geo/use-admin-city';
import {
  construirMarcadores,
  construirRutas,
  construirZonas,
  mensajeError,
  opcionDeSesion,
  ultimaPasada,
} from './map-builders';

function useReloj(): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  return ahora;
}

export default function EnVivoPage() {
  const { token } = useAuth();
  const router = useRouter();

  const sesiones = useSesionesEnVivo(token);
  const [sesionId, setSesionId] = useState<string | null>(null);
  const [seguir, setSeguir] = useState(true);
  const [telemetriaExpandida, setTelemetriaExpandida] = useState(true);
  const [fitKeyOverride, setFitKeyOverride] = useState<number>(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const listado = useMemo(() => sesiones.data ?? [], [sesiones.data]);
  useEffect(() => {
    if (listado.length === 0) return;
    if (sesionId && listado.some((s) => s.id === sesionId)) return;
    setSesionId(listado[0]?.id ?? null);
  }, [listado, sesionId]);

  const contexto = useContextoEnVivo(token, sesionId);
  const traza = useTrazaEnVivo(token, sesionId);
  const recargarTraza = useRecargarTraza(sesionId);

  const sesion = listado.find((s) => s.id === sesionId);
  const datos = traza.data;
  const ultimoPunto = datos?.puntos.at(-1);
  const finalizada = Boolean(datos ? datos.sesionFin : sesion?.fin);
  const pollPausado = intervaloPoll(datos) === false;

  const estado = datos?.estadoFrescura ?? sesion?.estadoFrescura ?? 'sin_datos';
  const presentacion = PRESENTACION_FRESCURA[estado];

  const routes = useMemo(
    () => (contexto.data ? construirRutas(contexto.data, datos) : []),
    [contexto.data, datos],
  );
  const markers = useMemo(
    () => (contexto.data ? construirMarcadores(contexto.data, datos, presentacion.color) : []),
    [contexto.data, datos, presentacion.color],
  );
  const zones = useMemo(() => (contexto.data ? construirZonas(contexto.data) : []), [contexto.data]);

  const cambiarSesion = (nuevo: string) => {
    setSesionId(nuevo);
    setSeguir(true);
    setFitKeyOverride((prev) => prev + 1);
  };

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([sesiones.refetch(), traza.refetch()]);
    recargarTraza();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  if (sesiones.isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '75vh' }}>
        <Loader label="Cargando flota y sesiones activas en vivo..." />
      </div>
    );
  }

  if (sesiones.isError) {
    return (
      <div style={{ padding: '2rem', maxWidth: '40rem', margin: '0 auto' }}>
        <Alert variant="danger" title="No se pudo cargar el listado de sesiones">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <span>{mensajeError(sesiones.error)}</span>
            <span>
              <Button size="sm" variant="secondary" onClick={() => void sesiones.refetch()}>
                Reintentar
              </Button>
            </span>
          </div>
        </Alert>
      </div>
    );
  }

  if (listado.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '70vh',
          gap: '1.25rem',
          padding: '2rem',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: '4rem',
            height: '4rem',
            borderRadius: '50%',
            backgroundColor: 'color-mix(in srgb, var(--qv-color-primary) 12%, transparent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--qv-color-primary)',
          }}
        >
          <Radio size={28} />
        </div>
        <div style={{ maxWidth: '28rem' }}>
          <h2 style={{ fontFamily: 'var(--qv-font-display)', fontSize: '1.25rem', margin: '0 0 0.5rem 0' }}>
            Sin vehículos en ruta activa
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--qv-text-secondary)', margin: 0 }}>
            Ningún vehículo ha iniciado recorrido en la jornada de hoy. En cuanto una terminal móvil sincronice su
            primer punto, aparecerá automáticamente aquí.
          </p>
        </div>
        <Button size="sm" variant="primary" onClick={() => void sesiones.refetch()}>
          <RefreshCw size={14} style={{ marginRight: '0.35rem' }} />
          Verificar nuevamente
        </Button>
      </div>
    );
  }

  const adminCity = useAdminCity();

  return (
    <div className="qv-live-map-wrapper">
      {/* MAPA PRINCIPAL A PANTALLA COMPLETA */}
      <RouteMap
        height="100%"
        loading={contexto.isLoading}
        routes={routes}
        markers={markers}
        zones={zones}
        fitMode="once"
        fitKey={`${sesionId}-${fitKeyOverride}`}
        followPoint={seguir && ultimoPunto ? { lat: ultimoPunto.lat, lng: ultimoPunto.lng } : null}
        onUserPan={() => setSeguir(false)}
        defaultCenter={adminCity.centro}
        defaultZoom={adminCity.zoom}
      />

      {/* TOP FLOATING HUD CONTROLS */}
      <div className="qv-live-hud-top">
        {/* Left Side: Live Badge & Session Selector */}
        <div className="qv-live-hud-card" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => router.push('/')}
            title="Volver al panel administrativo"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              padding: '0.25rem 0.6rem',
              borderRadius: 'var(--qv-radius-full)',
              backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 70%, transparent)',
              color: 'var(--qv-text-secondary)',
              border: '1px solid var(--qv-border-glass)',
              fontSize: '0.6875rem',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all var(--qv-transition-fast)',
            }}
          >
            <ArrowLeft size={13} />
            <span>Panel</span>
          </button>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.2rem 0.55rem',
              borderRadius: 'var(--qv-radius-full)',
              backgroundColor: 'color-mix(in srgb, var(--qv-color-danger) 15%, transparent)',
              color: 'var(--qv-color-danger)',
              fontWeight: 800,
              fontSize: '0.6875rem',
              letterSpacing: '0.05em',
              border: '1px solid color-mix(in srgb, var(--qv-color-danger) 30%, transparent)',
            }}
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: 'var(--qv-color-danger)',
                boxShadow: '0 0 6px var(--qv-color-danger)',
              }}
            />
            LIVE
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Bus size={15} style={{ color: 'var(--qv-color-primary)' }} />
            <select
              value={sesionId ?? ''}
              onChange={(e) => cambiarSesion(e.target.value)}
              aria-label="Seleccionar vehículo en vivo"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--qv-text-primary)',
                fontWeight: 700,
                fontSize: '0.8125rem',
                outline: 'none',
                cursor: 'pointer',
                maxWidth: '22rem',
                textOverflow: 'ellipsis',
              }}
            >
              {listado.map((s) => {
                const opt = opcionDeSesion(s);
                return (
                  <option key={opt.value} value={opt.value} style={{ background: 'var(--qv-surface-card)', color: 'var(--qv-text-primary)' }}>
                    {opt.label}
                  </option>
                );
              })}
            </select>
          </div>
        </div>

        {/* Right Side: Freshness Pill & Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {/* Freshness Status Pill */}
          <FrescuraBadgeCompact
            datos={datos}
            sesion={sesion}
            recibidoEn={traza.dataUpdatedAt}
            sesionesRecibidoEn={sesiones.dataUpdatedAt}
          />

          {/* Map Controls */}
          <div className="qv-live-hud-card" style={{ gap: '0.35rem', padding: '0.3rem 0.5rem' }}>
            <button
              type="button"
              onClick={() => setSeguir((v) => !v)}
              disabled={!ultimoPunto}
              title={seguir ? 'Dejar de seguir vehículo' : 'Seguir vehículo en tiempo real'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.35rem 0.65rem',
                borderRadius: 'var(--qv-radius-md)',
                backgroundColor: seguir
                  ? 'var(--qv-color-primary)'
                  : 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                color: seguir ? '#ffffff' : 'var(--qv-text-secondary)',
                border: 'none',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: ultimoPunto ? 'pointer' : 'not-allowed',
                opacity: ultimoPunto ? 1 : 0.6,
                transition: 'all var(--qv-transition-fast)',
              }}
            >
              <Navigation size={13} style={{ transform: seguir ? 'rotate(45deg)' : 'none' }} />
              <span>{seguir ? 'Siguiendo' : 'Seguir'}</span>
            </button>

            <button
              type="button"
              onClick={() => setFitKeyOverride((v) => v + 1)}
              title="Reencuadrar ruta completa"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '1.85rem',
                height: '1.85rem',
                borderRadius: 'var(--qv-radius-md)',
                backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                color: 'var(--qv-text-secondary)',
                border: 'none',
                cursor: 'pointer',
                transition: 'all var(--qv-transition-fast)',
              }}
            >
              <Maximize2 size={13} />
            </button>

            <button
              type="button"
              onClick={() => void handleManualRefresh()}
              title="Actualizar datos GPS ahora"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '1.85rem',
                height: '1.85rem',
                borderRadius: 'var(--qv-radius-md)',
                backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                color: 'var(--qv-text-secondary)',
                border: 'none',
                cursor: 'pointer',
                transition: 'all var(--qv-transition-fast)',
              }}
            >
              <RefreshCw size={13} style={{ animation: isRefreshing ? 'spin 0.6s linear infinite' : 'none' }} />
            </button>
          </div>
        </div>
      </div>

      {/* FLOATING ALERT TOASTS */}
      {presentacion.esFalla && (
        <div className="qv-live-toast" style={{ borderColor: 'var(--qv-color-danger)', color: 'var(--qv-color-danger)' }}>
          <AlertTriangle size={14} />
          <span>{presentacion.etiqueta}: El teléfono no sincroniza con el servidor</span>
        </div>
      )}

      {estado === 'detenido' && (
        <div className="qv-live-toast" style={{ borderColor: 'var(--qv-color-accent)', color: 'var(--qv-text-primary)' }}>
          <Clock size={14} style={{ color: 'var(--qv-color-accent)' }} />
          <span>Vehículo detenido: Posición estacionaria registrada</span>
        </div>
      )}

      {finalizada && (
        <div className="qv-live-toast" style={{ borderColor: 'var(--qv-color-primary)', color: 'var(--qv-text-primary)' }}>
          <CheckCircle2 size={14} style={{ color: 'var(--qv-color-success)' }} />
          <span>Sesión finalizada</span>
          <button
            type="button"
            onClick={() => router.push(`/reportes/recorridos/${sesionId}`)}
            style={{
              background: 'var(--qv-color-primary)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '999px',
              padding: '0.15rem 0.5rem',
              fontSize: '0.6875rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Ver histórico →
          </button>
        </div>
      )}

      {pollPausado && (
        <div className="qv-live-toast" style={{ borderColor: 'var(--qv-color-warning)', color: 'var(--qv-text-primary)' }}>
          <Clock size={14} style={{ color: 'var(--qv-color-warning)' }} />
          <span>Seguimiento pausado por inactividad</span>
          <button
            type="button"
            onClick={() => void traza.refetch()}
            style={{
              background: 'var(--qv-color-warning)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '999px',
              padding: '0.15rem 0.5rem',
              fontSize: '0.6875rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Reanudar
          </button>
        </div>
      )}

      {/* FLOATING TELEMETRY & CONTROL POINTS DRAWER */}
      {contexto.data && (
        <div className="qv-live-hud-bottom">
          <div className="qv-live-telemetry-panel">
            {/* Header / Summary */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '1.85rem',
                    height: '1.85rem',
                    borderRadius: 'var(--qv-radius-md)',
                    backgroundColor: 'color-mix(in srgb, var(--qv-color-primary) 15%, transparent)',
                    color: 'var(--qv-color-primary)',
                  }}
                >
                  <Bus size={15} />
                </span>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <strong style={{ fontSize: '0.9375rem', color: 'var(--qv-text-primary)' }}>
                      {contexto.data.vehiculo.placa}
                    </strong>
                    <span
                      style={{
                        fontSize: '0.65rem',
                        fontWeight: 700,
                        padding: '0.1rem 0.4rem',
                        borderRadius: 'var(--qv-radius-full)',
                        backgroundColor: contexto.data.linea.color ?? 'var(--qv-color-primary)',
                        color: '#ffffff',
                      }}
                    >
                      {contexto.data.linea.nombre}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--qv-text-secondary)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <User size={11} /> {contexto.data.conductor.nombre}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setTelemetriaExpandida((v) => !v)}
                title={telemetriaExpandida ? 'Minimizar detalles' : 'Expandir telemetría'}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--qv-text-muted)',
                  cursor: 'pointer',
                  padding: '0.25rem',
                }}
              >
                {telemetriaExpandida ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
              </button>
            </div>

            {/* Expanded Telemetry & Control Points */}
            {telemetriaExpandida && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.625rem',
                  paddingTop: '0.5rem',
                  borderTop: '1px solid var(--qv-border-glass)',
                }}
              >
                {/* Telemetry Stats Strip */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
                  <div
                    style={{
                      padding: '0.4rem 0.6rem',
                      borderRadius: 'var(--qv-radius-md)',
                      backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 50%, transparent)',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    <span style={{ fontSize: '0.6875rem', color: 'var(--qv-text-muted)', fontWeight: 600 }}>
                      Última Posición
                    </span>
                    <strong style={{ fontSize: '0.8125rem', color: 'var(--qv-text-primary)' }}>
                      {ultimoPunto ? new Date(ultimoPunto.ts).toLocaleTimeString('es-BO') : 'Esperando fix'}
                    </strong>
                  </div>

                  <div
                    style={{
                      padding: '0.4rem 0.6rem',
                      borderRadius: 'var(--qv-radius-md)',
                      backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 50%, transparent)',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    <span style={{ fontSize: '0.6875rem', color: 'var(--qv-text-muted)', fontWeight: 600 }}>
                      Puntos GPS Traza
                    </span>
                    <strong style={{ fontSize: '0.8125rem', color: 'var(--qv-text-primary)' }}>
                      {datos?.puntos.length ?? 0} registrados
                    </strong>
                  </div>
                </div>

                {/* Control Points Progress */}
                {contexto.data.puntosControl.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--qv-text-muted)' }}>
                        Puntos de Control
                      </span>
                      <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--qv-color-success)' }}>
                        {
                          contexto.data.puntosControl.filter(
                            (pc) => ultimaPasada(datos, pc.id)?.cumplido,
                          ).length
                        }{' '}
                        / {contexto.data.puntosControl.length} validados
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', maxHeight: '5.5rem', overflowY: 'auto' }}>
                      {contexto.data.puntosControl.map((pc, idx) => {
                        const pasada = ultimaPasada(datos, pc.id);
                        const cumplido = pasada?.cumplido;
                        return (
                          <div
                            key={pc.id}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.3rem',
                              padding: '0.2rem 0.45rem',
                              borderRadius: 'var(--qv-radius-sm)',
                              backgroundColor: cumplido
                                ? 'color-mix(in srgb, var(--qv-color-success) 12%, transparent)'
                                : 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                              border: `1px solid ${cumplido ? 'color-mix(in srgb, var(--qv-color-success) 35%, transparent)' : 'var(--qv-border-subtle)'}`,
                              fontSize: '0.6875rem',
                            }}
                          >
                            <span
                              style={{
                                width: '5px',
                                height: '5px',
                                borderRadius: '50%',
                                backgroundColor: cumplido ? 'var(--qv-color-success)' : 'var(--qv-text-muted)',
                              }}
                            />
                            <span style={{ fontWeight: 600, color: 'var(--qv-text-primary)' }}>PC {idx + 1}</span>
                            {pasada && (
                              <span style={{ color: 'var(--qv-text-muted)', fontSize: '0.65rem' }}>
                                ({pasada.distanciaM.toFixed(0)}m)
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FrescuraBadgeCompact({
  datos,
  sesion,
  recibidoEn,
  sesionesRecibidoEn,
}: {
  datos: import('../../../src/lib/en-vivo/traza').TrazaAcumulada | undefined;
  sesion: import('@quivo/shared').SesionEnVivoResumen | undefined;
  recibidoEn: number;
  sesionesRecibidoEn: number;
}) {
  const ahora = useReloj();
  const fuente = datos ?? sesion;
  if (!fuente) return null;

  const referencia = datos ? recibidoEn : sesionesRecibidoEn;
  const presentacion = PRESENTACION_FRESCURA[fuente.estadoFrescura];
  const antiguedadFix = antiguedadViva(fuente.ultimoFixTs, fuente.servidorTs, referencia, ahora);

  return (
    <div className="qv-live-hud-card" style={{ gap: '0.45rem' }}>
      <span
        style={{
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          backgroundColor: presentacion.color,
          boxShadow: `0 0 6px ${presentacion.color}`,
        }}
      />
      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--qv-text-primary)' }}>
        {presentacion.etiqueta}
      </span>
      <span style={{ fontSize: '0.6875rem', color: 'var(--qv-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
        • hace {formatearAntiguedad(antiguedadFix)}
      </span>
    </div>
  );
}


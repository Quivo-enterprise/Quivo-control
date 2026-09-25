'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Loader, RouteMap, Select } from '@quivo/design-system';
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
  usePosicionesEnVivo,
  useRecargarTraza,
  useTrazaEnVivo,
} from '../../../src/lib/en-vivo/use-en-vivo';
import {
  antiguedadViva,
  formatearAntiguedad,
  INTERVALO_POLL_MS,
  intervaloPoll,
  PRESENTACION_FRESCURA,
} from '../../../src/lib/en-vivo/traza';
import { useAdminCity } from '../../../src/lib/geo/use-admin-city';
import { useLineaOptions } from '../../../src/lib/api/use-linea-options';
import {
  construirMarcadoresVehiculos,
  construirPuntosControl,
  construirRutas,
  construirZonas,
  idMarcadorVehiculo,
  mensajeError,
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

  // ENTREGA 13 — `posiciones` (TODOS los vehículos, `GET /reportes/en-vivo/posiciones`)
  // reemplaza al listado de sesiones (`useSesionesEnVivo`) como fuente del mapa: antes el
  // panel dibujaba UNA sesión a la vez, elegida en un `<select>` de ~20 entradas con
  // sesiones muertas (síntomas 1/2/3 del piloto 2026-09-09). Ahora se dibujan todos los
  // vehículos activos y `sesionSeleccionada` es solo "cuál tiene el detalle abierto" — nace
  // `null`, nunca gobierna qué se pinta en el mapa.
  const posiciones = usePosicionesEnVivo(token);
  const { options: lineaOptions } = useLineaOptions();
  const [lineaFilter, setLineaFilter] = useState('');
  const [sesionSeleccionada, setSesionSeleccionada] = useState<string | null>(null);
  const [seguir, setSeguir] = useState(true);
  const [telemetriaExpandida, setTelemetriaExpandida] = useState(true);
  const [fitKeyOverride, setFitKeyOverride] = useState<number>(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const adminCity = useAdminCity();

  const todasLasPosiciones = useMemo(() => posiciones.data ?? [], [posiciones.data]);
  const posicionesFiltradas = useMemo(
    () => (lineaFilter ? todasLasPosiciones.filter((p) => p.lineaId === lineaFilter) : todasLasPosiciones),
    [todasLasPosiciones, lineaFilter],
  );
  // Resumen honesto (pedido explícito del plan post-piloto): un vehículo sin primer fix
  // (`lat`/`lng` `null` — la sesión existe pero nunca entró un punto GPS) no tiene dónde
  // dibujarse, pero tampoco puede desaparecer en silencio del conteo.
  const vehiculosSinFix = useMemo(
    () => posicionesFiltradas.filter((p) => p.lat === null || p.lng === null).length,
    [posicionesFiltradas],
  );
  const vehiculosEnMapa = posicionesFiltradas.length - vehiculosSinFix;

  // ENTREGA 16 — fix de code-review: si el filtro por línea excluye al vehículo con detalle
  // abierto (`sesionSeleccionada`), el panel de detalle, el `followPoint` de la cámara y
  // `animatedVehicle.markerId` seguían activos sobre un vehículo que ya NO está en `markers`
  // (`posicionesFiltradas` lo sacó) — el mapa quedaba "siguiendo" un marker invisible. Se
  // cierra la selección apenas deja de estar en la lista filtrada, en vez de esperar a que el
  // usuario la cierre a mano.
  useEffect(() => {
    if (sesionSeleccionada && !posicionesFiltradas.some((p) => p.id === sesionSeleccionada)) {
      setSesionSeleccionada(null);
      setSeguir(false);
    }
  }, [sesionSeleccionada, posicionesFiltradas]);

  // Click en un marcador de vehículo → recién ahí se piden `contexto` y `traza` de ESA
  // sesión (los hooks ya existentes, sin cambios). Con un solo detalle abierto a la vez, el
  // problema de escalado del poll por sesión (Entrega 10) se resuelve solo.
  const seleccionarSesion = useCallback((id: string) => {
    setSesionSeleccionada(id);
    setSeguir(true);
  }, []);

  const contexto = useContextoEnVivo(token, sesionSeleccionada);
  const traza = useTrazaEnVivo(token, sesionSeleccionada);
  const recargarTraza = useRecargarTraza(sesionSeleccionada);

  // Posición "en vivo" de la sesión seleccionada según el último poll de `/posiciones` — sirve
  // de fallback de presentación (badge de frescura, "finalizada") mientras `contexto`/`traza`
  // todavía no respondieron, y aunque el filtro por línea la haya sacado del mapa.
  const posicionSeleccionada = useMemo(
    () => (sesionSeleccionada ? todasLasPosiciones.find((p) => p.id === sesionSeleccionada) : undefined),
    [todasLasPosiciones, sesionSeleccionada],
  );

  const datos = traza.data;
  const ultimoPunto = datos?.puntos.at(-1);
  const finalizada = Boolean(datos ? datos.sesionFin : posicionSeleccionada && !posicionSeleccionada.activa);
  const pollPausado = Boolean(sesionSeleccionada) && intervaloPoll(datos) === false;

  const estado = datos?.estadoFrescura ?? posicionSeleccionada?.estadoFrescura ?? 'sin_datos';
  const presentacion = PRESENTACION_FRESCURA[estado];

  const puntosControl = useMemo(
    () => (contexto.data ? construirPuntosControl(contexto.data, datos) : []),
    [contexto.data, datos],
  );
  const vehiculos = useMemo(
    () => construirMarcadoresVehiculos(posicionesFiltradas, seleccionarSesion),
    [posicionesFiltradas, seleccionarSesion],
  );
  const markers = useMemo(() => [...puntosControl, ...vehiculos], [puntosControl, vehiculos]);
  const routes = useMemo(
    () => (contexto.data ? construirRutas(contexto.data, datos) : []),
    [contexto.data, datos],
  );
  const zones = useMemo(() => (contexto.data ? construirZonas(contexto.data) : []), [contexto.data]);

  // Animación del marcador de vehículo (`route-map-impl.tsx` hace el trabajo real — ver el
  // comentario de `animatedVehicle` en `RouteMapProps`). Solo se anima la sesión CON DETALLE
  // ABIERTO: es la única con traza de alta resolución (`datos.puntos`) cargada — el resto de
  // los vehículos salta directo entre polls de `/posiciones` (cada 5 s), que es la cadencia
  // que ya tienen. `markerId = idMarcadorVehiculo(sesionSeleccionada)` (Entrega 14): con TODOS
  // los vehículos dibujados a la vez, el id ya no puede ser una constante única — tiene que
  // apuntar exactamente al marker de esta sesión entre los N que trae `vehiculos`.
  const intervaloVigente = intervaloPoll(datos);
  const animatedVehicle = useMemo(
    () =>
      datos && sesionSeleccionada
        ? {
            markerId: idMarcadorVehiculo(sesionSeleccionada),
            resetKey: sesionSeleccionada,
            points: datos.puntos,
            intervalMs: intervaloVigente === false ? INTERVALO_POLL_MS : intervaloVigente,
          }
        : null,
    [datos, sesionSeleccionada, intervaloVigente],
  );

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    // `Promise<unknown>[]` explícito: `posiciones.refetch()` y `traza.refetch()` resuelven a
    // `QueryObserverResult` de tipos de dato distintos (`PosicionEnVivo[]` vs.
    // `TrazaAcumulada`) — un array inferido los unifica y el segundo `push` no tipa.
    const refetches: Promise<unknown>[] = [posiciones.refetch()];
    if (sesionSeleccionada) refetches.push(traza.refetch());
    await Promise.all(refetches);
    if (sesionSeleccionada) recargarTraza();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const cerrarDetalle = () => {
    setSesionSeleccionada(null);
  };

  if (posiciones.isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '75vh' }}>
        <Loader label="Cargando flota en vivo..." />
      </div>
    );
  }

  if (posiciones.isError) {
    return (
      <div style={{ padding: '2rem', maxWidth: '40rem', margin: '0 auto' }}>
        <Alert variant="danger" title="No se pudo cargar la flota en vivo">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <span>{mensajeError(posiciones.error)}</span>
            <span>
              <Button size="sm" variant="secondary" onClick={() => void posiciones.refetch()}>
                Reintentar
              </Button>
            </span>
          </div>
        </Alert>
      </div>
    );
  }

  if (todasLasPosiciones.length === 0) {
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
        <Button size="sm" variant="primary" onClick={() => void posiciones.refetch()}>
          <RefreshCw size={14} style={{ marginRight: '0.35rem' }} />
          Verificar nuevamente
        </Button>
      </div>
    );
  }

  return (
    <div className="qv-live-map-wrapper">
      {/* MAPA PRINCIPAL A PANTALLA COMPLETA */}
      <RouteMap
        height="100%"
        loading={Boolean(sesionSeleccionada) && contexto.isLoading}
        routes={routes}
        markers={markers}
        zones={zones}
        // `fitMode='once'` con `fitKey` fijo a `fitKeyOverride` (NO a `sesionSeleccionada`):
        // los `markers`/`routes` que ve `fitToBounds` son SIEMPRE la unión de la flota
        // filtrada + la sesión con detalle abierto, nunca un subconjunto de "solo lo
        // seleccionado" — encuadrar de nuevo cada vez que cambia la selección terminaría
        // alejando la cámara para mostrar TODA la flota otra vez, justo lo contrario de lo
        // que espera alguien que acaba de tocar un vehículo puntual. El encuadre inicial (a
        // la flota completa) y el botón manual "Reencuadrar" siguen bumpeando `fitKeyOverride`;
        // seguir a un vehículo puntual es trabajo de `followPoint`/`seguir`, no de esto.
        fitKey={fitKeyOverride}
        followPoint={seguir && ultimoPunto ? { lat: ultimoPunto.lat, lng: ultimoPunto.lng } : null}
        onUserPan={() => setSeguir(false)}
        defaultCenter={adminCity.centro}
        defaultZoom={adminCity.zoom}
        animatedVehicle={animatedVehicle}
      />

      {/* TOP FLOATING HUD CONTROLS */}
      <div className="qv-live-hud-top">
        {/* Left Side: Live Badge & Filtro de línea */}
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
            <div style={{ minWidth: '11rem' }}>
              <Select
                aria-label="Filtrar por línea"
                options={[{ label: 'Todas las líneas', value: '' }, ...lineaOptions]}
                placeholder="Todas las líneas"
                value={lineaFilter}
                onChange={(e) => setLineaFilter(e.target.value)}
              />
            </div>
            <span
              style={{
                fontSize: '0.6875rem',
                fontWeight: 700,
                color: 'var(--qv-text-secondary)',
                whiteSpace: 'nowrap',
              }}
            >
              {vehiculosEnMapa} en el mapa
              {vehiculosSinFix > 0 && ` · ${vehiculosSinFix} sin GPS aún`}
            </span>
          </div>
        </div>

        {/* Right Side: Freshness Pill & Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {/* Freshness Status Pill — solo con un vehículo seleccionado */}
          {sesionSeleccionada && (
            <FrescuraBadgeCompact
              datos={datos}
              posicion={posicionSeleccionada}
              recibidoEn={traza.dataUpdatedAt}
              posicionesRecibidoEn={posiciones.dataUpdatedAt}
            />
          )}

          {/* Map Controls */}
          <div className="qv-live-hud-card" style={{ gap: '0.35rem', padding: '0.3rem 0.5rem' }}>
            <button
              type="button"
              onClick={() => setSeguir((v) => !v)}
              disabled={!sesionSeleccionada || !ultimoPunto}
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
                cursor: sesionSeleccionada && ultimoPunto ? 'pointer' : 'not-allowed',
                opacity: sesionSeleccionada && ultimoPunto ? 1 : 0.6,
                transition: 'all var(--qv-transition-fast)',
              }}
            >
              <Navigation size={13} style={{ transform: seguir ? 'rotate(45deg)' : 'none' }} />
              <span>{seguir ? 'Siguiendo' : 'Seguir'}</span>
            </button>

            <button
              type="button"
              onClick={() => setFitKeyOverride((v) => v + 1)}
              title="Reencuadrar toda la flota"
              aria-label="Reencuadrar toda la flota"
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
              aria-label="Actualizar datos GPS ahora"
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

      {/* Filtro sin resultados — estado vacío honesto: la flota existe, esta línea no tiene
          nadie reportando ahora mismo. El mapa sigue montado (el usuario puede cambiar el
          filtro sin perder contexto), a diferencia del empty-state de página completa de
          arriba (que es para "no hay NADA en toda la jornada"). */}
      {posicionesFiltradas.length === 0 && (
        <div className="qv-live-toast" aria-live="polite" style={{ borderColor: 'var(--qv-color-accent)', color: 'var(--qv-text-primary)' }}>
          <AlertTriangle size={14} style={{ color: 'var(--qv-color-accent)' }} />
          <span>Ningún vehículo de esta línea está reportando ahora. Probá con &quot;Todas las líneas&quot;.</span>
        </div>
      )}

      {/* FLOATING ALERT TOASTS */}
      {sesionSeleccionada && presentacion.esFalla && (
        <div className="qv-live-toast" aria-live="polite" style={{ borderColor: 'var(--qv-color-danger)', color: 'var(--qv-color-danger)' }}>
          <AlertTriangle size={14} />
          <span>{presentacion.etiqueta}: El teléfono no sincroniza con el servidor</span>
        </div>
      )}

      {sesionSeleccionada && estado === 'detenido' && (
        <div className="qv-live-toast" aria-live="polite" style={{ borderColor: 'var(--qv-color-accent)', color: 'var(--qv-text-primary)' }}>
          <Clock size={14} style={{ color: 'var(--qv-color-accent)' }} />
          <span>Vehículo detenido: Posición estacionaria registrada</span>
        </div>
      )}

      {finalizada && (
        <div className="qv-live-toast" aria-live="polite" style={{ borderColor: 'var(--qv-color-primary)', color: 'var(--qv-text-primary)' }}>
          <CheckCircle2 size={14} style={{ color: 'var(--qv-color-success)' }} />
          <span>Sesión finalizada</span>
          <button
            type="button"
            onClick={() => router.push(`/reportes/recorridos/${sesionSeleccionada}`)}
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
        <div className="qv-live-toast" aria-live="polite" style={{ borderColor: 'var(--qv-color-warning)', color: 'var(--qv-text-primary)' }}>
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

      {/* FLOATING TELEMETRY & CONTROL POINTS DRAWER — solo con un vehículo seleccionado */}
      {sesionSeleccionada && contexto.data && (
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

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
                <button
                  type="button"
                  onClick={() => setTelemetriaExpandida((v) => !v)}
                  title={telemetriaExpandida ? 'Minimizar detalles' : 'Expandir telemetría'}
                  aria-label={telemetriaExpandida ? 'Minimizar detalles' : 'Expandir telemetría'}
                  aria-expanded={telemetriaExpandida}
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
                <button
                  type="button"
                  onClick={cerrarDetalle}
                  title="Cerrar detalle del vehículo"
                  aria-label="Cerrar detalle del vehículo"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--qv-text-muted)',
                    cursor: 'pointer',
                    padding: '0.25rem',
                    fontSize: '1rem',
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
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
  posicion,
  recibidoEn,
  posicionesRecibidoEn,
}: {
  datos: import('../../../src/lib/en-vivo/traza').TrazaAcumulada | undefined;
  posicion: import('@quivo/shared').PosicionEnVivo | undefined;
  recibidoEn: number;
  posicionesRecibidoEn: number;
}) {
  const ahora = useReloj();
  const fuente = datos ?? posicion;
  if (!fuente) return null;

  const referencia = datos ? recibidoEn : posicionesRecibidoEn;
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

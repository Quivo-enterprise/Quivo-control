import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import MapView, { Circle, Marker, Polyline, PROVIDER_GOOGLE, type LatLng } from 'react-native-maps';
import Svg, { Path } from 'react-native-svg';
import { quivoRadius } from '../../shared/theme/quivo-theme';
import { duracionAnimacionMs, interpolarAngulo, interpolarLatLng } from './movimiento/geo';
import { useEstadoVisual } from './movimiento/store-visual';
import type { PosicionMapaProtocolo } from './route-map-protocol';
import type { RouteMapViewProps } from './route-map-view';

/**
 * Spike `ubicación fluida` (S2, `docs/plan-ubicacion-fluida.md`, Fase C): motor Google nativo
 * (`react-native-maps` + `PROVIDER_GOOGLE`), misma interfaz de props que `RouteMapView`
 * (Leaflet/WebView) para ser intercambiable detrás del toggle de `operation-screen.tsx`
 * (`EXPO_PUBLIC_SPIKE`). Replica la semántica visual de `route-map-html.ts`:
 * - Ruta oscura (#1E1B4B) en espera, naranja (#FE9B0B) en seguimiento activo.
 * - Puntos de control: círculos azules (#3127B1) con número blanco, verdes (#22C55E) los ya
 *   pasados (solo con `tracking`, igual que `isPassed` en `route-map-html.ts`).
 * - Resaltado del tramo OSRM (`rutaCalculada`) en naranja, más grueso, SOLO con `tracking`
 *   activo — mismo criterio que `actualizarCaminoAlProximoPunto()`.
 * - Marcador del conductor: posición interpolada del núcleo de movimiento (`movimiento/geo.ts`),
 *   flecha rotada por rumbo, punto sin flecha mientras no hubo ningún rumbo válido todavía
 *   (`EstadoRumbo.rumbo === null` la primera vez, ver `movimiento/rumbo.ts`), halo de precisión
 *   (`accuracy`), atenuado si `obsoleto`.
 * - Cámara heading-up (`animateCamera({center, heading})`) que sigue al marcador mientras
 *   `tracking`; un pan manual (`onPanDrag`, solo dispara con gesto del usuario, nunca con
 *   `animateCamera` propio) corta el seguimiento — `recenterTick` lo restaura, igual que
 *   `seguimientoActivo` en `route-map-html.ts`.
 *
 * A diferencia de la versión Leaflet, ESTE componente anima la posición mostrada con su propio
 * loop de `requestAnimationFrame` y estado LOCAL (no toca `operation-screen.tsx`): el mapa
 * re-renderiza a la cadencia de la animación, la pantalla padre no.
 */

const COLOR_ESPERA = '#1E1B4B';
const COLOR_LINEA = '#FE9B0B';
const COLOR_PUNTO_CONTROL = '#3127B1';
const COLOR_PUNTO_CONTROL_COMPLETADO = '#22C55E';
const COLOR_FLECHA = '#3127B1';

interface CoordenadaMostrada {
  lat: number;
  lng: number;
  /** `null` SOLO antes de que el núcleo de movimiento haya resuelto algún rumbo válido —
   * dibuja un punto sin flecha (ver docblock del módulo). Una vez conocido, nunca vuelve a
   * `null` (mismo invariante que `EstadoRumbo`, `movimiento/rumbo.ts`). */
  rumbo: number | null;
}

function aLatLng(coordenada: { lat: number; lng: number }): LatLng {
  return { latitude: coordenada.lat, longitude: coordenada.lng };
}

/** Ícono de flecha de navegación — mismo triángulo/colores que `getArrowIcon` en
 * `route-map-html.ts`, rotado con `transform` de `View` en vez de CSS. */
function FlechaConductor({ rumbo, atenuado }: { rumbo: number; atenuado: boolean }) {
  return (
    <View
      style={[styles.flechaContenedor, { transform: [{ rotate: `${rumbo}deg` }] }, atenuado && styles.atenuado]}
    >
      <Svg width={24} height={24} viewBox="0 0 24 24">
        <Path
          d="M12 2L4 20.5l8-3.8 8 3.8Z"
          fill={COLOR_FLECHA}
          stroke="#FFFFFF"
          strokeWidth={2}
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

/** Punto sin flecha — mientras el núcleo de movimiento no resolvió ningún rumbo válido
 * todavía (ver docblock del módulo). */
function PuntoConductor({ atenuado }: { atenuado: boolean }) {
  return <View style={[styles.puntoSinFlecha, atenuado && styles.atenuado]} />;
}

function MarcadorPuntoControl({ orden, completado }: { orden: number; completado: boolean }) {
  return (
    <View
      style={[
        styles.puntoControlMarcador,
        { backgroundColor: completado ? COLOR_PUNTO_CONTROL_COMPLETADO : COLOR_PUNTO_CONTROL },
      ]}
    >
      <Text style={styles.puntoControlTexto}>{orden}</Text>
    </View>
  );
}

export function RouteMapNative({
  paquete,
  proximoPuntoControlId,
  posicionActual,
  tracking,
  recenterTick,
  rutaCalculada,
  style,
}: RouteMapViewProps) {
  const mapRef = useRef<MapView>(null);

  const coordenadasRuta = useMemo<LatLng[]>(
    () => paquete.ruta.geometria.coordinates.map(([lng, lat]) => ({ latitude: lat, longitude: lng })),
    [paquete],
  );

  const puntosControlData = useMemo(
    () =>
      paquete.puntosControl.map((pc, idx) => ({
        id: pc.id,
        orden: idx + 1,
        latitude: pc.coord.coordinates[1],
        longitude: pc.coord.coordinates[0],
      })),
    [paquete],
  );

  const proximoIdx = useMemo(() => {
    if (!proximoPuntoControlId) return -1;
    return puntosControlData.findIndex((pc) => pc.id === proximoPuntoControlId);
  }, [puntosControlData, proximoPuntoControlId]);

  // Misma construcción que `route-map-view.tsx` (posicionParaProtocolo): prioriza el store
  // visual (Fase B) y cae al prop `posicionActual` mientras el store no tiene nada todavía.
  // Duplicado a propósito (no extraído a un helper compartido) — este componente es del spike
  // S2, descartable según lo que decida el CTO con los datos (Fase C del plan).
  const estadoVisual = useEstadoVisual();
  const posicionParaProtocolo = useMemo<PosicionMapaProtocolo | null>(() => {
    if (estadoVisual) {
      return {
        lat: estadoVisual.lat,
        lng: estadoVisual.lng,
        heading: estadoVisual.rumbo,
        accuracy: estadoVisual.accuracy,
        speed: estadoVisual.speed,
        ts: estadoVisual.ts,
        obsoleto: estadoVisual.obsoleto,
      };
    }
    return posicionActual ? { lat: posicionActual.lat, lng: posicionActual.lng } : null;
  }, [estadoVisual, posicionActual]);

  // --- Interpolación de la posición mostrada (núcleo B: geo.ts) ---------------------------
  const [posicionMostrada, setPosicionMostrada] = useState<CoordenadaMostrada | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const ultimoTsFixRef = useRef<number | null>(null);

  const cancelarAnimacion = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!posicionParaProtocolo) return;
    const rumboObjetivo =
      typeof posicionParaProtocolo.heading === 'number' ? posicionParaProtocolo.heading : null;
    const tsFix = posicionParaProtocolo.ts ?? Date.now();
    const dt = ultimoTsFixRef.current != null ? tsFix - ultimoTsFixRef.current : null;
    ultimoTsFixRef.current = tsFix;

    setPosicionMostrada((actual) => {
      const hasta: CoordenadaMostrada = {
        lat: posicionParaProtocolo.lat,
        lng: posicionParaProtocolo.lng,
        rumbo: rumboObjetivo ?? actual?.rumbo ?? null,
      };

      cancelarAnimacion();

      if (!actual) {
        // Primer fix: sin punto de partida que animar, se posiciona directo.
        return hasta;
      }

      const desde: CoordenadaMostrada = actual;
      const duracion = duracionAnimacionMs(dt ?? 2500);
      const inicio = Date.now();

      const tick = () => {
        const t = Math.min(1, (Date.now() - inicio) / duracion);
        const { lat, lng } = interpolarLatLng(desde, hasta, t);
        const rumbo =
          desde.rumbo !== null && hasta.rumbo !== null
            ? interpolarAngulo(desde.rumbo, hasta.rumbo, t)
            : hasta.rumbo;
        setPosicionMostrada({ lat, lng, rumbo });
        if (t < 1) {
          rafIdRef.current = requestAnimationFrame(tick);
        } else {
          rafIdRef.current = null;
        }
      };
      rafIdRef.current = requestAnimationFrame(tick);
      // No cambia el estado todavía — lo hace el primer `tick()`, ya encolado.
      return actual;
    });

    return cancelarAnimacion;
  }, [posicionParaProtocolo, cancelarAnimacion]);

  useEffect(() => cancelarAnimacion, [cancelarAnimacion]);

  // --- Cámara heading-up con seguimiento -------------------------------------------------
  const [seguimientoActivo, setSeguimientoActivo] = useState(false);
  useEffect(() => setSeguimientoActivo(tracking), [tracking]);

  useEffect(() => {
    if (!seguimientoActivo || !posicionMostrada) return;
    mapRef.current?.animateCamera(
      { center: aLatLng(posicionMostrada), heading: posicionMostrada.rumbo ?? 0 },
      { duration: 250 },
    );
  }, [seguimientoActivo, posicionMostrada]);

  const onPanDrag = useCallback(() => setSeguimientoActivo(false), []);

  const lastRecenter = useRef(recenterTick);
  useEffect(() => {
    if (recenterTick <= lastRecenter.current) return;
    lastRecenter.current = recenterTick;
    setSeguimientoActivo(true);
    if (posicionMostrada) {
      mapRef.current?.animateCamera(
        { center: aLatLng(posicionMostrada), heading: posicionMostrada.rumbo ?? 0 },
        { duration: 400 },
      );
    } else if (coordenadasRuta.length > 0) {
      mapRef.current?.fitToCoordinates(coordenadasRuta, {
        edgePadding: { top: 80, right: 20, bottom: 180, left: 20 },
        animated: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterTick]);

  const onMapReady = useCallback(() => {
    if (coordenadasRuta.length > 0) {
      mapRef.current?.fitToCoordinates(coordenadasRuta, {
        edgePadding: { top: 80, right: 20, bottom: 180, left: 20 },
        animated: false,
      });
    }
  }, [coordenadasRuta]);

  const mostrarCaminoResaltado = tracking && rutaCalculada && rutaCalculada.length >= 2;
  const caminoResaltadoCoords = useMemo<LatLng[]>(
    () => (rutaCalculada ?? []).map(([lng, lat]) => ({ latitude: lat, longitude: lng })),
    [rutaCalculada],
  );

  return (
    <View style={[styles.container, style]}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        onMapReady={onMapReady}
        onPanDrag={onPanDrag}
        rotateEnabled
        showsCompass={false}
      >
        <Polyline
          coordinates={coordenadasRuta}
          strokeColor={tracking ? COLOR_LINEA : COLOR_ESPERA}
          strokeWidth={tracking ? 5.5 : 4.5}
          lineCap="round"
          lineJoin="round"
        />
        {mostrarCaminoResaltado ? (
          <Polyline
            coordinates={caminoResaltadoCoords}
            strokeColor={COLOR_LINEA}
            strokeWidth={5.5}
            lineCap="round"
            lineJoin="round"
            zIndex={2}
          />
        ) : null}

        {puntosControlData.map((pc, idx) => (
          <Marker key={pc.id} coordinate={{ latitude: pc.latitude, longitude: pc.longitude }} anchor={{ x: 0.5, y: 0.5 }}>
            <MarcadorPuntoControl orden={pc.orden} completado={tracking && proximoIdx > 0 && idx < proximoIdx} />
          </Marker>
        ))}

        {posicionMostrada ? (
          <>
            <Marker coordinate={aLatLng(posicionMostrada)} anchor={{ x: 0.5, y: 0.5 }} zIndex={10}>
              {posicionMostrada.rumbo === null ? (
                <PuntoConductor atenuado={!!posicionParaProtocolo?.obsoleto} />
              ) : (
                <FlechaConductor rumbo={posicionMostrada.rumbo} atenuado={!!posicionParaProtocolo?.obsoleto} />
              )}
            </Marker>
            {typeof posicionParaProtocolo?.accuracy === 'number' && Number.isFinite(posicionParaProtocolo.accuracy) ? (
              <Circle
                center={aLatLng(posicionMostrada)}
                radius={posicionParaProtocolo.accuracy}
                fillColor="rgba(49,39,177,0.12)"
                strokeColor="rgba(49,39,177,0.35)"
                strokeWidth={1}
                zIndex={1}
              />
            ) : null}
          </>
        ) : null}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { height: 260, borderRadius: quivoRadius.lg, overflow: 'hidden' },
  map: { flex: 1 },
  flechaContenedor: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  puntoSinFlecha: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: COLOR_FLECHA,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  atenuado: { opacity: 0.4 },
  puntoControlMarcador: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  puntoControlTexto: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 11.5,
  },
});

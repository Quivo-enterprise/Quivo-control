import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import MapView, { Circle, Marker, Polyline, PROVIDER_GOOGLE, type LatLng } from 'react-native-maps';
import Svg, { Path } from 'react-native-svg';
import { quivoRadius } from '../../shared/theme/quivo-theme';
import { construirCamaraSeguimiento } from './movimiento/camara-seguimiento';
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
 * PERF (hallazgos de revisión del spike, corregidos acá): el marcador del conductor (+ su halo
 * de precisión) vive en `MarcadorConductorAnimado`, un componente hijo con su PROPIO loop de
 * `requestAnimationFrame` y estado local — es el ÚNICO que re-renderiza a la cadencia de la
 * animación (~60Hz); este componente padre (polylines, puntos de control) no vuelve a
 * renderizar por eso. La cámara se anima UNA sola vez por fix nuevo (no por frame), en el mismo
 * lugar donde arranca la interpolación del marcador.
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
 * `route-map-html.ts`. La rotación NO vive acá: la aplica el `Marker` vía su prop nativa
 * `rotation` (ver `MarcadorConductorAnimado`) — esta vista siempre apunta al norte. */
function FlechaConductor() {
  return (
    <View style={styles.flechaContenedor}>
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
function PuntoConductor() {
  return <View style={styles.puntoSinFlecha} />;
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

/** `true` mientras la vista custom del `Marker` todavía no terminó su primer pintado (o acaba
 * de cambiar de contenido) — Android re-rasteriza el bitmap del marcador en cada render
 * mientras `tracksViewChanges` esté en `true`, así que se apaga apenas el frame siguiente
 * confirma que ya pintó. Hook compartido por el marcador del conductor y los de puntos de
 * control (hallazgo de revisión: performance). */
function useTracksViewChanges(): [boolean, () => void] {
  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  useEffect(() => {
    if (!tracksViewChanges) return;
    const id = requestAnimationFrame(() => setTracksViewChanges(false));
    return () => cancelAnimationFrame(id);
  }, [tracksViewChanges]);
  const reactivar = useCallback(() => setTracksViewChanges(true), []);
  return [tracksViewChanges, reactivar];
}

interface MarcadorConductorAnimadoProps {
  posicionParaProtocolo: PosicionMapaProtocolo | null;
  mapRef: RefObject<MapView | null>;
  seguimientoActivoRef: RefObject<boolean>;
  /** true = la próxima cámara de seguimiento debe fijar el zoom (se acaba de entrar en
   * seguimiento); quien la consume lo baja a false. Ver `camara-seguimiento.ts`. */
  zoomPendienteRef: RefObject<boolean>;
  /** Ref compartido con el padre (`RouteMapNative`): este componente escribe acá la última
   * posición mostrada para que el recenter manual (que vive en el padre) la lea sin necesidad
   * de que el padre también re-renderice por cada frame de la animación. */
  posicionMostradaRef: RefObject<CoordenadaMostrada | null>;
}

/**
 * Marcador del conductor + halo de precisión, con su PROPIO loop de `requestAnimationFrame` —
 * único componente que re-renderiza a la cadencia de la animación (~60Hz mientras interpola
 * entre dos fixes). Ver el docblock del módulo para el razonamiento completo de por qué se
 * extrajo del padre.
 */
const MarcadorConductorAnimado = memo(function MarcadorConductorAnimado({
  posicionParaProtocolo,
  mapRef,
  seguimientoActivoRef,
  zoomPendienteRef,
  posicionMostradaRef,
}: MarcadorConductorAnimadoProps) {
  const [posicionMostrada, setPosicionMostrada] = useState<CoordenadaMostrada | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const ultimoTsFixRef = useRef<number | null>(null);
  const [tracksViewChanges, reactivarTracksViewChanges] = useTracksViewChanges();
  const tipoMarcadorAnteriorRef = useRef<'flecha' | 'punto' | null>(null);

  const cancelarAnimacion = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  // Publica la posición nueva en el ref compartido (para el recenter del padre) y en el
  // estado local (para volver a pintar este marcador). Si cambia el TIPO de hijo del marcador
  // (punto → flecha, la única transición posible, ver `CoordenadaMostrada`), re-habilita
  // `tracksViewChanges` un frame para que Android rasterice el nuevo contenido.
  const publicarPosicion = useCallback(
    (siguiente: CoordenadaMostrada) => {
      posicionMostradaRef.current = siguiente;
      setPosicionMostrada(siguiente);
      const tipoActual: 'flecha' | 'punto' = siguiente.rumbo === null ? 'punto' : 'flecha';
      if (
        tipoMarcadorAnteriorRef.current !== null &&
        tipoMarcadorAnteriorRef.current !== tipoActual
      ) {
        reactivarTracksViewChanges();
      }
      tipoMarcadorAnteriorRef.current = tipoActual;
    },
    [posicionMostradaRef, reactivarTracksViewChanges],
  );

  // FIX POST-REVISIÓN (hallazgo ALTO #1 + MEDIO #4): antes, la cámara se animaba en un efecto
  // aparte disparado por CADA frame de `posicionMostrada` (~60Hz, saturaba el bridge), y el
  // arranque del RAF vivía DENTRO del updater de `setPosicionMostrada` (side effect impuro —
  // StrictMode corre updaters dos veces, duplicando la cadena). Ahora todo arranca acá, una
  // sola vez por FIX NUEVO (no por frame): la posición "actual" se lee de `posicionMostradaRef`
  // en vez de un updater, y la cámara se anima hacia `hasta` con la MISMA duración que la
  // interpolación del marcador — nunca por frame.
  useEffect(() => {
    if (!posicionParaProtocolo) return;
    const rumboObjetivo =
      typeof posicionParaProtocolo.heading === 'number' ? posicionParaProtocolo.heading : null;
    const tsFix = posicionParaProtocolo.ts ?? Date.now();
    const dt = ultimoTsFixRef.current != null ? tsFix - ultimoTsFixRef.current : null;
    ultimoTsFixRef.current = tsFix;
    const duracion = duracionAnimacionMs(dt ?? 2500);

    const actual = posicionMostradaRef.current;
    const hasta: CoordenadaMostrada = {
      lat: posicionParaProtocolo.lat,
      lng: posicionParaProtocolo.lng,
      rumbo: rumboObjetivo ?? actual?.rumbo ?? null,
    };

    cancelarAnimacion();

    // Hallazgo ALTO #1 (perf) + BAJO #5: cámara UNA vez por fix, solo con seguimiento activo;
    // sin rumbo todavía no se manda `heading` (conserva el actual en vez de snapear a norte).
    if (seguimientoActivoRef.current) {
      const aplicarZoom = zoomPendienteRef.current;
      zoomPendienteRef.current = false;
      mapRef.current?.animateCamera(construirCamaraSeguimiento(hasta, aplicarZoom), {
        duration: duracion,
      });
    }

    if (!actual) {
      // Primer fix: sin punto de partida que animar, se posiciona directo.
      publicarPosicion(hasta);
      return cancelarAnimacion;
    }

    const desde: CoordenadaMostrada = actual;
    const inicio = Date.now();
    const tick = () => {
      const t = Math.min(1, (Date.now() - inicio) / duracion);
      const { lat, lng } = interpolarLatLng(desde, hasta, t);
      const rumbo =
        desde.rumbo !== null && hasta.rumbo !== null
          ? interpolarAngulo(desde.rumbo, hasta.rumbo, t)
          : hasta.rumbo;
      publicarPosicion({ lat, lng, rumbo });
      if (t < 1) {
        rafIdRef.current = requestAnimationFrame(tick);
      } else {
        rafIdRef.current = null;
      }
    };
    rafIdRef.current = requestAnimationFrame(tick);

    return cancelarAnimacion;
  }, [posicionParaProtocolo, cancelarAnimacion, publicarPosicion, mapRef, seguimientoActivoRef, posicionMostradaRef]);

  useEffect(() => cancelarAnimacion, [cancelarAnimacion]);

  if (!posicionMostrada) return null;

  const atenuado = !!posicionParaProtocolo?.obsoleto;

  return (
    <>
      {/* Hallazgo ALTO #3: rotación y atenuado por props NATIVAS del Marker (`rotation`,
          `flat`, `opacity`) — la vista hija nunca rota ni cambia opacity, así que Android no
          tiene que re-rasterizar el bitmap por eso. `flat` hace la rotación relativa al norte
          del mapa (correcta con la cámara heading-up de arriba). */}
      <Marker
        coordinate={aLatLng(posicionMostrada)}
        anchor={{ x: 0.5, y: 0.5 }}
        zIndex={10}
        rotation={posicionMostrada.rumbo ?? 0}
        flat
        opacity={atenuado ? 0.4 : 1}
        tracksViewChanges={tracksViewChanges}
      >
        {posicionMostrada.rumbo === null ? <PuntoConductor /> : <FlechaConductor />}
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
  );
});

interface RutaPolylinesProps {
  coordenadasRuta: LatLng[];
  tracking: boolean;
  mostrarCaminoResaltado: boolean;
  caminoResaltadoCoords: LatLng[];
}

/** Hallazgo ALTO #2 (perf): memoizado — no vuelve a renderizar (ni a re-diffear sus
 * `Polyline`) por cambios ajenos a estas props, como la animación del marcador del conductor
 * (que ya no vive en este árbol de todos modos, ver `MarcadorConductorAnimado`). */
const RutaPolylines = memo(function RutaPolylines({
  coordenadasRuta,
  tracking,
  mostrarCaminoResaltado,
  caminoResaltadoCoords,
}: RutaPolylinesProps) {
  return (
    <>
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
    </>
  );
});

interface MarcadorPuntoControlItemProps {
  orden: number;
  latitude: number;
  longitude: number;
  completado: boolean;
}

/** Un punto de control individual, memoizado por sus propias props — re-habilita
 * `tracksViewChanges` un frame SOLO cuando `completado` cambia (el punto pasa a verde), igual
 * criterio que el marcador del conductor. */
const MarcadorPuntoControlItem = memo(function MarcadorPuntoControlItem({
  orden,
  latitude,
  longitude,
  completado,
}: MarcadorPuntoControlItemProps) {
  const [tracksViewChanges, reactivarTracksViewChanges] = useTracksViewChanges();
  const completadoAnteriorRef = useRef(completado);
  useEffect(() => {
    if (completadoAnteriorRef.current !== completado) {
      completadoAnteriorRef.current = completado;
      reactivarTracksViewChanges();
    }
  }, [completado, reactivarTracksViewChanges]);

  return (
    <Marker
      coordinate={{ latitude, longitude }}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={tracksViewChanges}
    >
      <MarcadorPuntoControl orden={orden} completado={completado} />
    </Marker>
  );
});

interface PuntoControlData {
  id: string;
  orden: number;
  latitude: number;
  longitude: number;
}

interface PuntosControlMarcadoresProps {
  puntosControlData: PuntoControlData[];
  tracking: boolean;
  proximoIdx: number;
}

/** Hallazgo ALTO #2 (perf): memoizado — el `.map()` completo se salta si ninguna de estas
 * props cambió desde el último render. */
const PuntosControlMarcadores = memo(function PuntosControlMarcadores({
  puntosControlData,
  tracking,
  proximoIdx,
}: PuntosControlMarcadoresProps) {
  return (
    <>
      {puntosControlData.map((pc, idx) => (
        <MarcadorPuntoControlItem
          key={pc.id}
          orden={pc.orden}
          latitude={pc.latitude}
          longitude={pc.longitude}
          completado={tracking && proximoIdx > 0 && idx < proximoIdx}
        />
      ))}
    </>
  );
});

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

  // Última posición mostrada por `MarcadorConductorAnimado` — ese componente la escribe acá en
  // cada frame de su animación; este padre solo la LEE (recenter manual), nunca dispara un
  // re-render por escribirla (es un ref, no estado).
  const posicionMostradaRef = useRef<CoordenadaMostrada | null>(null);

  // --- Cámara heading-up con seguimiento -------------------------------------------------
  const [seguimientoActivo, setSeguimientoActivo] = useState(false);
  // Zoom de seguimiento (equivalente al 17 de Leaflet): se fija solo al ENTRAR en seguimiento
  // (tracking arranca o recenter), no en cada fix — no se le pisa el pinch al usuario.
  const zoomPendienteRef = useRef(false);
  useEffect(() => {
    if (tracking) zoomPendienteRef.current = true;
    setSeguimientoActivo(tracking);
  }, [tracking]);
  const seguimientoActivoRef = useRef(seguimientoActivo);
  useEffect(() => {
    seguimientoActivoRef.current = seguimientoActivo;
  }, [seguimientoActivo]);

  const onPanDrag = useCallback(() => setSeguimientoActivo(false), []);

  const lastRecenter = useRef(recenterTick);
  useEffect(() => {
    if (recenterTick <= lastRecenter.current) return;
    lastRecenter.current = recenterTick;
    setSeguimientoActivo(true);
    const posicion = posicionMostradaRef.current;
    if (posicion) {
      zoomPendienteRef.current = false;
      mapRef.current?.animateCamera(construirCamaraSeguimiento(posicion, true), { duration: 400 });
    } else if (coordenadasRuta.length > 0) {
      zoomPendienteRef.current = true;
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

  const mostrarCaminoResaltado = tracking && !!rutaCalculada && rutaCalculada.length >= 2;
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
        toolbarEnabled={false}
        showsCompass={false}
      >
        <RutaPolylines
          coordenadasRuta={coordenadasRuta}
          tracking={tracking}
          mostrarCaminoResaltado={mostrarCaminoResaltado}
          caminoResaltadoCoords={caminoResaltadoCoords}
        />
        <PuntosControlMarcadores
          puntosControlData={puntosControlData}
          tracking={tracking}
          proximoIdx={proximoIdx}
        />
        <MarcadorConductorAnimado
          posicionParaProtocolo={posicionParaProtocolo}
          mapRef={mapRef}
          seguimientoActivoRef={seguimientoActivoRef}
          zoomPendienteRef={zoomPendienteRef}
          posicionMostradaRef={posicionMostradaRef}
        />
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

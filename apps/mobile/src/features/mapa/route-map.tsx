import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import MapView, { Circle, Marker, Polyline, PROVIDER_GOOGLE, type LatLng } from 'react-native-maps';
import Svg, { Path } from 'react-native-svg';
import { quivoRadius } from '../../shared/theme/quivo-theme';
import { duracionAnimacionMs, interpolarAngulo, interpolarLatLng } from '../operacion/movimiento/geo';
import { useEstadoVisual } from '../operacion/movimiento/store-visual';
import { PADDING_ENCUADRE_RUTA, construirCamaraSeguimiento, decidirEncuadre } from './camara';
import {
  colorPuntoControl,
  esPuntoControlPasado,
  indiceProximoPuntoControl,
} from './estado-punto-control';
import { debeResaltarRutaCalculada, estiloRuta, COLOR_LINEA } from './estilo-ruta';
import { posicionMapaDesde } from './posicion-mapa';
import type { PosicionMapa, RouteMapProps } from './tipos';

/**
 * Mapa de la ruta activa — motor Google nativo (`react-native-maps` + `PROVIDER_GOOGLE`), el
 * único motor de la app (`docs/adr/0004-motor-mapa-google.md`; reemplazó a Leaflet + WebView).
 * Semántica visual:
 * - Ruta oscura (#1E1B4B) en espera, naranja (#FE9B0B) en seguimiento activo (`estilo-ruta.ts`).
 * - Puntos de control: círculos azules (#3127B1) con número blanco, verdes (#22C55E) los ya
 *   pasados, solo con `tracking` (`estado-punto-control.ts`).
 * - Resaltado del tramo OSRM (`rutaCalculada`) en naranja, SOLO con `tracking` activo.
 * - Marcador del conductor: posición interpolada del núcleo de movimiento (`movimiento/geo.ts`),
 *   flecha rotada por rumbo, punto sin flecha mientras no hubo ningún rumbo válido todavía
 *   (`EstadoRumbo.rumbo === null` la primera vez, ver `movimiento/rumbo.ts`), halo de precisión
 *   (`accuracy`), atenuado si `obsoleto`. Sin posición no hay marcador.
 * - Encuadre inicial de la ruta (`fitToCoordinates` con márgenes), y de nuevo al terminar el
 *   seguimiento o al recentrar sin posición conocida (`camara.ts`).
 * - Cámara heading-up (`animateCamera({center, heading})`) que sigue al marcador mientras
 *   `tracking`; un pan manual (`onPanDrag`, solo dispara con gesto del usuario, nunca con
 *   `animateCamera` propio) corta el seguimiento — `recenterTick` lo restaura.
 *
 * PERF: el marcador del conductor (+ su halo de precisión) vive en `MarcadorConductorAnimado`,
 * un componente hijo con su PROPIO loop de `requestAnimationFrame` y estado local — es el ÚNICO
 * que re-renderiza a la cadencia de la animación (~60Hz); este componente padre (polylines,
 * puntos de control) no vuelve a renderizar por eso. La cámara se anima UNA sola vez por fix
 * nuevo (no por frame), en el mismo lugar donde arranca la interpolación del marcador.
 */

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

/** Ícono de flecha de navegación (triángulo azul con borde blanco). La rotación NO vive acá: la aplica el `Marker` vía su prop nativa
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
        { backgroundColor: colorPuntoControl(completado) },
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
 * control . */
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
  posicionMapa: PosicionMapa | null;
  mapRef: RefObject<MapView | null>;
  seguimientoActivoRef: RefObject<boolean>;
  /** true = la próxima cámara de seguimiento debe fijar el zoom (se acaba de entrar en
   * seguimiento); quien la consume lo baja a false. Ver `camara-seguimiento.ts`. */
  zoomPendienteRef: RefObject<boolean>;
  /** Ref compartido con el padre (`RouteMap`): este componente escribe acá la última
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
  posicionMapa,
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
    if (!posicionMapa) return;
    const rumboObjetivo =
      typeof posicionMapa.heading === 'number' ? posicionMapa.heading : null;
    const tsFix = posicionMapa.ts ?? Date.now();
    const dt = ultimoTsFixRef.current != null ? tsFix - ultimoTsFixRef.current : null;
    ultimoTsFixRef.current = tsFix;
    const duracion = duracionAnimacionMs(dt ?? 2500);

    const actual = posicionMostradaRef.current;
    const hasta: CoordenadaMostrada = {
      lat: posicionMapa.lat,
      lng: posicionMapa.lng,
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
  }, [posicionMapa, cancelarAnimacion, publicarPosicion, mapRef, seguimientoActivoRef, zoomPendienteRef, posicionMostradaRef]);

  useEffect(() => cancelarAnimacion, [cancelarAnimacion]);

  if (!posicionMostrada) return null;

  const atenuado = !!posicionMapa?.obsoleto;

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
      {typeof posicionMapa?.accuracy === 'number' && Number.isFinite(posicionMapa.accuracy) ? (
        <Circle
          center={aLatLng(posicionMostrada)}
          radius={posicionMapa.accuracy}
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
  const estilo = estiloRuta(tracking);
  return (
    <>
      <Polyline
        coordinates={coordenadasRuta}
        strokeColor={estilo.color}
        strokeWidth={estilo.grosor}
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
          completado={esPuntoControlPasado(idx, proximoIdx, tracking)}
        />
      ))}
    </>
  );
});

export function RouteMap({
  paquete,
  proximoPuntoControlId,
  posicionActual,
  tracking,
  recenterTick,
  rutaCalculada,
  style,
}: RouteMapProps) {
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

  const proximoIdx = useMemo(
    () =>
      indiceProximoPuntoControl(
        puntosControlData.map((pc) => pc.id),
        proximoPuntoControlId,
      ),
    [puntosControlData, proximoPuntoControlId],
  );

  // Prioriza el store visual y cae al prop `posicionActual` mientras el store no tiene nada.
  const estadoVisual = useEstadoVisual();
  const posicionMapa = useMemo<PosicionMapa | null>(
    () => posicionMapaDesde(estadoVisual, posicionActual),
    [estadoVisual, posicionActual],
  );

  // Última posición mostrada por `MarcadorConductorAnimado` — ese componente la escribe acá en
  // cada frame de su animación; este padre solo la LEE (recenter manual), nunca dispara un
  // re-render por escribirla (es un ref, no estado).
  const posicionMostradaRef = useRef<CoordenadaMostrada | null>(null);

  // Encuadra la ruta entera (o centra en el vehículo si el paquete no trae geometría, ver
  // `decidirEncuadre`). `fitToCoordinates` reemplaza al `fitBounds` de Leaflet.
  const encuadrarRuta = useCallback(
    (animated: boolean) => {
      const posicion = posicionMostradaRef.current;
      const accion = decidirEncuadre(coordenadasRuta.length, posicion !== null);
      if (accion === 'ajustar-ruta') {
        mapRef.current?.fitToCoordinates(coordenadasRuta, {
          edgePadding: { ...PADDING_ENCUADRE_RUTA },
          animated,
        });
      } else if (accion === 'centrar-posicion' && posicion) {
        mapRef.current?.animateCamera(construirCamaraSeguimiento(posicion, true), {
          duration: animated ? 400 : 0,
        });
      }
    },
    [coordenadasRuta],
  );

  // --- Cámara heading-up con seguimiento -------------------------------------------------
  const [seguimientoActivo, setSeguimientoActivo] = useState(false);
  // Zoom de seguimiento: se fija solo al ENTRAR en seguimiento (tracking arranca o recenter),
  // no en cada fix — no se le pisa el pinch al usuario.
  const zoomPendienteRef = useRef(false);
  const trackingPrevioRef = useRef(tracking);
  useEffect(() => {
    const previo = trackingPrevioRef.current;
    trackingPrevioRef.current = tracking;
    if (tracking) {
      // Entra en seguimiento: va al vehículo de una (sin esperar al próximo fix) si ya se lo
      // conoce; si no, el zoom queda pendiente para la primera cámara de seguimiento.
      const posicion = posicionMostradaRef.current;
      if (posicion) {
        zoomPendienteRef.current = false;
        mapRef.current?.animateCamera(construirCamaraSeguimiento(posicion, true), { duration: 700 });
      } else {
        zoomPendienteRef.current = true;
      }
    } else if (previo) {
      // Fin del seguimiento: vuelve a mostrar la ruta entera.
      encuadrarRuta(true);
    }
    setSeguimientoActivo(tracking);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    } else {
      zoomPendienteRef.current = true;
      encuadrarRuta(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterTick]);

  const onMapReady = useCallback(() => encuadrarRuta(false), [encuadrarRuta]);

  const mostrarCaminoResaltado = debeResaltarRutaCalculada(tracking, rutaCalculada);
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
        // Sin tilt y sin controles propios de Google: el mapa anterior (Leaflet) no los tenía.
        pitchEnabled={false}
        zoomControlEnabled={false}
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
          posicionMapa={posicionMapa}
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

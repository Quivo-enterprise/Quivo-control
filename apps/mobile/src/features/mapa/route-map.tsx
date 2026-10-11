import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { StyleSheet, View, Text, type LayoutChangeEvent } from 'react-native';
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
import { debeCommitearFrame, posicionMapaDesde } from './posicion-mapa';
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
 * que re-renderiza a la cadencia de la animación (~30Hz, ver `debeCommitearFrame`); este componente padre (polylines,
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

/** Ventana (ms) en que el `Marker` re-rasteriza su vista custom tras montar o cambiar de
 * contenido: cubre el layout del `Text` de los puntos de control, que un solo frame no alcanza. */
const VENTANA_TRACKS_VIEW_CHANGES_MS = 300;

/** `true` mientras la vista custom del `Marker` todavía no terminó su primer pintado (o acaba
 * de cambiar de contenido) — Android re-rasteriza el bitmap del marcador en cada render
 * mientras `tracksViewChanges` esté en `true`, así que se apaga tras una ventana corta. La
 * ventana arranca cuando el componente que usa el hook MONTA (que debe ser el que renderiza el
 * `Marker`) y se reinicia con `reactivar()`. Compartido por el marcador del conductor y los de
 * puntos de control. */
function useTracksViewChanges(): [boolean, () => void] {
  const [epoca, setEpoca] = useState(0);
  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  useEffect(() => {
    setTracksViewChanges(true);
    const id = setTimeout(() => setTracksViewChanges(false), VENTANA_TRACKS_VIEW_CHANGES_MS);
    return () => clearTimeout(id);
  }, [epoca]);
  const reactivar = useCallback(() => setEpoca((e) => e + 1), []);
  return [tracksViewChanges, reactivar];
}

/** `Marker` del conductor: vive aparte para que la ventana de `tracksViewChanges` arranque al
 * montar el Marker (no antes, cuando todavía no hay posición) y se reinicie al pasar de punto a
 * flecha (la única transición posible, ver `CoordenadaMostrada`). */
function MarcadorConductor({
  posicion,
  atenuado,
}: {
  posicion: CoordenadaMostrada;
  atenuado: boolean;
}) {
  const [tracksViewChanges, reactivarTracksViewChanges] = useTracksViewChanges();
  const esPunto = posicion.rumbo === null;
  const esPuntoPrevioRef = useRef(esPunto);
  useEffect(() => {
    if (esPuntoPrevioRef.current !== esPunto) {
      esPuntoPrevioRef.current = esPunto;
      reactivarTracksViewChanges();
    }
  }, [esPunto, reactivarTracksViewChanges]);

  return (
    // Hallazgo ALTO #3: rotación y atenuado por props NATIVAS del Marker (`rotation`, `flat`,
    // `opacity`) — la vista hija nunca rota ni cambia opacity, así que Android no tiene que
    // re-rasterizar el bitmap por eso. `flat` hace la rotación relativa al norte del mapa
    // (correcta con la cámara heading-up).
    <Marker
      coordinate={aLatLng(posicion)}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={10}
      rotation={posicion.rumbo ?? 0}
      flat
      opacity={atenuado ? 0.4 : 1}
      tracksViewChanges={tracksViewChanges}
    >
      {esPunto ? <PuntoConductor /> : <FlechaConductor />}
    </Marker>
  );
}

interface MarcadorConductorAnimadoProps {
  posicionMapa: PosicionMapa | null;
  mapRef: RefObject<MapView | null>;
  seguimientoActivoRef: RefObject<boolean>;
  /** true = la próxima cámara de seguimiento debe fijar el zoom (se acaba de entrar en
   * seguimiento); quien la consume lo baja a false SOLO si la cámara realmente se animó. */
  zoomPendienteRef: RefObject<boolean>;
  /** true cuando el mapa está listo Y ya tuvo layout (ver `RouteMap`); antes no se anima nada. */
  camaraListaRef: RefObject<boolean>;
  /** Ref compartido con el padre (`RouteMap`): este componente escribe acá la última
   * posición mostrada para que el recenter manual (que vive en el padre) la lea sin necesidad
   * de que el padre también re-renderice por cada frame de la animación. */
  posicionMostradaRef: RefObject<CoordenadaMostrada | null>;
}

/**
 * Marcador del conductor + halo de precisión, con su PROPIO loop de `requestAnimationFrame` —
 * único componente que re-renderiza a la cadencia de la animación (~30Hz mientras interpola
 * entre dos fixes). Ver el docblock del módulo para el razonamiento completo de por qué se
 * extrajo del padre.
 */
const MarcadorConductorAnimado = memo(function MarcadorConductorAnimado({
  posicionMapa,
  mapRef,
  seguimientoActivoRef,
  zoomPendienteRef,
  camaraListaRef,
  posicionMostradaRef,
}: MarcadorConductorAnimadoProps) {
  const [posicionMostrada, setPosicionMostrada] = useState<CoordenadaMostrada | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const ultimoTsFixRef = useRef<number | null>(null);

  const cancelarAnimacion = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  // Publica la posición nueva en el ref compartido (para el recenter del padre) y en el
  // estado local (para volver a pintar este marcador).
  const publicarPosicion = useCallback(
    (siguiente: CoordenadaMostrada | null) => {
      posicionMostradaRef.current = siguiente;
      setPosicionMostrada(siguiente);
    },
    [posicionMostradaRef],
  );

  // El efecto depende del CONTENIDO del fix (lat/lng/ts/rumbo), no de la identidad del objeto
  // `posicionMapa`: el store visual y `setPosicionActual` entregan dos veces el mismo fix, y el
  // flip de `obsoleto` produce un objeto nuevo con los mismos datos — nada de eso debe
  // reiniciar la interpolación ni volver a animar la cámara (el atenuado solo re-estiliza, se
  // lee de `posicionMapa` al renderizar).
  const lat = posicionMapa?.lat ?? null;
  const lng = posicionMapa?.lng ?? null;
  const tsFixProp = posicionMapa?.ts ?? null;
  const rumboFix = typeof posicionMapa?.heading === 'number' ? posicionMapa.heading : null;

  // FIX POST-REVISIÓN (hallazgo ALTO #1 + MEDIO #4): antes, la cámara se animaba en un efecto
  // aparte disparado por CADA frame de `posicionMostrada` (~60Hz, saturaba el bridge), y el
  // arranque del RAF vivía DENTRO del updater de `setPosicionMostrada` (side effect impuro —
  // StrictMode corre updaters dos veces, duplicando la cadena). Ahora todo arranca acá, una
  // sola vez por FIX NUEVO (no por frame): la posición "actual" se lee de `posicionMostradaRef`
  // en vez de un updater, y la cámara se anima hacia `hasta` con la MISMA duración que la
  // interpolación del marcador — nunca por frame.
  useEffect(() => {
    cancelarAnimacion();
    if (lat === null || lng === null) {
      // Sin posición (p. ej. fin del recorrido): nada que mostrar. Se limpia también el estado
      // de interpolación para que el próximo fix real aparezca directo, sin volar desde el
      // punto final del recorrido anterior, y para que el recenter no apunte a una posición vieja.
      ultimoTsFixRef.current = null;
      publicarPosicion(null);
      return cancelarAnimacion;
    }
    const tsFix = tsFixProp ?? Date.now();
    const dt = ultimoTsFixRef.current != null ? tsFix - ultimoTsFixRef.current : null;
    ultimoTsFixRef.current = tsFix;
    const duracion = duracionAnimacionMs(dt ?? 2500);

    const actual = posicionMostradaRef.current;
    const hasta: CoordenadaMostrada = { lat, lng, rumbo: rumboFix ?? actual?.rumbo ?? null };

    // Hallazgo ALTO #1 (perf) + BAJO #5: cámara UNA vez por fix, solo con seguimiento activo y
    // el mapa listo; sin rumbo todavía no se manda `heading` (conserva el actual en vez de
    // snapear a norte). El zoom pendiente solo se consume si la cámara realmente se animó.
    const mapa = mapRef.current;
    if (seguimientoActivoRef.current && camaraListaRef.current && mapa) {
      const aplicarZoom = zoomPendienteRef.current;
      mapa.animateCamera(construirCamaraSeguimiento(hasta, aplicarZoom), { duration: duracion });
      zoomPendienteRef.current = false;
    }

    if (!actual) {
      // Primer fix: sin punto de partida que animar, se posiciona directo.
      publicarPosicion(hasta);
      return cancelarAnimacion;
    }

    const desde: CoordenadaMostrada = actual;
    const inicio = Date.now();
    let ultimoCommitMs: number | null = null;
    const tick = () => {
      const ahora = Date.now();
      const t = Math.min(1, (ahora - inicio) / duracion);
      // Throttle ~30Hz: cada commit manda props de Marker + Circle por el bridge. El frame
      // final (t = 1) siempre se publica.
      if (debeCommitearFrame(ahora, ultimoCommitMs, t >= 1)) {
        ultimoCommitMs = ahora;
        const { lat: latT, lng: lngT } = interpolarLatLng(desde, hasta, t);
        const rumbo =
          desde.rumbo !== null && hasta.rumbo !== null
            ? interpolarAngulo(desde.rumbo, hasta.rumbo, t)
            : hasta.rumbo;
        publicarPosicion({ lat: latT, lng: lngT, rumbo });
      }
      if (t < 1) {
        rafIdRef.current = requestAnimationFrame(tick);
      } else {
        rafIdRef.current = null;
      }
    };
    rafIdRef.current = requestAnimationFrame(tick);

    return cancelarAnimacion;
  }, [
    lat,
    lng,
    tsFixProp,
    rumboFix,
    cancelarAnimacion,
    publicarPosicion,
    mapRef,
    seguimientoActivoRef,
    zoomPendienteRef,
    camaraListaRef,
    posicionMostradaRef,
  ]);

  useEffect(() => cancelarAnimacion, [cancelarAnimacion]);

  if (!posicionMostrada) return null;

  const atenuado = !!posicionMapa?.obsoleto;

  return (
    <>
      <MarcadorConductor posicion={posicionMostrada} atenuado={atenuado} />
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

  // `seguimientoActivo` es solo un ref: nada lo renderiza, así que un pan no re-renderiza.
  const seguimientoActivoRef = useRef(tracking);
  // Zoom de seguimiento: se fija solo al ENTRAR en seguimiento (tracking arranca o recenter),
  // no en cada fix — no se le pisa el pinch al usuario. Se baja SOLO cuando la cámara
  // realmente se animó (mapa listo y posición conocida).
  const zoomPendienteRef = useRef(false);

  // Compuerta de cámara: el mapa avisó `onMapReady` Y la vista ya tuvo layout (ancho/alto > 0).
  // En Android `fitToCoordinates` con la vista sin medir lanza "Map size can't be 0", y
  // `onMapReady` puede dispararse antes del layout.
  const mapaListoRef = useRef(false);
  const layoutListoRef = useRef(false);
  const camaraListaRef = useRef(false);
  const camaraInicialAplicadaRef = useRef(false);

  // Encuadra la ruta entera (o centra en el vehículo si el paquete no trae geometría, ver
  // `decidirEncuadre`). `fitToCoordinates` reemplaza al `fitBounds` de Leaflet.
  const encuadrarRuta = useCallback(
    (animated: boolean) => {
      if (!camaraListaRef.current) return;
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

  // Cámara de seguimiento (heading-up, zoom 17) sobre la posición mostrada. Si todavía no se
  // puede (mapa sin listo/layout, o sin posición), deja el zoom pendiente para la primera
  // cámara de seguimiento que sí corra.
  const seguirVehiculo = useCallback((duracion: number) => {
    const posicion = posicionMostradaRef.current;
    const mapa = mapRef.current;
    if (!posicion || !mapa || !camaraListaRef.current) {
      zoomPendienteRef.current = true;
      return;
    }
    mapa.animateCamera(construirCamaraSeguimiento(posicion, true), { duration: duracion });
    zoomPendienteRef.current = false;
  }, []);

  // Cámara inicial, una sola vez cuando se cumplen mapa listo + layout: en seguimiento (remount
  // en pleno recorrido) va al vehículo con zoom 17; si no, encuadra la ruta entera.
  const intentarCamaraInicial = useCallback(() => {
    if (!mapaListoRef.current || !layoutListoRef.current) return;
    camaraListaRef.current = true;
    if (camaraInicialAplicadaRef.current) return;
    camaraInicialAplicadaRef.current = true;
    if (seguimientoActivoRef.current) {
      seguirVehiculo(0);
    } else {
      encuadrarRuta(false);
    }
  }, [encuadrarRuta, seguirVehiculo]);

  // --- Cámara heading-up con seguimiento -------------------------------------------------
  const trackingPrevioRef = useRef(tracking);
  useEffect(() => {
    const previo = trackingPrevioRef.current;
    trackingPrevioRef.current = tracking;
    seguimientoActivoRef.current = tracking;
    if (tracking) {
      // Entra en seguimiento: va al vehículo de una (sin esperar al próximo fix) si ya se lo
      // conoce; si no, el zoom queda pendiente para la primera cámara de seguimiento.
      seguirVehiculo(700);
    } else if (previo) {
      // Fin del seguimiento: vuelve a mostrar la ruta entera.
      encuadrarRuta(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking]);

  // Cualquier gesto del usuario (pan, y también pinch/rotate: `onPanDrag` los reporta) sale del
  // seguimiento, igual que Google Maps; el botón Recentrar (`recenterTick`) lo restaura.
  const onPanDrag = useCallback(() => {
    seguimientoActivoRef.current = false;
  }, []);

  const lastRecenter = useRef(recenterTick);
  useEffect(() => {
    if (recenterTick <= lastRecenter.current) return;
    lastRecenter.current = recenterTick;
    seguimientoActivoRef.current = true;
    if (posicionMostradaRef.current) {
      seguirVehiculo(400);
    } else {
      zoomPendienteRef.current = true;
      encuadrarRuta(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterTick]);

  const onMapReady = useCallback(() => {
    mapaListoRef.current = true;
    intentarCamaraInicial();
  }, [intentarCamaraInicial]);

  const onLayoutMapa = useCallback(
    (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      if (width > 0 && height > 0) {
        layoutListoRef.current = true;
        intentarCamaraInicial();
      }
    },
    [intentarCamaraInicial],
  );

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
        onLayout={onLayoutMapa}
        onPanDrag={onPanDrag}
        rotateEnabled
        // Sin tilt y sin controles propios de Google: el mapa anterior (Leaflet) no los tenía.
        pitchEnabled={false}
        zoomControlEnabled={false}
        toolbarEnabled={false}
        // Brújula visible: tras un pan en heading-up, tocarla deja el norte arriba (Google solo
        // la muestra con bearing ≠ 0).
        showsCompass
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
          camaraListaRef={camaraListaRef}
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

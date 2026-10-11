import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  StyleSheet,
  View,
  Text,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import MapView, {
  Circle,
  Marker,
  Polyline,
  PROVIDER_GOOGLE,
  type Details,
  type LatLng,
} from 'react-native-maps';
import Svg, { Path } from 'react-native-svg';
import { quivoRadius } from '../../shared/theme/quivo-theme';
import { duracionAnimacionMs, interpolarAngulo, interpolarLatLng } from '../operacion/movimiento/geo';
import { useEstadoVisual } from '../operacion/movimiento/store-visual';
import {
  PADDING_ENCUADRE_RUTA,
  ZOOM_SEGUIMIENTO,
  construirCamaraNavegacion,
  coordenadasEncuadre,
  decidirEncuadre,
  paddingNavegacion,
} from './camara';
import {
  colorPuntoControl,
  esPuntoControlPasado,
  indiceProximoPuntoControl,
} from './estado-punto-control';
import { debeResaltarRutaCalculada, estiloRuta, COLOR_LINEA } from './estilo-ruta';
import type { ModoCamara } from './modo-camara';
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
 * - Cámara en tres modos (`modo-camara.ts`, estado en la pantalla, llega por `camara`):
 *   · `general`: ruta entera + vehículo (`fitToCoordinates` con márgenes), norte arriba y pitch 0.
 *     Es el modo del día sin iniciar y el que vuelve al finalizar el recorrido.
 *   · `navegacion`: cámara bloqueada al vehículo — heading-up, pitch 55, zoom 18, con el vehículo
 *     en el tercio inferior de la banda visible (`mapPadding` de `paddingNavegacion`).
 *   · `libre`: el conductor tocó el mapa en navegación (`onPanDrag` para el arrastre y
 *     `onRegionChangeStart` con `isGesture` para pinch/doble-tap, que en Android NO disparan
 *     `onPanDrag`; ninguno dispara con la cámara propia); la cámara no se mueve sola hasta recentrar.
 *   Los movimientos puntuales (entrar a navegación, recentrar, encuadrar) se ejecutan cuando
 *   cambia `camara.seq`; el resto del tiempo la cámara depende solo del modo.
 *
 * BLOQUEO CUADRO A CUADRO (por qué no hay `animateCamera` por fix): antes la cámara hacía un
 * `animateCamera` por fix con la duración de la interpolación del marcador, pero el easing de
 * Google no es lineal y el marcador sí, así que cámara y marcador se desfasaban entre fixes. Ahora,
 * en `navegacion`, el marcador mueve la cámara con `setCamera` en el MISMO tick del RAF (~30Hz) que
 * publica su posición, con la misma coordenada y el mismo rumbo interpolados: no puede haber
 * desfase. La entrada a navegación y el recentrar sí usan `animateCamera` (700/400 ms); mientras
 * dura se suspende el `setCamera` por frame (`camaraSuspendidaHastaRef`) para no cancelarla. Los
 * frames descartados en esa ventana no se reponen solos: al vencer, un timer llama a
 * `sincronizarCamaraNavegacion` y la cámara se re-ubica sobre el vehículo (salto chico, igual a
 * lo que avanzó en ese tiempo). La sincronización también corre tras un cambio de `mapPadding`
 * fuera de `general`: en Android `applyBaseMapPadding` hace `moveCamera`, que cancela cualquier
 * `animateCamera` en vuelo y deja la cámara a medio camino. Si en ese momento hay una suspensión
 * activa (entrada o recentrar en curso, lo normal al entrar desde `general` porque el padding
 * cambia en el mismo commit), no se salta: se relanza el `animateCamera` por el tiempo que queda,
 * desde donde esté la cámara, y la suspensión y el timer de reposición originales siguen vigentes.
 *   RIESGO (perf, no medido): con `newArchEnabled: false`, cada frame de navegación manda por el
 *   bridge las props del Marker y del Circle más el comando de cámara hacia nativo, y cada
 *   `moveCamera` hace que Android emita de vuelta `onRegionChangeStart`, `onRegionChange` y, a
 *   menudo, `onRegionChangeComplete` (`MapView.java`, listeners de cámara): ~3-5 mensajes por
 *   frame a ~30 Hz. Hay que medirlo en un teléfono de gama baja del piloto; esta versión no
 *   cambia el throttle.
 *
 * PERF: el marcador del conductor (+ su halo de precisión) vive en `MarcadorConductorAnimado`,
 * un componente hijo con su PROPIO loop de `requestAnimationFrame` y estado local — es el ÚNICO
 * que re-renderiza a la cadencia de la animación (~30Hz, ver `debeCommitearFrame`); este componente padre (polylines,
 * puntos de control) no vuelve a renderizar por eso.
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
  /** Modo de cámara vigente (espejo de `camara.modo` + el pan inmediato, ver `RouteMap`). Solo en
   * `navegacion` el marcador mueve la cámara. */
  modoRef: RefObject<ModoCamara>;
  /** Epoch ms hasta el cual no se mueve la cámara por frame: el padre lo fija mientras corre un
   * `animateCamera` de entrada/recentrar para que el `setCamera` no lo cancele. */
  camaraSuspendidaHastaRef: RefObject<number>;
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
  modoRef,
  camaraSuspendidaHastaRef,
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

  // Publica el marcador Y, en navegación, mueve la cámara con los MISMOS valores interpolados
  // (ver "BLOQUEO CUADRO A CUADRO" en el docblock del módulo). Sin modo navegación, mapa sin
  // listo o dentro de la ventana de suspensión, solo publica.
  const publicarYSeguir = useCallback(
    (siguiente: CoordenadaMostrada) => {
      publicarPosicion(siguiente);
      const mapa = mapRef.current;
      if (modoRef.current !== 'navegacion' || !camaraListaRef.current || !mapa) return;
      if (Date.now() < camaraSuspendidaHastaRef.current) return;
      mapa.setCamera(construirCamaraNavegacion(siguiente));
    },
    [publicarPosicion, mapRef, modoRef, camaraListaRef, camaraSuspendidaHastaRef],
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

  // Todo arranca acá, una sola vez por FIX NUEVO (no por frame): la posición "actual" se lee de
  // `posicionMostradaRef` en vez de un updater (StrictMode corre los updaters dos veces). La
  // cámara ya no se anima por fix: la mueve `publicarYSeguir` junto con el marcador.
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

    if (!actual) {
      // Primer fix: sin punto de partida que animar, se posiciona directo (y la cámara con él).
      publicarYSeguir(hasta);
      return cancelarAnimacion;
    }

    const desde: CoordenadaMostrada = actual;
    const inicio = Date.now();
    let ultimoCommitMs: number | null = null;
    const tick = () => {
      const ahora = Date.now();
      const t = Math.min(1, (ahora - inicio) / duracion);
      // Throttle ~30Hz: cada commit manda props de Marker + Circle (+ la cámara en navegación)
      // por el bridge. El frame final (t = 1) siempre se publica, cámara incluida.
      if (debeCommitearFrame(ahora, ultimoCommitMs, t >= 1)) {
        ultimoCommitMs = ahora;
        const { lat: latT, lng: lngT } = interpolarLatLng(desde, hasta, t);
        const rumbo =
          desde.rumbo !== null && hasta.rumbo !== null
            ? interpolarAngulo(desde.rumbo, hasta.rumbo, t)
            : hasta.rumbo;
        publicarYSeguir({ lat: latT, lng: lngT, rumbo });
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
    publicarYSeguir,
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
  camara,
  onPanUsuario,
  insetsNavegacion,
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

  // Espejo de `camara.modo` para el loop del marcador y los gestos, sin re-renderizar. `onPanDrag` y
  // `onRegionChangeStart` (gesto) lo pasan a 'libre' al instante (antes de que el padre re-renderice) para que la cámara por
  // frame deje de pelear con el gesto.
  const modoRef = useRef<ModoCamara>(camara.modo);
  // Epoch ms hasta el cual el marcador no mueve la cámara (ver `MarcadorConductorAnimado`).
  const camaraSuspendidaHastaRef = useRef(0);
  // Timer que repone la cámara al vencer la suspensión (ver `sincronizarCamaraNavegacion`).
  const timerSuspensionRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqAplicadoRef = useRef(camara.seq);
  const [altoMapa, setAltoMapa] = useState(0);

  // Compuerta de cámara: el mapa avisó `onMapReady` Y la vista ya tuvo layout (ancho/alto > 0).
  // En Android `fitToCoordinates` con la vista sin medir lanza "Map size can't be 0", y
  // `onMapReady` puede dispararse antes del layout.
  const mapaListoRef = useRef(false);
  const layoutListoRef = useRef(false);
  const camaraListaRef = useRef(false);
  const camaraInicialAplicadaRef = useRef(false);

  // Vista general: ruta + vehículo con `fitToCoordinates`. No hace falta resetear heading/pitch
  // antes: `CameraUpdateFactory.newLatLngBounds` (lo que usa `fitToCoordinates` en Android) ya
  // devuelve bearing 0 y tilt 0, y un `setCamera` previo solo causaría un salto de un frame. Una ruta sin geometría (dato
  // incompleto del backend) no tiene bounds válidos: se centra en el vehículo si se lo conoce,
  // y si no se deja la vista como está (ver `decidirEncuadre`).
  const encuadrarRuta = useCallback(
    (animated: boolean) => {
      const mapa = mapRef.current;
      if (!camaraListaRef.current || !mapa) return;
      const posicion = posicionMostradaRef.current;
      const accion = decidirEncuadre(coordenadasRuta.length, posicion !== null);
      if (accion === 'ajustar-ruta') {
        mapa.fitToCoordinates(coordenadasEncuadre(coordenadasRuta, posicion), {
          edgePadding: { ...PADDING_ENCUADRE_RUTA },
          animated,
        });
      } else if (accion === 'centrar-posicion' && posicion) {
        const camaraCentrada = {
          center: aLatLng(posicion),
          heading: 0,
          pitch: 0,
          zoom: ZOOM_SEGUIMIENTO,
        };
        if (animated) mapa.animateCamera(camaraCentrada, { duration: 400 });
        else mapa.setCamera(camaraCentrada);
      }
    },
    [coordenadasRuta],
  );

  const cancelarTimerSuspension = useCallback(() => {
    if (timerSuspensionRef.current !== null) {
      clearTimeout(timerSuspensionRef.current);
      timerSuspensionRef.current = null;
    }
  }, []);

  // Re-ubica la cámara sobre la posición mostrada y levanta la suspensión. Repone lo que se
  // descartó mientras corría un `animateCamera` (incluido el frame final, t = 1) y recompone la
  // cámara tras un cambio de `mapPadding`, que en Android cancela el `animateCamera` en vuelo.
  // Con `reanimarSiSuspendida` (caso del padding) y una suspensión con más de 80 ms por delante, en
  // vez de saltar relanza el `animateCamera` por el tiempo restante, sin tocar la suspensión ni el
  // timer ya agendado (que repone la cámara al vencer). Con 80 ms o menos, o sin suspensión, salta.
  // Solo actúa en navegación, con cámara lista, mapa montado y posición conocida.
  const sincronizarCamaraNavegacion = useCallback((reanimarSiSuspendida = false) => {
    const mapa = mapRef.current;
    const posicion = posicionMostradaRef.current;
    if (modoRef.current !== 'navegacion' || !camaraListaRef.current || !mapa || !posicion) return;
    const restante = camaraSuspendidaHastaRef.current - Date.now();
    if (reanimarSiSuspendida && restante > 80) {
      mapa.animateCamera(construirCamaraNavegacion(posicion), { duration: restante });
      return;
    }
    camaraSuspendidaHastaRef.current = 0;
    mapa.setCamera(construirCamaraNavegacion(posicion));
  }, []);

  // Cámara de navegación sobre la posición mostrada. Sin posición todavía no hace nada: el primer
  // fix ubica la cámara (`publicarYSeguir`). Con `duracion` > 0 anima y suspende el `setCamera`
  // por frame mientras dura (y agenda la sincronización para cuando venza); con 0 salta directo.
  const seguirVehiculo = useCallback(
    (duracion: number) => {
      const posicion = posicionMostradaRef.current;
      const mapa = mapRef.current;
      if (!posicion || !mapa || !camaraListaRef.current) return;
      const camaraNav = construirCamaraNavegacion(posicion);
      cancelarTimerSuspension();
      if (duracion > 0) {
        camaraSuspendidaHastaRef.current = Date.now() + duracion;
        mapa.animateCamera(camaraNav, { duration: duracion });
        timerSuspensionRef.current = setTimeout(() => {
          timerSuspensionRef.current = null;
          sincronizarCamaraNavegacion(false);
        }, duracion);
      } else {
        mapa.setCamera(camaraNav);
      }
    },
    [cancelarTimerSuspension, sincronizarCamaraNavegacion],
  );

  // Cámara inicial, una sola vez cuando se cumplen mapa listo + layout: en navegación (remount
  // en pleno recorrido) va al vehículo; si no, encuadra la ruta entera.
  const intentarCamaraInicial = useCallback(() => {
    if (!mapaListoRef.current || !layoutListoRef.current) return;
    camaraListaRef.current = true;
    if (camaraInicialAplicadaRef.current) return;
    camaraInicialAplicadaRef.current = true;
    // Remount fuera de `general` (navegación o libre): el `mapPadding` de navegación ya está
    // activo, así que un encuadre general saldría apretado y en desacuerdo con el modo. Se coloca
    // una vez sobre el vehículo (en libre no hay seguimiento por frame después).
    if (modoRef.current !== 'general') {
      seguirVehiculo(0);
    } else {
      encuadrarRuta(false);
    }
  }, [encuadrarRuta, seguirVehiculo]);

  useEffect(() => {
    modoRef.current = camara.modo;
    // En `general` no hay suspensión que reponer.
    if (camara.modo === 'general') cancelarTimerSuspension();
  }, [camara.modo, cancelarTimerSuspension]);

  useEffect(() => cancelarTimerSuspension, [cancelarTimerSuspension]);

  // Movimientos puntuales de cámara, uno por cada `seq` nuevo. Se saltea el montaje: la cámara
  // inicial la resuelve `intentarCamaraInicial` (mapa listo + layout).
  useEffect(() => {
    if (camara.seq === seqAplicadoRef.current) return;
    seqAplicadoRef.current = camara.seq;
    if (camara.accion === 'seguir') {
      // Entrar desde la vista general es un viaje largo (700); recentrar desde libre, corto (400).
      seguirVehiculo(camara.desde === 'general' ? 700 : 400);
    } else if (camara.accion === 'encuadrar') {
      encuadrarRuta(true);
    }
  }, [camara.seq, camara.accion, camara.desde, seguirVehiculo, encuadrarRuta]);

  // Cualquier gesto del usuario saca de navegación a libre, igual que Google Maps. Dos fuentes:
  // `onPanDrag` (en Android sale de `GestureDetector.onScroll`: solo arrastre) y
  // `onRegionChangeStart` con `isGesture` (sale de `OnCameraMoveStartedListener`: cubre pinch con
  // centro estacionario y doble-tap zoom, que NO disparan `onPanDrag`). Sin esto el `setCamera`
  // por frame (zoom 18) peleaba con el gesto. La cámara propia (`animateCamera`/`setCamera`)
  // reporta `isGesture: false`, así que nunca saca de navegación.
  const salirANavegacionLibre = useCallback(() => {
    if (modoRef.current !== 'navegacion') return;
    modoRef.current = 'libre';
    cancelarTimerSuspension();
    onPanUsuario();
  }, [onPanUsuario, cancelarTimerSuspension]);

  const onPanDrag = salirANavegacionLibre;

  const onRegionChangeStart = useCallback(
    (event: NativeSyntheticEvent<Details>) => {
      // Handler barato a propósito: dispara con CADA `moveCamera` propio (isGesture false).
      if (event.nativeEvent.isGesture !== true) return;
      salirANavegacionLibre();
    },
    [salirANavegacionLibre],
  );

  // Depende de `esGeneral` (no de `camara.modo`) para que navegación <-> libre, que comparten
  // padding, no produzcan un objeto nuevo ni disparen la sincronización de cámara.
  const esGeneral = camara.modo === 'general';
  const mapPadding = useMemo(
    () =>
      esGeneral
        ? { top: 0, right: 0, bottom: 0, left: 0 }
        : paddingNavegacion({
            alto: altoMapa,
            insetSuperior: insetsNavegacion.superior,
            insetInferior: insetsNavegacion.inferior,
          }),
    [esGeneral, altoMapa, insetsNavegacion.superior, insetsNavegacion.inferior],
  );

  // Un cambio de `mapPadding` fuera de `general` (entrada a navegación, alto del sheet o de la
  // tarjeta superior, insets) hace `moveCamera` en Android y cancela un `animateCamera` en vuelo,
  // mientras `camaraSuspendidaHastaRef` sigue frenando el `setCamera` por frame: la cámara quedaría
  // a medio camino. Se re-sincroniza; si hay una suspensión en curso se relanza la animación por el
  // tiempo restante en vez de saltar (ver `sincronizarCamaraNavegacion`). Se difiere un frame por si
  // el efecto corre antes de que el padding llegue a nativo (orden no confirmado); se cancela en el
  // cleanup. El primer padding (montaje) no se sincroniza: lo cubre `intentarCamaraInicial`.
  const paddingAplicadoRef = useRef(mapPadding);
  useEffect(() => {
    if (paddingAplicadoRef.current === mapPadding) return;
    paddingAplicadoRef.current = mapPadding;
    if (esGeneral) return;
    const id = requestAnimationFrame(() => sincronizarCamaraNavegacion(true));
    return () => cancelAnimationFrame(id);
  }, [mapPadding, esGeneral, sincronizarCamaraNavegacion]);

  const onMapReady = useCallback(() => {
    mapaListoRef.current = true;
    intentarCamaraInicial();
  }, [intentarCamaraInicial]);

  const onLayoutMapa = useCallback(
    (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      if (width > 0 && height > 0) {
        setAltoMapa(Math.round(height));
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
        onRegionChangeStart={onRegionChangeStart}
        mapPadding={mapPadding}
        rotateEnabled
        // Sin gesto de inclinación (el pitch lo fija el modo navegación por código, que sigue
        // funcionando) y sin controles propios de Google.
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
          modoRef={modoRef}
          camaraSuspendidaHastaRef={camaraSuspendidaHastaRef}
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

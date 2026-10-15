import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import {
  StyleSheet,
  View,
  Text,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import MapView, {
  Circle,
  Marker,
  Polyline,
  PROVIDER_GOOGLE,
  type Camera,
  type Details,
  type LatLng,
  type Region,
} from 'react-native-maps';
import Svg, { Path } from 'react-native-svg';
import { quivoColors, quivoRadius } from '../../shared/theme/quivo-theme';
import { coordenadasTramo } from '../vuelta-actual/vuelta-actual-core';
import {
  distanciaMetros,
  duracionAnimacionMs,
  interpolarAngulo,
  interpolarLatLng,
} from '../operacion/movimiento/geo';
import {
  MAX_FALLOS_SNAP,
  debeInterpolarPorRuta,
  interpolarSobreRuta,
  prepararRutaSnap,
  snapARuta,
  type RutaSnap,
} from '../operacion/movimiento/snap-ruta';
import { useEstadoVisual } from '../operacion/movimiento/store-visual';
import { crearFiltroFase, firmaGeometria, mitadesDelCircuito } from '../operacion/fase-vuelta';
import {
  PADDING_ENCUADRE_RUTA,
  ZOOM_NAVEGACION,
  ZOOM_SEGUIMIENTO,
  construirCamaraNavegacion,
  coordenadasEncuadre,
  decidirEncuadre,
  esGestoSobreMapa,
  paddingNavegacion,
  suavizarZoom,
  zoomPorVelocidad,
} from './camara';
import {
  aspectoPuntoControl,
  colorPuntoControl,
  type AspectoPuntoControl,
} from './estado-punto-control';
import { crearEmisorZoom, type EmisorZoom } from './emisor-zoom';
import {
  PATRON_TRAMO_CALCULADO,
  debeResaltarRutaCalculada,
  estiloDesignacion,
  estiloRuta,
  estiloTramoCalculado,
  zoomParaEncuadre,
  type EstiloRuta,
} from './estilo-ruta';
import type { ModoCamara, OrientacionCamara } from './modo-camara';
import { debeCommitearFrame, posicionMapaDesde } from './posicion-mapa';
import type { EmisorRumbo } from './rumbo-mapa';
import type { PosicionMapa, RouteMapProps } from './tipos';

/**
 * Mapa de la ruta activa — motor Google nativo (`react-native-maps` + `PROVIDER_GOOGLE`), el
 * único motor de la app (`docs/adr/0004-motor-mapa-google.md`; reemplazó a Leaflet + WebView).
 * Semántica visual:
 * - Ruta oscura (#1E1B4B) y fina en espera; en seguimiento, azul Quivo del ancho de la calzada
 *   (escala con el zoom) con borde oscuro (`estilo-ruta.ts`).
 * - Puntos de control: círculos azules (#3127B1) con número blanco, verdes (#22C55E) los ya
 *   pasados y rojos (#C53B4A) los omitidos, solo con `tracking` (`estado-punto-control.ts`).
 * - Resaltado del tramo OSRM (`rutaCalculada`): trazo discontinuo azul oscuro sobre banda blanca,
 *   SOLO con `tracking` activo.
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
 *   En android con la arquitectura vieja `isGesture` no es confiable, así que además el contenedor
 *   mira los toques crudos (`onTouchStart`/`onTouchMove`, ver `esGestoSobreMapa`): un dedo que se
 *   mueve más de ~8 px o un pinch sacan de navegación; un toque simple (p. ej. sobre un marcador) no.
 *   La brújula de Google está apagada (`showsCompass={false}`): tocarla ponía el norte arriba y sacaba
 *   de navegación sin forma de volver. La pantalla dibuja la suya y el mapa le publica el rumbo de la
 *   cámara por `emisorRumbo` (sin props ni estado a 30 Hz). La orientación de la cámara de
 *   navegación (`camara.orientacion`: `rumbo` = heading-up, `norte` = norte arriba siguiendo al
 *   vehículo) se lee por ref para el `setCamera` por frame.
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
 * fuera de `general` (sin suspensión activa, anima 300 ms en vez de saltar): en Android `applyBaseMapPadding` hace `moveCamera`, que cancela cualquier
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

/** Duración (ms) de la animación de cámara cuando cambia el `mapPadding` en navegación (el sheet hizo snap). */
const DURACION_REENCUADRE_PADDING_MS = 300;

/** El loop de convergencia del zoom se detiene cuando el zoom queda a menos de esto del objetivo. */
const UMBRAL_CONVERGENCIA_ZOOM = 0.01;

/** Factor de mezcla por frame (~30 Hz) del rumbo mostrado hacia el rumbo del tramo de la ruta:
 * suaviza el giro sin adelantarse a la esquina. */
const FACTOR_RUMBO_RUTA = 0.35;

interface CoordenadaMostrada {
  lat: number;
  lng: number;
  /** `null` SOLO antes de que el núcleo de movimiento haya resuelto algún rumbo válido —
   * dibuja un punto sin flecha (ver docblock del módulo). Una vez conocido, nunca vuelve a
   * `null` (mismo invariante que `EstadoRumbo`, `movimiento/rumbo.ts`). */
  rumbo: number | null;
  /** Distancia acumulada (m) sobre la polilínea de la ruta cuando el marcador está ajustado a
   * ella (snap visual); `undefined` si se dibuja el GPS crudo. Decide animar por la calle. */
  distancia?: number;
  /** El DESTINO de la animación en curso está ajustado a la ruta (aunque algún frame intermedio de
   * la interpolación lineal no lleve `distancia`): gobierna el halo de precisión, que no aplica
   * cuando el marcador no está sobre el GPS crudo. */
  ajustadaARuta?: boolean;
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

function MarcadorPuntoControl({ orden, aspecto }: { orden: number; aspecto: AspectoPuntoControl }) {
  return (
    <View style={[styles.puntoControlMarcador, { backgroundColor: colorPuntoControl(aspecto) }]}>
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
  /** Orientación vigente de la cámara de navegación (espejo de `camara.orientacion`). */
  orientacionRef: RefObject<OrientacionCamara>;
  /** Recibe el rumbo de la cámara que se manda por frame (para la brújula de la pantalla). */
  emisorRumbo?: EmisorRumbo;
  /** Epoch ms hasta el cual no se mueve la cámara por frame: el padre lo fija mientras corre un
   * `animateCamera` de entrada/recentrar para que el `setCamera` no lo cancele. */
  camaraSuspendidaHastaRef: RefObject<number>;
  /** true cuando el mapa está listo Y ya tuvo layout (ver `RouteMap`); antes no se anima nada. */
  camaraListaRef: RefObject<boolean>;
  /** Ref compartido con el padre (`RouteMap`): este componente escribe acá la última
   * posición mostrada para que el recenter manual (que vive en el padre) la lea sin necesidad
   * de que el padre también re-renderice por cada frame de la animación. */
  posicionMostradaRef: RefObject<CoordenadaMostrada | null>;
  /** Polilínea de la ruta preparada para el snap visual, o `null` sin geometría válida. */
  rutaSnap: RutaSnap | null;
  /** Zoom vigente de la cámara de navegación (suavizado por velocidad). Lo avanza este
   * componente en cada frame de navegación; el padre lo lee al armar sus propias cámaras. */
  zoomActualRef: RefObject<number>;
  /** Avisa el zoom vigente tras avanzarlo (el padre lo cuantiza y solo re-renderiza al cruzar un paso). */
  onZoom: (zoom: number) => void;
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
  orientacionRef,
  emisorRumbo,
  camaraSuspendidaHastaRef,
  camaraListaRef,
  posicionMostradaRef,
  rutaSnap,
  zoomActualRef,
  onZoom,
}: MarcadorConductorAnimadoProps) {
  const [posicionMostrada, setPosicionMostrada] = useState<CoordenadaMostrada | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const ultimoTsFixRef = useRef<number | null>(null);
  // Último tramo de la ruta al que se ajustó el marcador (histéresis del snap); `null` fuera de ruta.
  const snapPrevioRef = useRef<{ indiceSegmento: number } | null>(null);
  // Fixes consecutivos sin snap: el tramo previo sobrevive a `MAX_FALLOS_SNAP` fallos seguidos.
  const fallosSnapRef = useRef(0);
  // Último fix (ts|lat|lng) y ruta ya procesados: un re-disparo del efecto sin cambios reales (p. ej.
  // otra referencia del paquete) no debe reiniciar la animación en vuelo.
  const fixProcesadoRef = useRef<{ clave: string; ruta: RutaSnap | null } | null>(null);
  // Velocidad (km/h) del último fix, para el zoom automático; `null` si se desconoce.
  const velocidadKmhRef = useRef<number | null>(null);
  const ultimoZoomMsRef = useRef(0);

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

  // Zoom objetivo según la velocidad del último fix (≤ 15 km/h o desconocida → 18).
  const zoomObjetivo = useCallback(() => zoomPorVelocidad(velocidadKmhRef.current), []);

  // En navegación mueve la cámara sobre `posicion` con el zoom automático avanzado un paso. Sin
  // modo navegación, mapa no listo o dentro de la ventana de suspensión, no hace nada.
  const seguirCamara = useCallback(
    (posicion: CoordenadaMostrada) => {
      const mapa = mapRef.current;
      if (modoRef.current !== 'navegacion' || !camaraListaRef.current || !mapa) return;
      if (Date.now() < camaraSuspendidaHastaRef.current) return;
      // Zoom automático por velocidad, suavizado por tiempo; el salto de un frame se acota para
      // que tras una pausa (suspensión de cámara, background) no pegue un salto.
      const ahora = Date.now();
      const dtZoom = Math.min(100, ahora - ultimoZoomMsRef.current);
      ultimoZoomMsRef.current = ahora;
      zoomActualRef.current = suavizarZoom(zoomActualRef.current, zoomObjetivo(), dtZoom);
      onZoom(zoomActualRef.current);
      const camaraNav = construirCamaraNavegacion(
        posicion,
        orientacionRef.current,
        zoomActualRef.current,
      );
      // Umbral de 2° dentro del emisor: a 30 Hz casi todos los cuadros no notifican nada.
      if (camaraNav.heading !== undefined) emisorRumbo?.publicar(camaraNav.heading);
      mapa.setCamera(camaraNav);
    },
    [
      mapRef,
      modoRef,
      orientacionRef,
      emisorRumbo,
      camaraListaRef,
      camaraSuspendidaHastaRef,
      zoomActualRef,
      zoomObjetivo,
      onZoom,
    ],
  );

  // Publica el marcador Y, en navegación, mueve la cámara con los MISMOS valores interpolados
  // (ver "BLOQUEO CUADRO A CUADRO" en el docblock del módulo).
  const publicarYSeguir = useCallback(
    (siguiente: CoordenadaMostrada) => {
      publicarPosicion(siguiente);
      seguirCamara(siguiente);
    },
    [publicarPosicion, seguirCamara],
  );

  // El zoom automático tiene que seguir convergiendo aunque no lleguen fixes ni haya animación de
  // posición en curso (p. ej. el vehículo frena y no hay fix nuevo): un loop propio, solo de cámara
  // (no re-renderiza el marcador), que corre en navegación hasta que `|zoom − objetivo| < 0.01`.
  const convergerZoom = useCallback(() => {
    let ultimoCommitMs: number | null = null;
    const tickZoom = () => {
      rafIdRef.current = null;
      const posicion = posicionMostradaRef.current;
      if (modoRef.current !== 'navegacion' || !posicion) return;
      if (Math.abs(zoomActualRef.current - zoomObjetivo()) < UMBRAL_CONVERGENCIA_ZOOM) return;
      const ahora = Date.now();
      if (debeCommitearFrame(ahora, ultimoCommitMs, false)) {
        ultimoCommitMs = ahora;
        seguirCamara(posicion);
      }
      rafIdRef.current = requestAnimationFrame(tickZoom);
    };
    rafIdRef.current = requestAnimationFrame(tickZoom);
  }, [posicionMostradaRef, modoRef, zoomActualRef, zoomObjetivo, seguirCamara]);

  // Cambió la geometría de la ruta: el tramo previo, los fallos y la `distancia` mostrada
  // pertenecen a la ruta vieja; mezclarlos con la nueva animaría por la calle entre dos rutas
  // distintas. (Se declara antes del efecto de fixes: corre primero en el mismo commit.)
  useEffect(() => {
    snapPrevioRef.current = null;
    fallosSnapRef.current = 0;
    const mostrada = posicionMostradaRef.current;
    if (mostrada && mostrada.distancia !== undefined) {
      posicionMostradaRef.current = { ...mostrada, distancia: undefined, ajustadaARuta: false };
    }
  }, [rutaSnap, posicionMostradaRef]);

  // El efecto depende del CONTENIDO del fix (lat/lng/ts/rumbo), no de la identidad del objeto
  // `posicionMapa`: el store visual y `setPosicionActual` entregan dos veces el mismo fix, y el
  // flip de `obsoleto` produce un objeto nuevo con los mismos datos — nada de eso debe
  // reiniciar la interpolación ni volver a animar la cámara (el atenuado solo re-estiliza, se
  // lee de `posicionMapa` al renderizar).
  const lat = posicionMapa?.lat ?? null;
  const lng = posicionMapa?.lng ?? null;
  const tsFixProp = posicionMapa?.ts ?? null;
  const rumboFix = typeof posicionMapa?.heading === 'number' ? posicionMapa.heading : null;
  // Velocidad (m/s) y precisión del fix: entran al snap. Cambian solo con un fix nuevo.
  const velocidadFix =
    typeof posicionMapa?.speed === 'number' && posicionMapa.speed >= 0 ? posicionMapa.speed : null;
  const precisionFix =
    typeof posicionMapa?.accuracy === 'number' && Number.isFinite(posicionMapa.accuracy)
      ? posicionMapa.accuracy
      : null;

  // Todo arranca acá, una sola vez por FIX NUEVO (no por frame): la posición "actual" se lee de
  // `posicionMostradaRef` en vez de un updater (StrictMode corre los updaters dos veces). La
  // cámara ya no se anima por fix: la mueve `publicarYSeguir` junto con el marcador. El efecto NO
  // cancela la animación en su cleanup (solo al desmontar, abajo): así un re-disparo sin fix ni ruta
  // nueva retorna temprano y la animación en vuelo sigue.
  useEffect(() => {
    if (lat === null || lng === null) {
      cancelarAnimacion();
      // Sin posición (p. ej. fin del recorrido): nada que mostrar. Se limpia también el estado
      // de interpolación para que el próximo fix real aparezca directo, sin volar desde el
      // punto final del recorrido anterior, y para que el recenter no apunte a una posición vieja.
      ultimoTsFixRef.current = null;
      fixProcesadoRef.current = null;
      snapPrevioRef.current = null;
      fallosSnapRef.current = 0;
      velocidadKmhRef.current = null;
      publicarPosicion(null);
      return;
    }
    const clave = `${tsFixProp ?? ''}|${lat}|${lng}`;
    const procesado = fixProcesadoRef.current;
    if (tsFixProp !== null && procesado?.clave === clave && procesado.ruta === rutaSnap) return;
    fixProcesadoRef.current = { clave, ruta: rutaSnap };
    cancelarAnimacion();

    const tsFix = tsFixProp ?? Date.now();
    const dt = ultimoTsFixRef.current != null ? tsFix - ultimoTsFixRef.current : null;
    ultimoTsFixRef.current = tsFix;
    const duracion = duracionAnimacionMs(dt ?? 2500);

    velocidadKmhRef.current = velocidadFix !== null ? velocidadFix * 3.6 : null;

    // Snap visual a la ruta: con snap, posición sobre la polilínea y rumbo del tramo; sin snap
    // (fuera de ruta o sin geometría), el GPS crudo de siempre. Solo afecta lo que se dibuja. El
    // tramo previo sobrevive a `MAX_FALLOS_SNAP` fixes seguidos sin snap (un fix ruidoso aislado no
    // borra la histéresis); pasado eso se descarta y se busca en toda la ruta.
    const snap = rutaSnap
      ? snapARuta(
          rutaSnap,
          { lat, lng, rumbo: rumboFix, velocidadMs: velocidadFix, accuracy: precisionFix },
          snapPrevioRef.current,
          fallosSnapRef.current,
        )
      : null;
    if (snap) {
      snapPrevioRef.current = { indiceSegmento: snap.indiceSegmento };
      fallosSnapRef.current = 0;
    } else {
      fallosSnapRef.current += 1;
      if (fallosSnapRef.current > MAX_FALLOS_SNAP) snapPrevioRef.current = null;
    }

    const actual = posicionMostradaRef.current;
    const hasta: CoordenadaMostrada = snap
      ? {
          lat: snap.lat,
          lng: snap.lng,
          rumbo: snap.rumbo,
          distancia: snap.distanciaRecorrida,
          ajustadaARuta: true,
        }
      : { lat, lng, rumbo: rumboFix ?? actual?.rumbo ?? null, ajustadaARuta: false };

    if (!actual) {
      // Primer fix: sin punto de partida que animar, se posiciona directo (y la cámara con él).
      publicarYSeguir(hasta);
      convergerZoom();
      return;
    }

    const desde: CoordenadaMostrada = actual;
    const dDesde = desde.distancia;
    const dHasta = hasta.distancia;
    // Con ambos extremos sobre la ruta se anima por la calle (por distancia acumulada), salvo que el
    // recorrido por la calle sea desproporcionado frente a la línea recta (ida y vuelta, carriles
    // opuestos pegados): ahí se anima en línea recta.
    const porRuta =
      rutaSnap !== null &&
      dDesde !== undefined &&
      dHasta !== undefined &&
      debeInterpolarPorRuta(rutaSnap, dDesde, dHasta, distanciaMetros(desde, hasta));
    const inicio = Date.now();
    let ultimoCommitMs: number | null = null;
    // Rumbo mostrado en el frame anterior (base del suavizado angular a lo largo de la ruta).
    let rumboPrevio = desde.rumbo;
    const tick = () => {
      const ahora = Date.now();
      const t = Math.min(1, (ahora - inicio) / duracion);
      // Throttle ~30Hz: cada commit manda props de Marker + Circle (+ la cámara en navegación)
      // por el bridge. El frame final (t = 1) siempre se publica, cámara incluida.
      if (debeCommitearFrame(ahora, ultimoCommitMs, t >= 1)) {
        ultimoCommitMs = ahora;
        const enRuta =
          porRuta && rutaSnap !== null && dDesde !== undefined && dHasta !== undefined
            ? interpolarSobreRuta(rutaSnap, dDesde, dHasta, t)
            : null;
        let frame: CoordenadaMostrada;
        if (enRuta) {
          // Por la calle el rumbo es el del tramo a esa distancia, mezclado con un factor corto para
          // girar EN la esquina y no antes (el rumbo lineal desde→hasta giraba de a poco desde el inicio).
          const rumbo =
            rumboPrevio !== null
              ? interpolarAngulo(rumboPrevio, enRuta.rumbo, FACTOR_RUMBO_RUTA)
              : enRuta.rumbo;
          frame = {
            lat: enRuta.lat,
            lng: enRuta.lng,
            rumbo,
            distancia: enRuta.distancia,
            ajustadaARuta: true,
          };
        } else {
          const { lat: latT, lng: lngT } = interpolarLatLng(desde, hasta, t);
          const rumbo =
            desde.rumbo !== null && hasta.rumbo !== null
              ? interpolarAngulo(desde.rumbo, hasta.rumbo, t)
              : hasta.rumbo;
          // Frames intermedios en línea recta no llevan `distancia` (no están sobre la polilínea);
          // el final sí la lleva si el destino está ajustado, para reactivar la animación por la
          // calle en el próximo fix.
          frame = {
            lat: latT,
            lng: lngT,
            rumbo,
            distancia: t >= 1 ? dHasta : undefined,
            ajustadaARuta: hasta.ajustadaARuta,
          };
        }
        rumboPrevio = frame.rumbo;
        publicarYSeguir(frame);
      }
      if (t < 1) {
        rafIdRef.current = requestAnimationFrame(tick);
      } else {
        rafIdRef.current = null;
        convergerZoom();
      }
    };
    rafIdRef.current = requestAnimationFrame(tick);
  }, [
    lat,
    lng,
    tsFixProp,
    rumboFix,
    velocidadFix,
    precisionFix,
    rutaSnap,
    cancelarAnimacion,
    publicarPosicion,
    publicarYSeguir,
    convergerZoom,
    posicionMostradaRef,
  ]);

  useEffect(() => cancelarAnimacion, [cancelarAnimacion]);

  if (!posicionMostrada) return null;

  const atenuado = !!posicionMapa?.obsoleto;

  return (
    <>
      <MarcadorConductor posicion={posicionMostrada} atenuado={atenuado} />
      {/* Con snap a la ruta el halo de precisión no aplica: el marcador no está en el GPS crudo. */}
      {!posicionMostrada.ajustadaARuta &&
      typeof posicionMapa?.accuracy === 'number' &&
      Number.isFinite(posicionMapa.accuracy) ? (
        <Circle
          center={aLatLng(posicionMostrada)}
          radius={posicionMapa.accuracy}
          fillColor="rgba(49,39,177,0.12)"
          strokeColor="rgba(49,39,177,0.35)"
          strokeWidth={1}
          zIndex={Z_HALO_PRECISION}
        />
      ) : null}
    </>
  );
});

/** Orden de apilado de los overlays del mapa, explícito y sin empates: casing de la base < base <
 * halo de precisión del conductor < casing del tramo OSRM < tramo OSRM < casing de la designación <
 * designación. */
const Z_RUTA_CASING = 1;
const Z_RUTA = 2;
const Z_HALO_PRECISION = 3;
const Z_TRAMO_CALCULADO_CASING = 4;
const Z_TRAMO_CALCULADO = 5;
const Z_DESIGNACION_CASING = 6;
const Z_DESIGNACION = 7;

/** Duración estimada (ms) de la animación de `fitToCoordinates` (la API no la expone; el idle de la
 * región afina el zoom real al terminar). */
const DURACION_ENCUADRE_MS = 500;
/** Margen (ms) tras la duración de una animación antes de publicar su zoom destino. */
const MARGEN_FIN_ANIMACION_MS = 50;

/** Zoom de partida de la polilínea antes del primer encuadre (se corrige al aplicar la cámara). */
const ZOOM_INICIAL_RUTA = 15;

/** Zoom cuantizado de la cámara, suscrito al emisor: solo quien lo usa re-renderiza al cruzar un
 * paso (no `RouteMap` entero). */
function useZoomRuta(emisorZoom: EmisorZoom): number {
  return useSyncExternalStore(emisorZoom.suscribir, emisorZoom.actual);
}

interface PolylineConBordeProps {
  coords: LatLng[];
  estilo: EstiloRuta;
  zBorde: number;
  zLinea: number;
  /** Patrón de guiones (dp); con él la línea usa `lineCap="butt"` para que se vean los huecos. */
  guiones?: readonly number[];
}

/** Línea con borde (casing) debajo: el borde solo si `estilo.colorCasing` no es `null`. */
function PolylineConBorde({ coords, estilo, zBorde, zLinea, guiones }: PolylineConBordeProps) {
  const lineCap = guiones ? 'butt' : 'round';
  return (
    <>
      {estilo.colorCasing ? (
        <Polyline
          coordinates={coords}
          strokeColor={estilo.colorCasing}
          strokeWidth={estilo.grosorCasing}
          lineCap="round"
          lineJoin="round"
          zIndex={zBorde}
        />
      ) : null}
      <Polyline
        coordinates={coords}
        strokeColor={estilo.color}
        strokeWidth={estilo.grosor}
        lineCap={lineCap}
        lineJoin="round"
        lineDashPattern={guiones ? [...guiones] : undefined}
        zIndex={zLinea}
      />
    </>
  );
}

interface RutaPolylinesProps {
  coordenadasRuta: LatLng[];
  tracking: boolean;
  mostrarCaminoResaltado: boolean;
  caminoResaltadoCoords: LatLng[];
  /** Emisor del zoom de la cámara (cuantizado): escala el ancho de la línea. */
  emisorZoom: EmisorZoom;
  latitud: number;
}

/** Hallazgo ALTO #2 (perf): memoizado — no vuelve a renderizar (ni a re-diffear sus
 * `Polyline`) por cambios ajenos a estas props, como la animación del marcador del conductor
 * (que ya no vive en este árbol de todos modos, ver `MarcadorConductorAnimado`). El zoom entra por
 * `emisorZoom`: solo este componente (y `DesignacionMapa`) re-renderiza al cruzar un paso de zoom.
 *
 * En seguimiento: borde oscuro (más ancho, debajo) + línea azul del ancho de la calzada, que
 * escala con el zoom. El tramo OSRM resaltado va encima como trazo discontinuo oscuro sobre una
 * banda blanca (70 % del ancho de la base), legible sobre el mapa y sobre la base azul. */
const RutaPolylines = memo(function RutaPolylines({
  coordenadasRuta,
  tracking,
  mostrarCaminoResaltado,
  caminoResaltadoCoords,
  emisorZoom,
  latitud,
}: RutaPolylinesProps) {
  const zoom = useZoomRuta(emisorZoom);
  const estilo = estiloRuta(tracking, zoom, latitud);
  return (
    <>
      <PolylineConBorde
        coords={coordenadasRuta}
        estilo={estilo}
        zBorde={Z_RUTA_CASING}
        zLinea={Z_RUTA}
      />
      {mostrarCaminoResaltado ? (
        <PolylineConBorde
          coords={caminoResaltadoCoords}
          estilo={estiloTramoCalculado(zoom, latitud)}
          zBorde={Z_TRAMO_CALCULADO_CASING}
          zLinea={Z_TRAMO_CALCULADO}
          guiones={PATRON_TRAMO_CALCULADO}
        />
      ) : null}
    </>
  );
});

interface DesignacionMapaProps {
  designacion: NonNullable<RouteMapProps['designacion']>;
  tracking: boolean;
  emisorZoom: EmisorZoom;
  latitud: number;
}

/** Tramo de la designación a Molinos (acento ámbar con borde naranja oscuro, del mismo ancho por
 * zoom que la base azul y por encima de ella; sin seguimiento más ancho que la base y con borde) y
 * el PC de espera destacado. Componente aparte y memoizado: no toca `RutaPolylines` ni su estilo. */
const DesignacionMapa = memo(function DesignacionMapa({
  designacion,
  tracking,
  emisorZoom,
  latitud,
}: DesignacionMapaProps) {
  const zoom = useZoomRuta(emisorZoom);
  const tramo = useMemo(() => coordenadasTramo(designacion.tramo), [designacion.tramo]);
  const estilo = estiloDesignacion(zoom, latitud, tracking);
  const [tracksViewChanges] = useTracksViewChanges();
  const [lng, lat] = designacion.puntoEspera.coord.coordinates;
  return (
    <>
      {tramo.length >= 2 ? (
        <PolylineConBorde
          coords={tramo}
          estilo={estilo}
          zBorde={Z_DESIGNACION_CASING}
          zLinea={Z_DESIGNACION}
        />
      ) : null}
      <Marker
        coordinate={{ latitude: lat as number, longitude: lng as number }}
        anchor={{ x: 0.5, y: 0.5 }}
        tracksViewChanges={tracksViewChanges}
        zIndex={1}
      >
        {/* Contenedor transparente centrado en el PC (que queda a la vista con su color de estado)
            y badge "M" chico en la esquina superior derecha, fuera del círculo del PC. */}
        <View style={styles.puntoEsperaContenedor}>
          <View style={styles.puntoEsperaMarcador}>
            <Text style={styles.puntoEsperaTexto}>M</Text>
          </View>
        </View>
      </Marker>
    </>
  );
});

interface MarcadorPuntoControlItemProps {
  orden: number;
  latitude: number;
  longitude: number;
  aspecto: AspectoPuntoControl;
}

/** Un punto de control individual, memoizado por sus propias props — re-habilita
 * `tracksViewChanges` un frame SOLO cuando `aspecto` cambia (el punto pasa a verde o rojo), igual
 * criterio que el marcador del conductor. */
const MarcadorPuntoControlItem = memo(function MarcadorPuntoControlItem({
  orden,
  latitude,
  longitude,
  aspecto,
}: MarcadorPuntoControlItemProps) {
  const [tracksViewChanges, reactivarTracksViewChanges] = useTracksViewChanges();
  const aspectoAnteriorRef = useRef(aspecto);
  useEffect(() => {
    if (aspectoAnteriorRef.current !== aspecto) {
      aspectoAnteriorRef.current = aspecto;
      reactivarTracksViewChanges();
    }
  }, [aspecto, reactivarTracksViewChanges]);

  return (
    <Marker
      coordinate={{ latitude, longitude }}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={tracksViewChanges}
    >
      <MarcadorPuntoControl orden={orden} aspecto={aspecto} />
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
  estadosPuntosControl: RouteMapProps['estadosPuntosControl'];
}

/** Hallazgo ALTO #2 (perf): memoizado — el `.map()` completo se salta si ninguna de estas
 * props cambió desde el último render. */
const PuntosControlMarcadores = memo(function PuntosControlMarcadores({
  puntosControlData,
  tracking,
  estadosPuntosControl,
}: PuntosControlMarcadoresProps) {
  return (
    <>
      {puntosControlData.map((pc) => (
        <MarcadorPuntoControlItem
          key={pc.id}
          orden={pc.orden}
          latitude={pc.latitude}
          longitude={pc.longitude}
          aspecto={aspectoPuntoControl(estadosPuntosControl[pc.id], tracking)}
        />
      ))}
    </>
  );
});

export function RouteMap({
  paquete,
  estadosPuntosControl,
  posicionActual,
  tracking,
  camara,
  onPanUsuario,
  insetsNavegacion,
  rutaCalculada,
  emisorRumbo,
  designacion,
  ordenEfectivo,
  fase = null,
  style,
}: RouteMapProps) {
  const mapRef = useRef<MapView>(null);

  // Circuito con fases (ida/regreso comparten calles): solo se dibuja (y se ajusta el marcador a)
  // la mitad de la fase actual. Sin fase, o si el circuito no se pudo partir, el circuito entero.
  const coordenadasGeometria = useMemo(() => {
    const completa = paquete.ruta.geometria.coordinates;
    if (fase === null) return completa;
    const mitades = mitadesDelCircuito(completa, ordenEfectivo);
    return mitades ? mitades[fase] : completa;
  }, [paquete, ordenEfectivo, fase]);
  const coordenadasRuta = useMemo<LatLng[]>(
    () => coordenadasGeometria.map(([lng, lat]) => ({ latitude: lat, longitude: lng })),
    [coordenadasGeometria],
  );
  // Latitud de referencia para el ancho en dp (la ruta abarca pocos km: el coseno apenas varía).
  const latitudRuta = coordenadasRuta[0]?.latitude ?? 0;

  // Polilínea de la ruta preparada para el snap visual del marcador (`snap-ruta.ts`). La identidad
  // sólo cambia si cambia la GEOMETRÍA (firma de contenido): una referencia nueva del paquete con
  // la misma ruta no debe reiniciar el snap ni la animación del marcador.
  const rutaSnapCacheRef = useRef<{ firma: string; ruta: RutaSnap | null } | null>(null);
  const rutaSnap = useMemo(() => {
    const firma = firmaGeometria(coordenadasGeometria);
    if (rutaSnapCacheRef.current?.firma === firma) return rutaSnapCacheRef.current.ruta;
    const ruta = prepararRutaSnap(
      coordenadasGeometria.map(([lng, lat]) => ({ lat: lat as number, lng: lng as number })),
    );
    rutaSnapCacheRef.current = { firma, ruta };
    return ruta;
  }, [coordenadasGeometria]);

  // Zoom vigente de la cámara de navegación: lo avanza el marcador por velocidad; las cámaras
  // puntuales de este componente (entrada, recentrar, padding) lo leen para no pegar un salto.
  const zoomActualRef = useRef(ZOOM_NAVEGACION);
  // Zoom cuantizado (pasos de 0.25) que escala el ancho de la polilínea. Vive en un emisor y no en
  // estado de `RouteMap`: solo `RutaPolylines`/`DesignacionMapa` se suscriben y re-renderizan al
  // cruzar un paso; el árbol del mapa no. `publicar` ya descarta lo que no cruza un paso.
  const emisorZoom = useMemo(() => crearEmisorZoom(ZOOM_INICIAL_RUTA), []);
  // Publicación diferida del zoom destino de una animación (ver `programarZoomRuta`).
  const timerZoomRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelarZoomPendiente = useCallback(() => {
    if (timerZoomRef.current !== null) {
      clearTimeout(timerZoomRef.current);
      timerZoomRef.current = null;
    }
  }, []);
  useEffect(() => cancelarZoomPendiente, [cancelarZoomPendiente]);
  // Publica el zoom ya (cámara sin animar, frame de navegación o lectura real de la cámara). Cancela
  // cualquier publicación diferida: una orden de cámara más nueva manda.
  const actualizarZoomRuta = useCallback(
    (zoom: number) => {
      cancelarZoomPendiente();
      emisorZoom.publicar(zoom);
    },
    [emisorZoom, cancelarZoomPendiente],
  );
  // Publica el zoom destino de una animación al TERMINAR (tras `ms`), no al empezar: así el ancho no
  // salta antes de que la cámara llegue. Una orden más nueva (`actualizarZoomRuta` o este mismo)
  // cancela la pendiente. Una sola publicación por animación: no cruza el bridge a 30 Hz.
  const programarZoomRuta = useCallback(
    (zoom: number, ms: number) => {
      cancelarZoomPendiente();
      timerZoomRef.current = setTimeout(() => {
        timerZoomRef.current = null;
        emisorZoom.publicar(zoom);
      }, ms);
    },
    [emisorZoom, cancelarZoomPendiente],
  );
  // Ancho/alto del mapa en dp (onLayout): para estimar el zoom del encuadre (`zoomParaEncuadre`).
  const tamanoMapaRef = useRef({ ancho: 0, alto: 0 });
  // Secuencia de lecturas `getCamera` (rumbo): una respuesta fuera de orden se descarta.
  const secLecturaCamaraRef = useRef(0);

  // Aplica una cámara propia (set/animate) y publica su zoom destino para el ancho de la línea:
  // único camino de cámara programática, así ninguno deja el ancho del modo anterior. Con animación
  // el zoom se publica al terminar (`programarZoomRuta`); sin animación, al instante.
  const aplicarCamara = useCallback(
    (camara: Partial<Camera>, duracion?: number) => {
      const mapa = mapRef.current;
      if (!mapa) return;
      if (duracion !== undefined) mapa.animateCamera(camara, { duration: duracion });
      else mapa.setCamera(camara);
      if (typeof camara.zoom !== 'number') return;
      if (duracion !== undefined)
        programarZoomRuta(camara.zoom, duracion + MARGEN_FIN_ANIMACION_MS);
      else actualizarZoomRuta(camara.zoom);
    },
    [actualizarZoomRuta, programarZoomRuta],
  );

  const enFase = useMemo(() => crearFiltroFase(ordenEfectivo, fase), [ordenEfectivo, fase]);
  const puntosControlData = useMemo(
    () =>
      // La numeración es la del orden efectivo COMPLETO (no salta entre fases); solo se filtran.
      ordenEfectivo
        .map((pc, idx) => ({
          pc,
          orden: idx + 1,
        }))
        .filter(({ pc }) => enFase(pc))
        .map(({ pc, orden }) => ({
          id: pc.id,
          orden,
          latitude: pc.coord.coordinates[1],
          longitude: pc.coord.coordinates[0],
        })),
    [ordenEfectivo, enFase],
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
  // Espejo de `camara.orientacion` (heading-up o norte arriba) para el `setCamera` por frame. Se
  // actualiza en el mismo efecto que `modoRef`, declarado ANTES del efecto de `seq`, así el
  // movimiento puntual de `alternarOrientacion` ya ve la orientación nueva.
  const orientacionRef = useRef<OrientacionCamara>(camara.orientacion);
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
      // Vista general = norte arriba: la brújula se reinicia (el botón además se oculta ahí).
      emisorRumbo?.publicar(0, true);
      if (accion === 'ajustar-ruta') {
        const coordsEncuadre = coordenadasEncuadre(coordenadasRuta, posicion);
        mapa.fitToCoordinates(coordsEncuadre, {
          edgePadding: { ...PADDING_ENCUADRE_RUTA },
          animated,
        });
        // Zoom estimado del encuadre (el idle de la región lo afina al terminar).
        const { ancho, alto } = tamanoMapaRef.current;
        const zoomFit = zoomParaEncuadre(coordsEncuadre, ancho, alto, PADDING_ENCUADRE_RUTA);
        if (zoomFit !== null) {
          if (animated) programarZoomRuta(zoomFit, DURACION_ENCUADRE_MS + MARGEN_FIN_ANIMACION_MS);
          else actualizarZoomRuta(zoomFit);
        }
      } else if (accion === 'centrar-posicion' && posicion) {
        const camaraCentrada = {
          center: aLatLng(posicion),
          heading: 0,
          pitch: 0,
          zoom: ZOOM_SEGUIMIENTO,
        };
        aplicarCamara(camaraCentrada, animated ? 400 : undefined);
      }
    },
    [coordenadasRuta, emisorRumbo, actualizarZoomRuta, programarZoomRuta, aplicarCamara],
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
  const sincronizarCamaraNavegacion = useCallback(
    (reanimarSiSuspendida = false) => {
      const mapa = mapRef.current;
      const posicion = posicionMostradaRef.current;
      if (modoRef.current !== 'navegacion' || !camaraListaRef.current || !mapa || !posicion) return;
      const restante = camaraSuspendidaHastaRef.current - Date.now();
      const camaraNav = construirCamaraNavegacion(
        posicion,
        orientacionRef.current,
        zoomActualRef.current,
      );
      if (camaraNav.heading !== undefined) emisorRumbo?.publicar(camaraNav.heading);
      if (reanimarSiSuspendida && restante > 80) {
        aplicarCamara(camaraNav, restante);
        return;
      }
      camaraSuspendidaHastaRef.current = 0;
      aplicarCamara(camaraNav);
    },
    [emisorRumbo, aplicarCamara],
  );

  // Cámara de navegación sobre la posición mostrada. Sin posición todavía no hace nada: el primer
  // fix ubica la cámara (`publicarYSeguir`). Con `duracion` > 0 anima y suspende el `setCamera`
  // por frame mientras dura (y agenda la sincronización para cuando venza); con 0 salta directo.
  const seguirVehiculo = useCallback(
    (duracion: number) => {
      const posicion = posicionMostradaRef.current;
      const mapa = mapRef.current;
      if (!posicion || !mapa || !camaraListaRef.current) return;
      const camaraNav = construirCamaraNavegacion(
        posicion,
        orientacionRef.current,
        zoomActualRef.current,
      );
      // Destino de la animación: la aguja de la brújula va directo al rumbo final.
      if (camaraNav.heading !== undefined) emisorRumbo?.publicar(camaraNav.heading, true);
      cancelarTimerSuspension();
      if (duracion > 0) {
        camaraSuspendidaHastaRef.current = Date.now() + duracion;
        aplicarCamara(camaraNav, duracion);
        timerSuspensionRef.current = setTimeout(() => {
          timerSuspensionRef.current = null;
          sincronizarCamaraNavegacion(false);
        }, duracion);
      } else {
        aplicarCamara(camaraNav);
      }
    },
    [cancelarTimerSuspension, sincronizarCamaraNavegacion, emisorRumbo, aplicarCamara],
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
    orientacionRef.current = camara.orientacion;
    // En `general` no hay suspensión que reponer.
    if (camara.modo === 'general') cancelarTimerSuspension();
  }, [camara.modo, camara.orientacion, cancelarTimerSuspension]);

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

  // Detección de gestos por toques crudos, redundante a propósito: en Android con la arquitectura
  // vieja (`newArchEnabled: false`) `isGesture` de `onRegionChangeStart` no es confiable y
  // `onPanDrag` solo cubre el arrastre de un dedo. Los `setCamera`/`animateCamera` propios no
  // producen toques, así que esto solo se dispara por el conductor; un toque simple (marcador) que
  // no se mueve más de `UMBRAL_GESTO_PX` no saca de navegación.
  const inicioToqueRef = useRef<{ x: number; y: number } | null>(null);
  const onTouchStartMapa = useCallback(
    (e: GestureResponderEvent) => {
      const { touches } = e.nativeEvent;
      if (touches.length >= 2) {
        salirANavegacionLibre();
        return;
      }
      const toque = touches[0];
      inicioToqueRef.current = toque ? { x: toque.pageX, y: toque.pageY } : null;
    },
    [salirANavegacionLibre],
  );
  const onTouchMoveMapa = useCallback(
    (e: GestureResponderEvent) => {
      if (modoRef.current !== 'navegacion') return;
      const { touches } = e.nativeEvent;
      const toque = touches[0];
      if (!toque) return;
      if (
        esGestoSobreMapa(inicioToqueRef.current, { x: toque.pageX, y: toque.pageY }, touches.length)
      ) {
        salirANavegacionLibre();
      }
    },
    [salirANavegacionLibre],
  );

  // En libre y en general el rumbo de la cámara lo cambia el conductor a mano (o `fitToCoordinates`):
  // al terminar el movimiento se lee la cámara real para que la aguja la siga. En navegación NO:
  // Limitación aceptada: en libre/general, durante un pinch o arrastre el ancho de la línea NO se
  // actualiza; recién lo hace aquí, al terminar el gesto (idle). Publicar por frame de gesto exigiría
  // `getCamera` (bridge) a cada cuadro. Es un desajuste breve y solo de grosor.
  // `onRegionChangeComplete` llega seguido (cada `moveCamera` propio), `getCamera` cruza el bridge y
  // el rumbo ya se publica desde el `setCamera` por frame. Al resolverse la promesa se vuelve a
  // mirar el modo: una lectura vieja no debe pisar el rumbo que fuerza el recentrar.
  const onRegionChangeComplete = useCallback(
    (_region: Region) => {
      // En navegación la cámara la publica `aplicarCamara`/el marcador.
      const modoDisparo = modoRef.current;
      if (modoDisparo === 'navegacion') return;
      // Una sola lectura de `getCamera` por idle, compartida entre rumbo y zoom: `longitudeDelta`
      // (bounding box en Android) ignora pitch y rotación y subestimaría el zoom.
      const secuencia = ++secLecturaCamaraRef.current;
      mapRef.current
        ?.getCamera()
        .then((c) => {
          // Lectura vieja, modo cambiado desde que se disparó (p. ej. navegación→general) o ya
          // en navegación: se descarta.
          if (secuencia !== secLecturaCamaraRef.current || modoRef.current !== modoDisparo) return;
          emisorRumbo?.publicar(c.heading);
          if (typeof c.zoom === 'number') actualizarZoomRuta(c.zoom);
        })
        .catch(() => {
          // Mapa desmontado o no listo: la aguja y el zoom quedan como estaban.
        });
    },
    [emisorRumbo, actualizarZoomRuta],
  );

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
    const id = requestAnimationFrame(() => {
      // En libre el conductor movió el mapa: un snap del sheet no debe recentrarlo.
      if (modoRef.current !== 'navegacion') return;
      // Con suspensión en curso (entrada o recentrar) se relanza el `animateCamera` por el tiempo
      // restante. Sin ella (p. ej. el sheet hizo snap) la cámara ANIMA 300 ms al nuevo encuadre, con
      // la misma suspensión del `setCamera` por frame, en vez de saltar.
      const restante = camaraSuspendidaHastaRef.current - Date.now();
      if (restante > 80) sincronizarCamaraNavegacion(true);
      else seguirVehiculo(DURACION_REENCUADRE_PADDING_MS);
    });
    return () => cancelAnimationFrame(id);
  }, [mapPadding, esGeneral, sincronizarCamaraNavegacion, seguirVehiculo]);

  const onMapReady = useCallback(() => {
    mapaListoRef.current = true;
    intentarCamaraInicial();
  }, [intentarCamaraInicial]);

  const onLayoutMapa = useCallback(
    (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      if (width > 0 && height > 0) {
        tamanoMapaRef.current = { ancho: width, alto: height };
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
    <View
      style={[styles.container, style]}
      onTouchStart={onTouchStartMapa}
      onTouchMove={onTouchMoveMapa}
    >
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        onMapReady={onMapReady}
        onLayout={onLayoutMapa}
        onPanDrag={onPanDrag}
        onRegionChangeStart={onRegionChangeStart}
        onRegionChangeComplete={onRegionChangeComplete}
        mapPadding={mapPadding}
        rotateEnabled
        // Sin gesto de inclinación (el pitch lo fija el modo navegación por código, que sigue
        // funcionando) y sin controles propios de Google.
        pitchEnabled={false}
        zoomControlEnabled={false}
        toolbarEnabled={false}
        // Brújula nativa apagada: tocarla ponía el norte arriba y sacaba de navegación sin forma de
        // volver. La pantalla dibuja una propia (`BrujulaMapa`) alimentada por `emisorRumbo`.
        showsCompass={false}
      >
        <RutaPolylines
          coordenadasRuta={coordenadasRuta}
          tracking={tracking}
          mostrarCaminoResaltado={mostrarCaminoResaltado}
          caminoResaltadoCoords={caminoResaltadoCoords}
          emisorZoom={emisorZoom}
          latitud={latitudRuta}
        />
        {designacion && fase !== 'ida' ? (
          <DesignacionMapa
            designacion={designacion}
            tracking={tracking}
            emisorZoom={emisorZoom}
            latitud={latitudRuta}
          />
        ) : null}
        <PuntosControlMarcadores
          puntosControlData={puntosControlData}
          tracking={tracking}
          estadosPuntosControl={estadosPuntosControl}
        />
        <MarcadorConductorAnimado
          posicionMapa={posicionMapa}
          mapRef={mapRef}
          modoRef={modoRef}
          orientacionRef={orientacionRef}
          emisorRumbo={emisorRumbo}
          camaraSuspendidaHastaRef={camaraSuspendidaHastaRef}
          camaraListaRef={camaraListaRef}
          posicionMostradaRef={posicionMostradaRef}
          rutaSnap={rutaSnap}
          zoomActualRef={zoomActualRef}
          onZoom={actualizarZoomRuta}
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
  puntoEsperaContenedor: {
    width: 52,
    height: 52,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
  },
  puntoEsperaMarcador: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: quivoColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  puntoEsperaTexto: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 11,
  },
  puntoControlTexto: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 11.5,
  },
});

'use client';

// Motor Google Maps de `RouteMap` (PR 3 de `docs/plan-en-vivo-google.md`). Implementa el mismo
// contrato `RouteMapProps` que `route-map-impl.tsx` (MapLibre) para todo lo que usa `/en-vivo`.
// `RouteMap.tsx` lo carga con `React.lazy` SOLO cuando `engine="google"`, así las pantallas que
// siguen en MapLibre no descargan nada de Google.
//
// Decisiones de diseño:
// - Mapa vectorial (Map ID) con `@vis.gl/react-google-maps` (carga de la API, contexto, `useMap`).
// - Rutas y zonas: `google.maps.Polyline` / `Circle` imperativos, reconciliados por id (solo se
//   actualiza el path si cambió; se limpian al desmontar).
// - Puntos y vehículos: `AdvancedMarkerElement` con HTML propio, creados de forma IMPERATIVA y no
//   con el componente `<AdvancedMarker>`: la posición de TODOS los vehículos se actualiza en cada
//   frame (`requestAnimationFrame`) para interpolarla, y re-renderizar N componentes de React a
//   60 fps sería puro desperdicio. Es el mismo objeto de la API que usa el componente.
// - Cámara: la decisión de cuándo encuadrar vive en `route-map-encuadre.ts` (compartida con el
//   motor MapLibre); el follow usa `route-map-proyeccion.ts` + `isWithinCentralViewport`.
//   `onUserPan` se dispara con `dragstart`, con `zoom_changed` NO programático y con el input DOM
//   del usuario sobre el div del mapa (rueda, doble click, teclas +/-, pellizco, botones de
//   zoom; ver `route-map-gestos.ts`), éste último independiente de la bandera: cada vez que
//   este módulo mueve la cámara (fitBounds/panTo/setCenter/setZoom) levanta una bandera que se
//   baja en el siguiente `idle` (o por timeout), para no confundir nuestros movimientos con los
//   del usuario, pero un gesto real dentro de esa ventana igual se reporta.
//
// Props de `RouteMapProps` que este motor NO soporta todavía (se ignoran sin romper; los usa el
// editor de rutas, que migra último):
// - `MapPoint.draggable` / `MapPoint.onDragEnd`: no hay arrastre de marcadores.
// - `MapRoute.label` se muestra como etiqueta HTML en el punto medio de la ruta (no sigue la
//   curvatura de la línea como el texto de MapLibre). El `line-offset` entre rutas paralelas SÍ se
//   emula (`desplazarCamino`, se recalcula en cada cambio de zoom para mantener los mismos px).
// - `pinType: 'pulse'` se dibuja como nodo estático (sin el halo pulsante del editor).

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  APIProvider,
  ColorScheme,
  ControlPosition,
  Map as GoogleMap,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { cx } from '../utils.js';
import type { MapPoint, MapRoute, MapZone } from '../types.js';
import { Button, Loader } from './primitives.js';
import type { RouteMapProps } from './route-map-impl.js';
import { isWithinCentralViewport } from './route-map-geometry.js';
import { desplazarCamino, latLngAPixelContenedor } from './route-map-proyeccion.js';
import { esGestoUsuarioDeCamara } from './route-map-gestos.js';
import {
  encuadreAuto,
  encuadreUnaVez,
  estadoEncuadreAutoInicial,
  estadoEncuadreUnaVezInicial,
} from './route-map-encuadre.js';
import {
  avanzarAnimacion,
  encolarNuevosPuntos,
  estadoInicialAnimacion,
  type EstadoAnimacionVehiculo,
} from './vehicle-marker-animation.js';
import {
  apuntarInterpolacionA,
  duracionInterpolacion,
  interpolacionEnMovimiento,
  interpolacionQuieta,
  posicionInterpolada,
  type EstadoInterpolacion,
  type LatLngSimple,
} from './route-map-interpolacion.js';
import {
  VEHICULO_ICONOS,
  VEHICULO_ICONO_FALLBACK,
  buildVehiculoIconoSvg,
  colorTextoContraste,
  etiquetaFrescura,
  nodeNumberFromId,
  resolveColor,
  resolvePointId,
  routeVisuals,
} from './route-map-shared.js';

type MarcadorAvanzado = google.maps.marker.AdvancedMarkerElement;

// Cochabamba, igual que el motor MapLibre.
const CENTRO_POR_DEFECTO: LatLngSimple = { lat: -17.3935, lng: -66.157 };
const ZOOM_POR_DEFECTO = 13;
/** Map ID de demostración de Google: solo desarrollo; producción pasa el suyo por prop. */
const MAP_ID_DEMO = 'DEMO_MAP_ID';
const PADDING_ENCUADRE_PX = 32;
const ZOOM_MAXIMO_ENCUADRE = 17;
/** Librerías de Google que se cargan con la API. Constante de módulo: `APIProvider` recrea su
 * default `[]` en cada render y eso re-dispara su efecto de carga. */
const LIBRERIAS_GOOGLE = ['marker'];
/** Tiempo máximo que una bandera "movimiento programático" puede quedar levantada si el mapa
 * no emite `idle` (p. ej. el encuadre no cambió nada). */
const TIMEOUT_PROGRAMATICO_MS = 1200;
// Mismos umbrales de zoom que las capas de texto de MapLibre.
const ZOOM_ETIQUETA_RUTA = 12;
const ZOOM_ETIQUETA_PARADA = 11.5;
const ZOOM_ETIQUETA_MARCADOR = 13;

// ---------------------------------------------------------------------------------------------
// Tema
// ---------------------------------------------------------------------------------------------

/** Tema oscuro del panel. En `apps/web` el tema sale únicamente de `prefers-color-scheme`
 * (`tokens.css`; no hay toggle ni `data-theme` en la app), así que se sigue esa media query y se
 * reacciona a sus cambios. Se lee de forma perezosa: este componente solo se renderiza en cliente. */
function useModoOscuro(): boolean {
  const [oscuro, setOscuro] = useState(
    () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches),
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const alCambiar = () => setOscuro(media.matches);
    alCambiar();
    media.addEventListener('change', alCambiar);
    return () => media.removeEventListener('change', alCambiar);
  }, []);
  return oscuro;
}

/** Color CSS usable en el canvas del mapa (polilíneas, círculos): resuelve `var(--qv-*)` contra
 * los tokens vigentes del documento, que `resolveColor` (tabla estática) no conoce completos. */
function colorParaMapa(color: string | undefined, oscuro: boolean): string {
  const valor = color?.trim();
  const token = valor?.match(/^var\((--[^)]+)\)$/)?.[1];
  if (token && typeof document !== 'undefined') {
    const resuelto = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    if (resuelto) return resuelto;
  }
  return resolveColor(color, oscuro);
}

// ---------------------------------------------------------------------------------------------
// Elementos HTML de los marcadores
// ---------------------------------------------------------------------------------------------

function crearEtiqueta(texto: string, variante: 'stop' | 'marker' | 'route'): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = `qv-gmap-label qv-gmap-label--${variante}`;
  el.textContent = texto;
  return el;
}

/** Marcador de vehículo: mismo badge que los sprites de MapLibre (`buildVehiculoIconoSvg`, forma
 * y color por `estadoFrescura`) + placa debajo. La raíz mide lo que el badge; la placa cuelga.
 * Con `onClick` es un botón enfocable; sin él, una imagen con nombre accesible (el estado de
 * frescura va en el texto, no solo en la forma/color del badge). */
function crearElementoVehiculo(punto: MapPoint): HTMLElement {
  const spec =
    VEHICULO_ICONOS.find((s) => s.estado === punto.estadoFrescura) ??
    VEHICULO_ICONOS.find((s) => s.estado === VEHICULO_ICONO_FALLBACK)!;
  const raiz = document.createElement('div');
  raiz.className = `qv-gmap-veh qv-gmap-veh--${spec.estado}`;
  const placa = punto.placa?.trim() ?? '';
  const nombre = `Vehículo ${placa || punto.label || ''}`.trim();
  // El estado va siempre en el texto; si la descripción del consumidor ya lo menciona no se repite.
  const estado = etiquetaFrescura(punto.estadoFrescura);
  const descripcion = punto.description?.trim() ?? '';
  const estadoYaDicho = estado !== '' && descripcion.toLowerCase().includes(estado.toLowerCase());
  raiz.setAttribute('aria-label', [nombre, estadoYaDicho ? '' : estado, descripcion].filter(Boolean).join(', '));
  if (punto.onClick) {
    raiz.setAttribute('role', 'button');
    raiz.tabIndex = 0;
    raiz.classList.add('qv-gmap--clickable');
  } else {
    raiz.setAttribute('role', 'img');
  }
  if (punto.description) raiz.title = punto.description;
  // El SVG sale de constantes del módulo (sin datos del usuario): innerHTML es seguro acá.
  raiz.innerHTML = buildVehiculoIconoSvg(spec).replace('<svg ', '<svg class="qv-gmap-veh__badge" aria-hidden="true" ');
  if (placa) {
    const etiqueta = document.createElement('span');
    etiqueta.className = 'qv-gmap-veh__placa';
    etiqueta.setAttribute('aria-hidden', 'true');
    etiqueta.textContent = placa;
    raiz.appendChild(etiqueta);
  }
  return raiz;
}

/** Punto de control / parada / nodo: círculo con el color del consumidor (admite
 * `var(--qv-*)` tal cual, el navegador lo resuelve) y borde del color de la superficie. Solo es
 * botón enfocable (role, tabindex, nombre accesible) cuando tiene `onClick`. */
function crearElementoPunto(
  punto: MapPoint,
  tipo: 'stop' | 'marker',
  rol: 'start' | 'end' | 'stop' | 'marker',
  id: string,
  oscuro: boolean,
): HTMLElement {
  const pinType = punto.pinType ?? 'pin';
  const raiz = document.createElement('div');
  raiz.className = `qv-gmap-pt qv-gmap-pt--${tipo === 'stop' ? 'parada' : pinType} qv-gmap-pt--rol-${rol}`;
  raiz.style.setProperty('--qv-gmap-pt-color', punto.color?.trim() || 'var(--qv-color-primary)');
  if (punto.description || punto.label) raiz.title = [punto.label, punto.description].filter(Boolean).join(' — ');
  if (punto.onClick) {
    raiz.setAttribute('role', 'button');
    raiz.tabIndex = 0;
    raiz.classList.add('qv-gmap--clickable');
    raiz.setAttribute('aria-label', [punto.label?.trim(), punto.description].filter(Boolean).join(', '));
  }
  const punta = document.createElement('span');
  punta.className = 'qv-gmap-pt__dot';
  const numero = pinType === 'node' || pinType === 'pulse' ? nodeNumberFromId(id) : '';
  if (numero) {
    punta.textContent = numero;
    // El número va sobre un color arbitrario del consumidor: se elige blanco u oscuro por contraste.
    raiz.style.setProperty('--qv-gmap-pt-texto', colorTextoContraste(colorParaMapa(punto.color, oscuro)));
  }
  raiz.appendChild(punta);
  const etiqueta = punto.label?.trim();
  if (etiqueta) raiz.appendChild(crearEtiqueta(etiqueta, tipo === 'stop' ? 'stop' : 'marker'));
  return raiz;
}

/** Click y Enter/Espacio sobre el contenido de un marcador. Solo se engancha si el punto es
 * clickable (la firma incluye `Boolean(onClick)`, así que si cambia el contenido se recrea). El
 * `onClick` se lee de la entrada en cada activación para ver siempre el último callback. */
function enlazarActivacion(contenido: HTMLElement, entrada: { onClick?: () => void }): void {
  if (!contenido.classList.contains('qv-gmap--clickable')) return;
  contenido.addEventListener('click', () => entrada.onClick?.());
  contenido.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && entrada.onClick) {
      e.preventDefault();
      entrada.onClick();
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Controlador (vive dentro de <GoogleMap>, donde `useMap()` ya devuelve la instancia)
// ---------------------------------------------------------------------------------------------

interface EntradaPunto {
  id: string;
  marker: MarcadorAvanzado;
  firma: string;
  esVehiculo: boolean;
  interp: EstadoInterpolacion;
  ultima: LatLngSimple;
  onClick?: () => void;
}

interface EntradaRuta {
  casing: google.maps.Polyline;
  linea: google.maps.Polyline;
  etiqueta: MarcadorAvanzado | null;
  /** Camino sin desplazar y offset lateral en px (0 si hay una sola ruta): se reaplica al zoom. */
  base: LatLngSimple[];
  offsetPx: number;
  firma: string;
}

interface EntradaZona {
  circulo: google.maps.Circle;
  firma: string;
}

/** Estado de encuadre que sobrevive al remonte del mapa por cambio de tema (vive en el padre). */
interface EncuadrePersistente {
  auto: ReturnType<typeof estadoEncuadreAutoInicial>;
  unaVez: ReturnType<typeof estadoEncuadreUnaVezInicial>;
  fitMode: RouteMapProps['fitMode'];
}

type ControladorProps = RouteMapProps & {
  oscuro: boolean;
  camaraRef: { current: { center: LatLngSimple; zoom: number } | null };
  encuadreRef: { current: EncuadrePersistente };
  onListo: () => void;
};

function firmaPuntos(puntos: Array<{ lat: number; lng: number }>): string {
  return puntos.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join('|');
}

function Controlador({
  routes = [],
  markers = [],
  stops = [],
  zones = [],
  interactive = false,
  onMapClick,
  fitMode = 'auto',
  fitKey,
  followPoint,
  onUserPan,
  defaultCenter,
  defaultZoom,
  animatedVehicle,
  oscuro,
  camaraRef,
  encuadreRef,
  onListo,
}: ControladorProps) {
  const map = useMap();
  const libMarker = useMapsLibrary('marker');
  const [listo, setListo] = useState(false);

  // Último valor de los props, para handlers de larga vida (sin re-registrar listeners).
  const datosRef = useRef({ routes, markers, stops, zones });
  datosRef.current = { routes, markers, stops, zones };
  const onUserPanRef = useRef(onUserPan);
  onUserPanRef.current = onUserPan;
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;
  const animatedRef = useRef(animatedVehicle);
  animatedRef.current = animatedVehicle;
  const onListoRef = useRef(onListo);
  onListoRef.current = onListo;

  const reducirMovimientoRef = useRef(false);
  const programaticoRef = useRef(false);
  const timerProgramaticoRef = useRef<number | null>(null);
  /** Hay un encuadre (`fitBounds`) recién pedido cuyo zoom aún hay que limitar a `ZOOM_MAXIMO_ENCUADRE`. */
  const limitarZoomRef = useRef(false);
  const timerLimiteZoomRef = useRef<number | null>(null);

  const rutasRef = useRef(new Map<string, EntradaRuta>());
  const zonasRef = useRef(new Map<string, EntradaZona>());
  const puntosRef = useRef(new Map<string, EntradaPunto>());
  const animEstadoRef = useRef<EstadoAnimacionVehiculo>(estadoInicialAnimacion());
  const animResetKeyRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);


  /** Levanta la bandera "esto lo mueve el código, no el usuario" hasta el próximo `idle`. */
  const marcarProgramatico = useCallback(() => {
    programaticoRef.current = true;
    if (timerProgramaticoRef.current !== null) window.clearTimeout(timerProgramaticoRef.current);
    timerProgramaticoRef.current = window.setTimeout(() => {
      programaticoRef.current = false;
      timerProgramaticoRef.current = null;
    }, TIMEOUT_PROGRAMATICO_MS);
  }, []);

  const cancelarLimiteZoom = useCallback(() => {
    limitarZoomRef.current = false;
    if (timerLimiteZoomRef.current !== null) {
      window.clearTimeout(timerLimiteZoomRef.current);
      timerLimiteZoomRef.current = null;
    }
  }, []);

  // prefers-reduced-motion: los vehículos saltan directo en vez de deslizar.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const alCambiar = () => {
      reducirMovimientoRef.current = media.matches;
    };
    alCambiar();
    media.addEventListener('change', alCambiar);
    return () => media.removeEventListener('change', alCambiar);
  }, []);

  // Etiquetas por nivel de zoom: se publican como data-attributes del div del mapa y las
  // muestra/oculta el CSS (`styles.css`), sin tocar cada marcador.
  const actualizarEtiquetasPorZoom = useCallback((m: google.maps.Map) => {
    const zoom = m.getZoom() ?? ZOOM_POR_DEFECTO;
    const div = m.getDiv();
    div.dataset.lblRoute = zoom >= ZOOM_ETIQUETA_RUTA ? '1' : '0';
    div.dataset.lblStop = zoom >= ZOOM_ETIQUETA_PARADA ? '1' : '0';
    div.dataset.lblMarker = zoom >= ZOOM_ETIQUETA_MARCADOR ? '1' : '0';
  }, []);

  // Listeners del mapa + señal de "listo" (primer idle).
  useEffect(() => {
    if (!map) return undefined;
    actualizarEtiquetasPorZoom(map);
    let cancelado = false;
    const marcarListo = () => {
      if (cancelado) return;
      setListo(true);
      onListoRef.current();
    };
    const respaldo = window.setTimeout(marcarListo, 3000);
    // Input DOM del usuario sobre el mapa (captura): se reporta aunque haya una bandera
    // programática levantada. También cancela cualquier límite de zoom pendiente del encuadre.
    const div = map.getDiv();
    const punteros = new Set<number>();
    const avisarGesto = () => {
      cancelarLimiteZoom();
      onUserPanRef.current?.();
    };
    const alEntrada = (e: Event) => {
      const objetivo = e.target instanceof Element ? e.target : null;
      const enControlGoogle = Boolean(objetivo?.closest('.gm-bundled-control, .gm-control-active'));
      let gesto: boolean;
      if (e.type === 'pointerdown') {
        punteros.add((e as PointerEvent).pointerId);
        gesto = esGestoUsuarioDeCamara({ tipo: 'pointerdown', punterosActivos: punteros.size, enControlGoogle });
      } else if (e.type === 'keydown') {
        const k = e as KeyboardEvent;
        gesto = esGestoUsuarioDeCamara({
          tipo: 'keydown',
          tecla: k.key,
          modificador: k.ctrlKey || k.metaKey || k.altKey,
        });
      } else {
        gesto = esGestoUsuarioDeCamara({ tipo: e.type === 'wheel' ? 'wheel' : 'dblclick' });
      }
      if (gesto) avisarGesto();
    };
    const alSoltar = (e: Event) => {
      punteros.delete((e as PointerEvent).pointerId);
    };
    const tiposEntrada = ['wheel', 'dblclick', 'keydown', 'pointerdown'] as const;
    tiposEntrada.forEach((t) => div.addEventListener(t, alEntrada, { capture: true, passive: true }));
    div.addEventListener('pointerup', alSoltar, true);
    div.addEventListener('pointercancel', alSoltar, true);
    const escuchas: google.maps.MapsEventListener[] = [
      map.addListener('idle', () => {
        programaticoRef.current = false;
        const centro = map.getCenter();
        const zoom = map.getZoom();
        if (limitarZoomRef.current && zoom !== undefined && zoom > ZOOM_MAXIMO_ENCUADRE) {
          // `fitBounds` de Google no tiene `maxZoom`: se corrige acá, una sola vez, sin tocar
          // la opción `maxZoom` del mapa (que el usuario necesita para acercarse más después).
          cancelarLimiteZoom();
          marcarProgramatico();
          map.setZoom(ZOOM_MAXIMO_ENCUADRE);
          return;
        }
        if (centro && zoom !== undefined) {
          camaraRef.current = { center: { lat: centro.lat(), lng: centro.lng() }, zoom };
        }
        window.clearTimeout(respaldo);
        marcarListo();
      }),
      map.addListener('dragstart', () => onUserPanRef.current?.()),
      map.addListener('zoom_changed', () => {
        actualizarEtiquetasPorZoom(map);
        if (!programaticoRef.current) onUserPanRef.current?.();
      }),
      map.addListener('click', (evento: google.maps.MapMouseEvent) => {
        if (!interactiveRef.current || !onMapClickRef.current || !evento.latLng) return;
        onMapClickRef.current({ lat: evento.latLng.lat(), lng: evento.latLng.lng() });
      }),
    ];
    return () => {
      cancelado = true;
      window.clearTimeout(respaldo);
      escuchas.forEach((e) => e.remove());
      tiposEntrada.forEach((t) => div.removeEventListener(t, alEntrada, true));
      div.removeEventListener('pointerup', alSoltar, true);
      div.removeEventListener('pointercancel', alSoltar, true);
    };
  }, [map, camaraRef, actualizarEtiquetasPorZoom, marcarProgramatico, cancelarLimiteZoom]);

  // --- Rutas y zonas ---------------------------------------------------------------------------

  useEffect(() => {
    if (!map) return undefined;
    const rutas = rutasRef.current;
    const zonas = zonasRef.current;
    const puntos = puntosRef.current;
    return () => {
      // Desmontaje real (o cambio de instancia de mapa): se retira todo lo imperativo.
      rutas.forEach((r) => {
        r.casing.setMap(null);
        r.linea.setMap(null);
        if (r.etiqueta) r.etiqueta.map = null;
      });
      rutas.clear();
      zonas.forEach((z) => z.circulo.setMap(null));
      zonas.clear();
      puntos.forEach((p) => {
        p.marker.map = null;
      });
      puntos.clear();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (timerProgramaticoRef.current !== null) window.clearTimeout(timerProgramaticoRef.current);
      cancelarLimiteZoom();
    };
  }, [map, cancelarLimiteZoom]);

  useEffect(() => {
    if (!map) return;
    const existentes = rutasRef.current;
    const vivos = new Set<string>();
    routes
      .filter((ruta) => ruta.points.length > 1)
      .forEach((ruta: MapRoute, indice, dibujables) => {
        vivos.add(ruta.id);
        const base = ruta.points.map((p) => ({ lat: p.lat, lng: p.lng }));
        // Mismo criterio que MapLibre: con varias rutas se reparten ±4 px alrededor del eje.
        const offsetPx = dibujables.length > 1 ? (indice - (dibujables.length - 1) / 2) * 4 : 0;
        const camino = desplazarCamino(base, offsetPx, map.getZoom() ?? 0);
        const etiqueta = ruta.label?.trim() ?? '';
        const firma = [oscuro, ruta.color, ruta.dashed, Boolean(ruta.onClick), etiqueta, indice, offsetPx, firmaPuntos(ruta.points)].join('~');
        const previa = existentes.get(ruta.id);
        if (previa?.firma === firma && (!etiqueta || previa.etiqueta || !libMarker)) {
          return;
        }
        // Los colores (getComputedStyle) se resuelven solo cuando la ruta cambió.
        const visuales = routeVisuals(colorParaMapa(ruta.color, oscuro), oscuro);
        const clickable = Boolean(ruta.onClick);
        const opcionesLinea: google.maps.PolylineOptions = ruta.dashed
          ? {
              strokeOpacity: 0,
              icons: [
                {
                  icon: {
                    path: 'M 0,-1 0,1',
                    strokeOpacity: 0.98,
                    strokeColor: visuales.stroke,
                    strokeWeight: 5.5,
                    scale: 2.75,
                  },
                  offset: '0',
                  repeat: '14px',
                },
              ],
            }
          : { strokeColor: visuales.stroke, strokeOpacity: 0.98, icons: [] };
        const entrada: EntradaRuta = previa ?? {
          casing: new google.maps.Polyline({ map, zIndex: 1, geodesic: false }),
          linea: new google.maps.Polyline({ map, zIndex: 2 + indice, geodesic: false }),
          etiqueta: null,
          base,
          offsetPx,
          firma: '',
        };
        entrada.base = base;
        entrada.offsetPx = offsetPx;
        if (!previa) {
          const alClick = (evento: google.maps.PolyMouseEvent) => {
            datosRef.current.routes.find((r) => r.id === ruta.id)?.onClick?.();
            if (interactiveRef.current && onMapClickRef.current && evento.latLng) {
              onMapClickRef.current({ lat: evento.latLng.lat(), lng: evento.latLng.lng() });
            }
          };
          entrada.casing.addListener('click', alClick);
          entrada.linea.addListener('click', alClick);
          existentes.set(ruta.id, entrada);
        }
        entrada.casing.setOptions({
          path: camino,
          strokeColor: visuales.halo,
          strokeOpacity: 0.96,
          strokeWeight: 10,
          clickable,
          zIndex: 1,
        });
        entrada.linea.setOptions({
          path: camino,
          strokeWeight: 5.5,
          clickable,
          zIndex: 2 + indice,
          ...opcionesLinea,
        });
        // Etiqueta HTML en el vértice central (Google no dibuja texto a lo largo de la línea).
        if (entrada.etiqueta) {
          entrada.etiqueta.map = null;
          entrada.etiqueta = null;
        }
        if (etiqueta && libMarker) {
          const contenido = crearEtiqueta(etiqueta, 'route');
          contenido.style.setProperty('--qv-gmap-label-color', visuales.stroke);
          entrada.etiqueta = new libMarker.AdvancedMarkerElement({
            map,
            position: base[Math.floor(base.length / 2)],
            content: contenido,
            zIndex: 3,
          });
        }
        entrada.firma = firma;
      });
    existentes.forEach((entrada, id) => {
      if (vivos.has(id)) return;
      entrada.casing.setMap(null);
      entrada.linea.setMap(null);
      if (entrada.etiqueta) entrada.etiqueta.map = null;
      existentes.delete(id);
    });
  }, [map, libMarker, routes, oscuro]);

  // El offset lateral es constante en px, así que en metros cambia con el zoom: se reaplica.
  useEffect(() => {
    if (!map) return;
    const oyente = map.addListener('zoom_changed', () => {
      const zoom = map.getZoom() ?? 0;
      rutasRef.current.forEach((entrada) => {
        if (entrada.offsetPx === 0) return;
        const camino = desplazarCamino(entrada.base, entrada.offsetPx, zoom);
        entrada.casing.setPath(camino);
        entrada.linea.setPath(camino);
      });
    });
    return () => oyente.remove();
  }, [map]);

  useEffect(() => {
    if (!map) return;
    const existentes = zonasRef.current;
    const vivos = new Set<string>();
    zones.forEach((zona: MapZone, indice) => {
      if (![zona.lat, zona.lng, zona.radiusMeters].every(Number.isFinite)) return;
      const id = resolvePointId(zona, indice);
      vivos.add(id);
      const firma = [oscuro, zona.color, zona.lat, zona.lng, zona.radiusMeters, Boolean(zona.onClick)].join('~');
      const previa = existentes.get(id);
      if (previa?.firma === firma) return;
      const color = colorParaMapa(zona.color, oscuro);
      const entrada = previa ?? { circulo: new google.maps.Circle({ map, zIndex: 0 }), firma: '' };
      if (!previa) {
        entrada.circulo.addListener('click', () => {
          datosRef.current.zones.find((z, i) => resolvePointId(z, i) === id)?.onClick?.();
        });
        existentes.set(id, entrada);
      }
      entrada.circulo.setOptions({
        center: { lat: zona.lat, lng: zona.lng },
        radius: Math.max(zona.radiusMeters, 1),
        fillColor: color,
        fillOpacity: 0.12,
        strokeColor: color,
        strokeOpacity: 0.45,
        strokeWeight: 1.5,
        clickable: Boolean(zona.onClick),
      });
      entrada.firma = firma;
    });
    existentes.forEach((entrada, id) => {
      if (vivos.has(id)) return;
      entrada.circulo.setMap(null);
      existentes.delete(id);
    });
  }, [map, zones, oscuro]);

  // --- Puntos y vehículos ----------------------------------------------------------------------

  /** Loop de `requestAnimationFrame`: desliza TODOS los vehículos (interpolación) y pisa la
   * posición del `animatedVehicle` con su cola de waypoints. Se detiene solo cuando no queda
   * nada en movimiento (sin CPU en reposo). */
  const tick = useCallback((ahoraMs: number) => {
    rafRef.current = null;
    let seguir = false;
    const animadoId = animatedRef.current?.markerId;
    let posicionAnimada: LatLngSimple | null = null;
    if (animadoId && animEstadoRef.current.current) {
      const avance = avanzarAnimacion(animEstadoRef.current, ahoraMs);
      animEstadoRef.current = avance.estado;
      posicionAnimada = avance.posicion;
      if (avance.enMovimiento) seguir = true;
    }
    puntosRef.current.forEach((entrada) => {
      if (!entrada.esVehiculo) return;
      let posicion: LatLngSimple;
      if (posicionAnimada && entrada.id === animadoId) {
        posicion = posicionAnimada;
        entrada.interp = interpolacionQuieta(posicionAnimada);
      } else {
        posicion = posicionInterpolada(entrada.interp, ahoraMs);
        if (interpolacionEnMovimiento(entrada.interp, ahoraMs)) seguir = true;
      }
      if (!Number.isFinite(posicion.lat) || !Number.isFinite(posicion.lng)) return;
      if (posicion.lat !== entrada.ultima.lat || posicion.lng !== entrada.ultima.lng) {
        entrada.marker.position = posicion;
        entrada.ultima = posicion;
      }
    });
    if (seguir) rafRef.current = requestAnimationFrame(tick);
  }, []);

  const asegurarLoop = useCallback(() => {
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  useEffect(() => {
    if (!map || !libMarker) return;
    const entradas = puntosRef.current;
    const ahora = performance.now();
    // ~1 s como máximo (plan: `min(1000, intervalo)`): repartirlo en todo el poll es retraso añadido.
    const duracionMs = duracionInterpolacion(animatedRef.current?.intervalMs);
    const vivos = new Set<string>();

    const items: Array<{ punto: MapPoint; tipo: 'stop' | 'marker'; indice: number; rol: 'start' | 'end' | 'stop' | 'marker' }> = [
      ...stops.map((punto, indice) => ({
        punto,
        tipo: 'stop' as const,
        indice,
        rol: (indice === 0 ? 'start' : indice === stops.length - 1 ? 'end' : 'stop') as 'start' | 'end' | 'stop',
      })),
      ...markers.map((punto, indice) => ({ punto, tipo: 'marker' as const, indice, rol: 'marker' as const })),
    ];

    for (const { punto, tipo, indice, rol } of items) {
      if (!Number.isFinite(punto.lat) || !Number.isFinite(punto.lng)) continue;
      const id = resolvePointId(punto, indice);
      const clave = `${tipo}:${id}`;
      vivos.add(clave);
      const esVehiculo = tipo === 'marker' && punto.pinType === 'vehicle';
      const posicion = { lat: punto.lat, lng: punto.lng };
      const firma = [
        oscuro,
        tipo,
        rol,
        punto.pinType,
        punto.color,
        punto.label,
        punto.description,
        punto.estadoFrescura,
        punto.placa,
        Boolean(punto.onClick),
      ].join('~');
      const previa = entradas.get(clave);
      const zIndex = esVehiculo ? 1000 : tipo === 'marker' ? 200 : 100;

      if (!previa) {
        const contenido = esVehiculo ? crearElementoVehiculo(punto) : crearElementoPunto(punto, tipo, rol, id, oscuro);
        const entrada: EntradaPunto = {
          id,
          marker: new libMarker.AdvancedMarkerElement({ map, position: posicion, content: contenido, zIndex }),
          firma,
          esVehiculo,
          interp: interpolacionQuieta(posicion),
          ultima: posicion,
          onClick: punto.onClick,
        };
        enlazarActivacion(contenido, entrada);
        entradas.set(clave, entrada);
        continue;
      }

      previa.onClick = punto.onClick;
      if (previa.firma !== firma) {
        const anterior = previa.marker.content;
        const teniaFoco = anterior instanceof HTMLElement && document.activeElement === anterior;
        const contenido = esVehiculo ? crearElementoVehiculo(punto) : crearElementoPunto(punto, tipo, rol, id, oscuro);
        enlazarActivacion(contenido, previa);
        previa.marker.content = contenido;
        previa.firma = firma;
        // El contenido se reemplaza entero: si el viejo tenía el foco del teclado, pasa al nuevo
        // (si no, el foco se perdería en cada cambio de estado del vehículo).
        if (teniaFoco && contenido.tabIndex >= 0) {
          contenido.focus({ preventScroll: true });
          if (document.activeElement !== contenido) {
            requestAnimationFrame(() => contenido.focus({ preventScroll: true }));
          }
        }
        // Si cambió el pinType (pin <-> vehículo) el marcador pasa a ser/dejar de ser animado:
        // se actualiza la bandera y el zIndex, y la interpolación arranca desde la posición actual.
        if (previa.esVehiculo !== esVehiculo) {
          previa.esVehiculo = esVehiculo;
          previa.marker.zIndex = zIndex;
          previa.interp = interpolacionQuieta(posicion);
          previa.marker.position = posicion;
          previa.ultima = posicion;
        }
      }
      if (esVehiculo) {
        previa.interp = apuntarInterpolacionA(previa.interp, posicion, ahora, {
          duracionMs,
          reducirMovimiento: reducirMovimientoRef.current,
        });
      } else if (previa.ultima.lat !== posicion.lat || previa.ultima.lng !== posicion.lng) {
        previa.marker.position = posicion;
        previa.ultima = posicion;
      }
    }

    entradas.forEach((entrada, clave) => {
      if (vivos.has(clave)) return;
      entrada.marker.map = null;
      entradas.delete(clave);
    });
    asegurarLoop();
  }, [map, libMarker, markers, stops, oscuro, asegurarLoop]);

  // Animación del vehículo seleccionado (traza + punto vivo). Misma máquina de estados que el
  // motor MapLibre (`vehicle-marker-animation.ts`); acá solo cambia quién dibuja.
  useEffect(() => {
    if (!map) return;
    if (!animatedVehicle || animatedVehicle.points.length === 0) {
      animEstadoRef.current = estadoInicialAnimacion();
      animResetKeyRef.current = null;
      return;
    }
    if (animResetKeyRef.current !== animatedVehicle.resetKey) {
      animResetKeyRef.current = animatedVehicle.resetKey;
      animEstadoRef.current = estadoInicialAnimacion();
    }
    animEstadoRef.current = encolarNuevosPuntos(
      animEstadoRef.current,
      animatedVehicle.points,
      animatedVehicle.intervalMs,
      { reducirMovimiento: reducirMovimientoRef.current },
    );
    asegurarLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps por campo: `animatedVehicle` cambia de identidad en cada render
  }, [map, animatedVehicle?.resetKey, animatedVehicle?.points, animatedVehicle?.intervalMs, animatedVehicle?.markerId, asegurarLoop]);

  // --- Cámara ----------------------------------------------------------------------------------

  const puntosVisibles = useMemo(
    () =>
      [...routes.flatMap((r) => r.points), ...markers, ...stops, ...zones].filter(
        (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng),
      ),
    [routes, markers, stops, zones],
  );
  // La firma O(N) solo hace falta en 'auto' (reencuadra al cambiar el conjunto); 'once' y 'off'
  // solo necesitan saber si hay puntos.
  const firmaLimites = useMemo(
    () => (fitMode === 'auto' ? firmaPuntos(puntosVisibles) : ''),
    [fitMode, puntosVisibles],
  );
  const hayPuntos = puntosVisibles.length > 0;

  useEffect(() => {
    const persistente = encuadreRef.current;
    if (persistente.fitMode !== fitMode) {
      persistente.fitMode = fitMode;
      persistente.auto = estadoEncuadreAutoInicial();
      persistente.unaVez = estadoEncuadreUnaVezInicial(fitKey);
    }
    if (!map || !listo || fitMode === 'off') return;
    let encuadrar: boolean;
    if (fitMode === 'auto') {
      const decision = encuadreAuto({ firma: firmaLimites, hayPuntos, estado: persistente.auto });
      persistente.auto = decision.estado;
      encuadrar = decision.encuadrar;
    } else {
      const decision = encuadreUnaVez({ fitKey, hayPuntos, estado: persistente.unaVez });
      persistente.unaVez = decision.estado;
      encuadrar = decision.encuadrar;
    }
    if (!encuadrar) return;
    const [primero] = puntosVisibles;
    if (!primero) return;
    marcarProgramatico();
    if (puntosVisibles.length === 1) {
      map.setCenter({ lat: primero.lat, lng: primero.lng });
      map.setZoom(Math.max(map.getZoom() ?? 0, 14));
      return;
    }
    const limites = new google.maps.LatLngBounds();
    puntosVisibles.forEach((p) => limites.extend({ lat: p.lat, lng: p.lng }));
    // `fitBounds` de Google no tiene `maxZoom`. En vez de fijar la opción `maxZoom` del mapa (que
    // quedaría puesta si el encuadre no mueve la cámara y no llega ningún `idle`), se pide un
    // límite pendiente: el `idle` que sigue lo aplica (setZoom) y un timeout lo descarta, así
    // nunca queda un tope persistente ni se interpone con un zoom posterior del usuario.
    limitarZoomRef.current = true;
    if (timerLimiteZoomRef.current !== null) window.clearTimeout(timerLimiteZoomRef.current);
    timerLimiteZoomRef.current = window.setTimeout(() => {
      timerLimiteZoomRef.current = null;
      if (!limitarZoomRef.current) return;
      limitarZoomRef.current = false;
      const zoomActual = map.getZoom();
      if (zoomActual !== undefined && zoomActual > ZOOM_MAXIMO_ENCUADRE) {
        marcarProgramatico();
        map.setZoom(ZOOM_MAXIMO_ENCUADRE);
      }
    }, TIMEOUT_PROGRAMATICO_MS);
    map.fitBounds(limites, PADDING_ENCUADRE_PX);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo cuando cambian firma/clave/modo
  }, [map, listo, firmaLimites, fitKey, fitMode]);

  // Centro/zoom por defecto mientras no hay ningún punto.
  const centroLat = defaultCenter?.[0];
  const centroLng = defaultCenter?.[1];
  useEffect(() => {
    if (!map || !listo || centroLat === undefined || centroLng === undefined || hayPuntos) return;
    marcarProgramatico();
    map.setCenter({ lat: centroLat, lng: centroLng });
    map.setZoom(defaultZoom ?? ZOOM_POR_DEFECTO);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- igual que el motor MapLibre: sin `hayPuntos`
  }, [map, listo, centroLat, centroLng, defaultZoom]);

  // Follow: `panTo` solo si el punto salió del 60% central; jamás toca el zoom.
  const followLat = followPoint?.lat;
  const followLng = followPoint?.lng;
  useEffect(() => {
    if (!map || !listo || !Number.isFinite(followLat) || !Number.isFinite(followLng)) return;
    if (followLat === undefined || followLng === undefined) return;
    const centro = map.getCenter();
    const zoom = map.getZoom();
    if (!centro || zoom === undefined) return;
    const div = map.getDiv();
    const pixel = latLngAPixelContenedor(
      { lat: followLat, lng: followLng },
      { lat: centro.lat(), lng: centro.lng() },
      zoom,
      { x: div.clientWidth, y: div.clientHeight },
    );
    if (isWithinCentralViewport(pixel, { x: div.clientWidth, y: div.clientHeight })) return;
    marcarProgramatico();
    map.panTo({ lat: followLat, lng: followLng });
  }, [map, listo, followLat, followLng, marcarProgramatico]);

  return null;
}

// ---------------------------------------------------------------------------------------------
// Componente público del motor
// ---------------------------------------------------------------------------------------------

function MensajeMapa({ titulo, detalle, onReintentar }: { titulo: string; detalle: string; onReintentar?: () => void }) {
  return (
    <div className="qv-route-map__loading qv-gmap__mensaje" role="alert">
      <strong>{titulo}</strong>
      <span>{detalle}</span>
      {onReintentar ? (
        <Button variant="secondary" size="sm" onClick={onReintentar}>
          Reintentar
        </Button>
      ) : null}
    </div>
  );
}

export function RouteMap(props: RouteMapProps) {
  const { googleMapsApiKey, googleMapsMapId, height = '420px', className, loading = false, defaultCenter, defaultZoom } = props;
  const oscuro = useModoOscuro();
  const [listo, setListo] = useState(false);
  const [authFallida, setAuthFallida] = useState(false);
  const [errorCarga, setErrorCarga] = useState(false);
  const camaraRef = useRef<{ center: LatLngSimple; zoom: number } | null>(null);
  const encuadreRef = useRef<EncuadrePersistente>({
    auto: estadoEncuadreAutoInicial(),
    unaVez: estadoEncuadreUnaVezInicial(props.fitKey),
    fitMode: props.fitMode ?? 'auto',
  });
  const alErrorCarga = useCallback(() => setErrorCarga(true), []);
  const alListo = useCallback(() => setListo(true), []);
  // "Reintentar" recarga la página. Remontar `APIProvider` con otra `key` NO sirve: el cargador de
  // `@vis.gl/react-google-maps` es un singleton de módulo, y tras un fallo el nuevo proveedor
  // vuelve a pedir el script pero nunca pasa a estado LOADED (verificado con Playwright), así que
  // el mapa no se crea. Una recarga limpia el singleton.
  const reintentar = useCallback(() => window.location.reload(), []);

  // Google invoca `window.gm_authFailure` cuando rechaza la key (referrer no permitido, API no
  // habilitada, facturación). Sin esto el usuario solo vería el cartel genérico de Google.
  useEffect(() => {
    const ventana = window as unknown as { gm_authFailure?: () => void };
    const previa = ventana.gm_authFailure;
    ventana.gm_authFailure = () => setAuthFallida(true);
    return () => {
      ventana.gm_authFailure = previa;
    };
  }, []);

  // El `colorScheme` de Google se fija al crear el mapa: al cambiar el tema se remonta (ver `key`).
  useEffect(() => {
    setListo(false);
  }, [oscuro]);

  // Sin key no hay mapa: al usuario final no se le muestra el nombre de la variable de entorno
  // (no puede hacer nada con ella), pero el desarrollador la ve en la consola.
  useEffect(() => {
    if (!googleMapsApiKey) {
      console.error('RouteMap (engine="google"): falta NEXT_PUBLIC_GOOGLE_MAPS_API_KEY en esta instalación.');
    }
  }, [googleMapsApiKey]);

  const contenedor = (hijos: ReactNode) => (
    <div className={cx('qv-route-map', 'qv-gmap', className)} style={{ height }}>
      {hijos}
    </div>
  );

  if (!googleMapsApiKey) {
    return contenedor(
      <MensajeMapa
        titulo="Mapa no disponible"
        detalle="Este panel no tiene configurado Google Maps. Avisa al administrador."
      />,
    );
  }

  const camara = camaraRef.current;
  const centroInicial: LatLngSimple = camara
    ? camara.center
    : defaultCenter
      ? { lat: defaultCenter[0], lng: defaultCenter[1] }
      : CENTRO_POR_DEFECTO;
  const zoomInicial = camara ? camara.zoom : (defaultZoom ?? ZOOM_POR_DEFECTO);
  const fallo = authFallida || errorCarga;

  return contenedor(
    <>
      <APIProvider
        apiKey={googleMapsApiKey}
        language="es"
        libraries={LIBRERIAS_GOOGLE}
        onError={alErrorCarga}
      >
        <GoogleMap
          key={oscuro ? 'oscuro' : 'claro'}
          className="qv-route-map__canvas"
          style={{ width: '100%', height: '100%' }}
          mapId={googleMapsMapId || MAP_ID_DEMO}
          colorScheme={oscuro ? ColorScheme.DARK : ColorScheme.LIGHT}
          defaultCenter={centroInicial}
          defaultZoom={zoomInicial}
          gestureHandling="greedy"
          disableDefaultUI
          zoomControl
          zoomControlOptions={{ position: ControlPosition.RIGHT_BOTTOM }}
          clickableIcons={false}
          tiltInteractionEnabled={false}
          headingInteractionEnabled={false}
          keyboardShortcuts
        >
          <Controlador {...props} oscuro={oscuro} camaraRef={camaraRef} encuadreRef={encuadreRef} onListo={alListo} />
        </GoogleMap>
      </APIProvider>
      {fallo ? (
        <MensajeMapa
          titulo="Mapa no disponible"
          detalle={
            authFallida
              ? 'Google Maps rechazó la clave de API (dominio no autorizado, API no habilitada o facturación inactiva). Revisa la configuración de la clave.'
              : 'No se pudo cargar Google Maps. Revisa la conexión e intenta de nuevo.'
          }
          onReintentar={reintentar}
        />
      ) : (
        (loading || !listo) && (
          <div className="qv-route-map__loading">
            <Loader label="Cargando mapa…" />
          </div>
        )
      )}
    </>,
  );
}

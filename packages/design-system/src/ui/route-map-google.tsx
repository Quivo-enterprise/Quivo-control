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
//   `onUserPan` se dispara con `dragstart` y con `zoom_changed` NO programático: cada vez que
//   este módulo mueve la cámara (fitBounds/panTo/setCenter/setZoom) levanta una bandera que se
//   baja en el siguiente `idle` (o por timeout), para no confundir nuestros movimientos con los
//   del usuario.
//
// Props de `RouteMapProps` que este motor NO soporta todavía (se ignoran sin romper; los usa el
// editor de rutas, que migra último):
// - `MapPoint.draggable` / `MapPoint.onDragEnd`: no hay arrastre de marcadores.
// - `MapRoute.label` se muestra como etiqueta HTML en el punto medio de la ruta (no sigue la
//   curvatura de la línea como el texto de MapLibre) y no hay `line-offset` entre rutas paralelas.
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
import { Loader } from './primitives.js';
import type { RouteMapProps } from './route-map-impl.js';
import { isWithinCentralViewport } from './route-map-geometry.js';
import { latLngAPixelContenedor } from './route-map-proyeccion.js';
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
  DURACION_INTERPOLACION_MS,
  apuntarInterpolacionA,
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

function nodoNumero(id: string): string {
  const m = id.match(/^nodo-(\d+)$/);
  return m ? String(Number(m[1]) + 1) : '';
}

function crearEtiqueta(texto: string, variante: 'stop' | 'marker' | 'route'): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = `qv-gmap-label qv-gmap-label--${variante}`;
  el.textContent = texto;
  return el;
}

/** Marcador de vehículo: mismo badge que los sprites de MapLibre (`buildVehiculoIconoSvg`, forma
 * y color por `estadoFrescura`) + placa debajo. La raíz mide lo que el badge; la placa cuelga. */
function crearElementoVehiculo(punto: MapPoint): HTMLElement {
  const spec =
    VEHICULO_ICONOS.find((s) => s.estado === punto.estadoFrescura) ??
    VEHICULO_ICONOS.find((s) => s.estado === VEHICULO_ICONO_FALLBACK)!;
  const raiz = document.createElement('div');
  raiz.className = `qv-gmap-veh qv-gmap-veh--${spec.estado}`;
  raiz.setAttribute('role', 'button');
  raiz.tabIndex = 0;
  const placa = punto.placa?.trim() ?? '';
  raiz.setAttribute('aria-label', `Vehículo ${placa || punto.label || ''}`.trim());
  if (punto.description) raiz.title = punto.description;
  // El SVG sale de constantes del módulo (sin datos del usuario): innerHTML es seguro acá.
  raiz.innerHTML = buildVehiculoIconoSvg(spec).replace('<svg ', '<svg class="qv-gmap-veh__badge" aria-hidden="true" ');
  if (placa) {
    const etiqueta = document.createElement('span');
    etiqueta.className = 'qv-gmap-veh__placa';
    etiqueta.textContent = placa;
    raiz.appendChild(etiqueta);
  }
  return raiz;
}

/** Punto de control / parada / nodo: círculo con el color del consumidor (admite
 * `var(--qv-*)` tal cual, el navegador lo resuelve) y borde del color de la superficie. */
function crearElementoPunto(
  punto: MapPoint,
  tipo: 'stop' | 'marker',
  rol: 'start' | 'end' | 'stop' | 'marker',
  id: string,
): HTMLElement {
  const pinType = punto.pinType ?? 'pin';
  const raiz = document.createElement('div');
  raiz.className = `qv-gmap-pt qv-gmap-pt--${tipo === 'stop' ? 'parada' : pinType} qv-gmap-pt--rol-${rol}`;
  raiz.style.setProperty('--qv-gmap-pt-color', punto.color?.trim() || 'var(--qv-color-primary)');
  if (punto.description || punto.label) raiz.title = [punto.label, punto.description].filter(Boolean).join(' — ');
  const punta = document.createElement('span');
  punta.className = 'qv-gmap-pt__dot';
  const numero = pinType === 'node' || pinType === 'pulse' ? nodoNumero(id) : '';
  if (numero) punta.textContent = numero;
  raiz.appendChild(punta);
  const etiqueta = punto.label?.trim();
  if (etiqueta) raiz.appendChild(crearEtiqueta(etiqueta, tipo === 'stop' ? 'stop' : 'marker'));
  return raiz;
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
    const escuchas: google.maps.MapsEventListener[] = [
      map.addListener('idle', () => {
        programaticoRef.current = false;
        const centro = map.getCenter();
        const zoom = map.getZoom();
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
    };
  }, [map, camaraRef, actualizarEtiquetasPorZoom]);

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
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;
    const existentes = rutasRef.current;
    const vivos = new Set<string>();
    routes
      .filter((ruta) => ruta.points.length > 1)
      .forEach((ruta: MapRoute, indice) => {
        vivos.add(ruta.id);
        const visuales = routeVisuals(colorParaMapa(ruta.color, oscuro), oscuro);
        const camino = ruta.points.map((p) => ({ lat: p.lat, lng: p.lng }));
        const etiqueta = ruta.label?.trim() ?? '';
        const firma = [oscuro, ruta.color, ruta.dashed, Boolean(ruta.onClick), etiqueta, indice, firmaPuntos(ruta.points)].join('~');
        const previa = existentes.get(ruta.id);
        if (previa?.firma === firma && (!etiqueta || previa.etiqueta || !libMarker)) {
          return;
        }
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
          firma: '',
        };
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
            position: camino[Math.floor(camino.length / 2)],
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

  useEffect(() => {
    if (!map) return;
    const existentes = zonasRef.current;
    const vivos = new Set<string>();
    zones.forEach((zona: MapZone, indice) => {
      if (![zona.lat, zona.lng, zona.radiusMeters].every(Number.isFinite)) return;
      const id = resolvePointId(zona, indice);
      vivos.add(id);
      const color = colorParaMapa(zona.color, oscuro);
      const firma = [oscuro, zona.color, zona.lat, zona.lng, zona.radiusMeters, Boolean(zona.onClick)].join('~');
      const previa = existentes.get(id);
      if (previa?.firma === firma) return;
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
    const duracionMs = animatedRef.current?.intervalMs ?? DURACION_INTERPOLACION_MS;
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
        const contenido = esVehiculo ? crearElementoVehiculo(punto) : crearElementoPunto(punto, tipo, rol, id);
        const entrada: EntradaPunto = {
          id,
          marker: new libMarker.AdvancedMarkerElement({ map, position: posicion, content: contenido, zIndex }),
          firma,
          esVehiculo,
          interp: interpolacionQuieta(posicion),
          ultima: posicion,
          onClick: punto.onClick,
        };
        const activar = () => entrada.onClick?.();
        contenido.addEventListener('click', activar);
        contenido.addEventListener('keydown', (e) => {
          if ((e.key === 'Enter' || e.key === ' ') && entrada.onClick) {
            e.preventDefault();
            entrada.onClick();
          }
        });
        if (punto.onClick) contenido.classList.add('qv-gmap--clickable');
        entradas.set(clave, entrada);
        continue;
      }

      previa.onClick = punto.onClick;
      if (previa.firma !== firma) {
        const contenido = esVehiculo ? crearElementoVehiculo(punto) : crearElementoPunto(punto, tipo, rol, id);
        contenido.addEventListener('click', () => previa.onClick?.());
        contenido.addEventListener('keydown', (e) => {
          if ((e.key === 'Enter' || e.key === ' ') && previa.onClick) {
            e.preventDefault();
            previa.onClick();
          }
        });
        if (punto.onClick) contenido.classList.add('qv-gmap--clickable');
        previa.marker.content = contenido;
        previa.firma = firma;
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
  const firmaLimites = puntosVisibles.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join('|');
  const hayPuntos = firmaLimites !== '';

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
    // `fitBounds` de Google no tiene `maxZoom`: se limita con la opción del mapa mientras dura el
    // encuadre y se libera en el siguiente `idle`.
    map.setOptions({ maxZoom: ZOOM_MAXIMO_ENCUADRE });
    map.fitBounds(limites, PADDING_ENCUADRE_PX);
    google.maps.event.addListenerOnce(map, 'idle', () => map.setOptions({ maxZoom: null }));
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

function MensajeMapa({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <div className="qv-route-map__loading qv-gmap__mensaje" role="alert">
      <strong>{titulo}</strong>
      <span>{detalle}</span>
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

  const contenedor = (hijos: ReactNode) => (
    <div className={cx('qv-route-map', 'qv-gmap', className)} style={{ height }}>
      {hijos}
    </div>
  );

  if (!googleMapsApiKey) {
    return contenedor(
      <MensajeMapa
        titulo="Mapa no disponible"
        detalle="Falta la clave de Google Maps (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) en esta instalación."
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
      <APIProvider apiKey={googleMapsApiKey} language="es" onError={() => setErrorCarga(true)}>
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
          <Controlador {...props} oscuro={oscuro} camaraRef={camaraRef} encuadreRef={encuadreRef} onListo={() => setListo(true)} />
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
        />
      ) : (
        (loading || !listo) && (
          <div className="qv-route-map__loading">
            <Loader label="Cargando mapa..." />
          </div>
        )
      )}
    </>,
  );
}

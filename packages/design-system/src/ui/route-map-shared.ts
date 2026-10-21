// Utilidades PURAS compartidas por los motores de `RouteMap` (MapLibre: `route-map-impl.tsx`;
// Google Maps: `route-map-google.tsx`). Sin imports de mapas ni de React, así se testean en `node`.

// Paleta de marca — mismos valores que `tokens.css` (claro/oscuro). `route.color`/`zone.color`
// pueden venir como `var(--qv-color-primary)` literal (ver `rutas/page.tsx`: `lineaSeleccionada
// ?.color || 'var(--qv-color-primary)'`), y esos tokens CSS nunca se resuelven dentro de una
// expresión de paint de MapLibre (mismo problema que tenían los `pathOptions` de Leaflet) — hay
// que traducirlos a un hex real acá.
export const TOKEN_COLORS: Record<string, { light: string; dark: string }> = {
  '--qv-color-primary': { light: '#3226b4', dark: '#6672f5' },
  '--qv-color-accent': { light: '#fd9e15', dark: '#feb83e' },
  '--qv-color-warning': { light: '#d97706', dark: '#fbbf24' },
};
export const DEFAULT_ROUTE_COLOR_LIGHT = '#3226b4';
export const DEFAULT_ROUTE_COLOR_DARK = '#6672f5';

export function resolveColor(color: string | undefined, isDark: boolean): string {
  const fallback = isDark ? DEFAULT_ROUTE_COLOR_DARK : DEFAULT_ROUTE_COLOR_LIGHT;
  const value = color?.trim();
  if (!value) return fallback;
  const tokenMatch = value.match(/^var\((--[^)]+)\)$/);
  const tokenName = tokenMatch?.[1];
  if (tokenName) {
    const token = TOKEN_COLORS[tokenName];
    return token ? (isDark ? token.dark : token.light) : fallback;
  }
  return value;
}

export function parseHexColor(color: string) {
  const value = color.replace('#', '');
  const expanded =
    value.length === 3
      ? value
          .split('')
          .map((character) => `${character}${character}`)
          .join('')
      : value;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return null;
  return {
    red: Number.parseInt(expanded.slice(0, 2), 16),
    green: Number.parseInt(expanded.slice(2, 4), 16),
    blue: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

export function colorLuminance(color: string) {
  const rgb = parseHexColor(color);
  if (!rgb) return 0.4;
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return channel(rgb.red) * 0.2126 + channel(rgb.green) * 0.7152 + channel(rgb.blue) * 0.0722;
}

export function mixHexColor(color: string, target: '#ffffff' | '#000000', amount: number) {
  const rgb = parseHexColor(color);
  if (!rgb) return color;
  const targetChannel = target === '#ffffff' ? 255 : 0;
  const mix = (value: number) =>
    Math.round(value + (targetChannel - value) * amount)
      .toString(16)
      .padStart(2, '0');
  return `#${mix(rgb.red)}${mix(rgb.green)}${mix(rgb.blue)}`;
}

/** Halo/flecha de contraste para el color de una ruta — mismo cálculo de luminancia relativa
 * que `Quivo-rutas`, para que la línea se lea bien tanto sobre el fondo claro como el oscuro. */
export function routeVisuals(color: string, isDark: boolean) {
  const luminance = colorLuminance(color);
  const stroke = isDark && luminance < 0.22 ? mixHexColor(color, '#ffffff', 0.2) : color;
  const strokeLuminance = colorLuminance(stroke);
  return {
    stroke,
    halo: isDark ? '#0b101b' : strokeLuminance > 0.5 ? '#393345' : '#ffffff',
  };
}

/** Número visible de un nodo del trazado (`nodo-0` => `1`); vacío si el id no es de nodo. */
export function nodeNumberFromId(id: string): string {
  const match = id.match(/^nodo-(\d+)$/);
  return match ? String(Number(match[1]) + 1) : '';
}

/** Mismo id que ve el consumidor cuando lo pasa explícitamente; si no, un id sintético estable
 * mientras el array no cambie de orden — usado para correlacionar clicks/drags de vuelta al
 * objeto original (las funciones `onClick`/`onDragEnd` no viajan dentro del GeoJSON).
 *
 * Exportada (ENTREGA 14) solo para el test `route-map-impl.marker-override.test.ts` — es pura,
 * sin `maplibre-gl`, así que exportarla no cambia el contrato público de `RouteMap`. */
export function resolvePointId(point: { id?: string; lat: number; lng: number }, index: number): string {
  return point.id ?? `${point.lat}:${point.lng}:${index}`;
}

export type EstadoIconoVehiculo = 'reportando' | 'detenido' | 'perdido' | 'finalizado' | 'en_pausa';

export const ICONO_BUS_PATH =
  'M18 11H6V6h12m-1.5 11a1.5 1.5 0 0 1-1.5-1.5a1.5 1.5 0 0 1 1.5-1.5a1.5 1.5 0 0 1 1.5 1.5a1.5 1.5 0 0 1-1.5 1.5m-9 0A1.5 1.5 0 0 1 6 15.5A1.5 1.5 0 0 1 7.5 14A1.5 1.5 0 0 1 9 15.5A1.5 1.5 0 0 1 7.5 17M4 16c0 .88.39 1.67 1 2.22V20a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1h8v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4z';
export const ICONO_BUS_CLOCK_PATH =
  'M16.5 4v4.25l2.86 1.69l-.75 1.22L15 9V4zm-.5 9c1.36 0 2.54-.5 3.5-1.47c1-.97 1.5-2.14 1.5-3.53c0-1.36-.5-2.54-1.5-3.5c-.96-1-2.14-1.5-3.5-1.5c-1.39 0-2.56.5-3.53 1.5C11.5 5.46 11 6.64 11 8c0 1.39.5 2.56 1.47 3.53S14.61 13 16 13m-2.5 6c.44 0 .8-.16 1.08-.46s.42-.65.42-1.04c0-.42-.14-.77-.42-1.07S13.94 16 13.5 16s-.8.13-1.08.43s-.42.65-.42 1.07c0 .39.14.74.42 1.04s.64.46 1.08.46M3 13h8.11C9.7 11.64 9 10 9 8H3zm1.5 6c.44 0 .8-.16 1.08-.46S6 17.89 6 17.5c0-.42-.14-.77-.42-1.07S4.94 16 4.5 16s-.8.13-1.08.43S3 17.08 3 17.5c0 .39.14.74.42 1.04s.64.46 1.08.46M16 1c1.92 0 3.58.67 4.95 2.05C22.33 4.42 23 6.08 23 8c0 1.77-.56 3.29-1.72 4.59c-1.15 1.29-2.58 2.07-4.28 2.32V18c0 .84-.33 1.58-1 2.2V22c0 .27-.11.5-.3.71c-.2.2-.42.29-.7.29h-1c-.27 0-.5-.09-.71-.29A.98.98 0 0 1 13 22v-1H5v1c0 .27-.09.5-.29.71c-.21.2-.44.29-.71.29H3c-.28 0-.5-.09-.7-.29c-.19-.21-.3-.44-.3-.71v-1.8c-.67-.62-1-1.36-1-2.2V8c0-1.58.67-2.65 2.05-3.2C4.42 4.26 6.41 4 9 4h.61c.28 0 .48.03.61.03C11.63 2 13.55 1 16 1';
export const ICONO_BUS_ALERT_PATH =
  'M16 1a7 7 0 0 1 7 7c0 3.53-2.61 6.45-6 6.93V18c0 .84-.35 1.58-1.04 2.2V22c0 .27-.09.5-.28.71c-.18.2-.42.29-.68.29h-1a.98.98 0 0 1-.73-.29a.96.96 0 0 1-.31-.71v-1H5.04v1c0 .27-.1.5-.31.71c-.2.2-.44.29-.73.29H3c-.26 0-.5-.09-.68-.29c-.19-.21-.28-.44-.28-.71v-1.8C1.35 19.58 1 18.84 1 18V8c0-1.58.7-2.65 2.07-3.2C4.44 4.26 6.42 4 9 4l1.23.03A7.01 7.01 0 0 1 16 1m0 2a5 5 0 0 0-5 5a5 5 0 0 0 5 5a5 5 0 0 0 5-5a5 5 0 0 0-5-5m-1 7h2v2h-2zm0-6h2v5h-2zM3 13h8.09A7 7 0 0 1 9 8H3zm1.5 3c-.81 0-1.5.67-1.5 1.5A1.5 1.5 0 0 0 4.5 19c.85 0 1.5-.67 1.5-1.5A1.5 1.5 0 0 0 4.5 16m9 0c-.85 0-1.5.67-1.5 1.5a1.5 1.5 0 0 0 1.5 1.5c.81 0 1.5-.67 1.5-1.5a1.5 1.5 0 0 0-1.5-1.5';

/** mdi:pause — glifo de la pausa del recorrido (almuerzo). */
export const ICONO_PAUSA_PATH = 'M14 19h4V5h-4M6 19h4V5H6z';

export interface VehiculoIconoSpec {
  estado: EstadoIconoVehiculo;
  path: string;
  /** Hex literal, no `var(--qv-color-*)`: la imagen se rasteriza en un `<canvas>` fuera del
   * árbol de React, donde los custom properties del tema no están disponibles — mismo
   * problema que documenta `resolveColor` para `route.color`/`zone.color`. Mismos valores que
   * `tokens.css` (paleta clara): `--qv-color-success`/`--qv-color-info`/`--qv-text-muted`. */
  background: string;
  /** `true` ⇒ contorno punteado con relleno tenue en vez de relleno sólido — la FORMA del
   * badge ya distingue `detenido` de `reportando` antes de leer el color. */
  outline: boolean;
  opacity: number;
}

/**
 * ENTREGA 14 — sprites del vehículo en `/en-vivo`, uno por `estadoFrescura`. Antes, vehículo
 * (radio 11) y punto de control (radio 7) eran el MISMO círculo con 4 px de diferencia —
 * indistinguibles con 26 puntos de control y varios vehículos en pantalla a la vez. Acá la
 * FORMA cambia, no solo el color, para que un vehículo `perdido` se reconozca sin leer texto:
 *
 * - `reportando` — bus sólido (glifo `mdi:bus`), badge verde relleno.
 * - `detenido`   — bus con reloj (glifo `mdi:bus-clock` — "esperando", no una falla), badge
 *   con contorno PUNTEADO en vez de relleno sólido: la forma del borde ya comunica "distinto
 *   de reportando" antes de leer el color.
 * - `perdido`    — bus con alerta (glifo `mdi:bus-alert`), badge gris y atenuado (opacidad
 *   reducida): "esto no es una posición confiable ahora mismo".
 * - `finalizado` — Fase A (docs/plan-ubicacion-fluida.md): bus SÓLIDO liso (mismo glifo
 *   `mdi:bus` que `reportando`, no `bus-alert`: no es una falla) con badge gris de contorno
 *   PUNTEADO — mismo tratamiento de "distinto, informativo, no alarmante" que ya usa
 *   `detenido`, pero en gris/neutro (no cian) para no confundirse con "el teléfono sigue
 *   vivo esperando". El vehículo sigue visible en el mapa, solo que quieto porque el
 *   recorrido terminó bien.
 *
 * `sin_datos` queda afuera a propósito: esa sesión nunca tuvo un fix, así que en
 * `map-builders.ts` ni siquiera llega a ser un marker (`lat`/`lng` `null` ⇒ no se dibuja) —
 * no hace falta un sprite para ese estado.
 *
 * Los glifos son Material Design Icons (`mdi:bus`, `mdi:bus-clock`, `mdi:bus-alert`,
 * licencia Apache-2.0), resueltos vía el MCP `iconify` — no un SVG inventado a mano.
 * `finalizado` reusa el mismo glifo `mdi:bus` que `reportando` (no hizo falta un cuarto).
 */
export const VEHICULO_ICONOS: VehiculoIconoSpec[] = [
  { estado: 'reportando', path: ICONO_BUS_PATH, background: '#16a34a', outline: false, opacity: 1 },
  { estado: 'detenido', path: ICONO_BUS_CLOCK_PATH, background: '#0891b2', outline: true, opacity: 1 },
  { estado: 'perdido', path: ICONO_BUS_ALERT_PATH, background: '#94a3b8', outline: false, opacity: 0.72 },
  // Fase A — mismo gris que `perdido` (`--qv-text-muted` claro) pero glifo LISO (`mdi:bus`,
  // no `bus-alert`) y contorno PUNTEADO (`outline: true`, como `detenido`): la forma dice
  // "no es una falla" antes de leer texto, aunque el color de fondo sea el mismo tono neutro.
  { estado: 'finalizado', path: ICONO_BUS_PATH, background: '#94a3b8', outline: true, opacity: 0.85 },
  // Pausa del recorrido (docs/plan-pausa-recorrido.md): glifo de pausa en ámbar punteado
  // (`--qv-color-warning`), distinto del reloj cian de `detenido`.
  { estado: 'en_pausa', path: ICONO_PAUSA_PATH, background: '#d97706', outline: true, opacity: 1 },
];

export const VEHICULO_ICONO_PX = 64;

/**
 * FIX revisión (Fase A) — sprite de respaldo para cualquier `estadoFrescura` que no tenga
 * ícono propio: vacío (nunca pasa desde `/en-vivo`, ver `construirMarcadoresVehiculos`),
 * `sin_datos` (tampoco pasa — `map-builders.ts` no lo dibuja como marker, ver el comentario
 * de `VEHICULO_ICONOS` más arriba) o un estado nuevo del enum que este archivo todavía no
 * conozca. `detenido` en vez de `reportando`: un estado desconocido no debe leerse como
 * "reportando bien" (verde sólido, afirmación falsa) — el bus con reloj cian punteado ya
 * comunica "distinto, no es una falla" sin afirmar nada que no se sabe.
 */
export const VEHICULO_ICONO_FALLBACK: EstadoIconoVehiculo = 'detenido';

export function buildVehiculoIconoSvg(spec: VehiculoIconoSpec): string {
  const size = VEHICULO_ICONO_PX;
  const center = size / 2;
  const radius = center - 4;
  // `detenido` (hueco/punteado) perdía contraste sobre el mapa base: con `fill-opacity: 0.3`
  // y SIN el halo blanco que sí tienen `reportando`/`perdido` (su `stroke="#ffffff"` de abajo),
  // el badge se mezclaba con cualquier fondo claro o cian del estilo (agua, parques) y con el
  // texto de las calles debajo. El fix agrega un disco blanco opaco de respaldo — el mismo
  // halo de contraste que ya usan los otros dos estados, aplicado ANTES del círculo punteado
  // en vez de como `stroke` (un stroke blanco por fuera del punteado rompería el efecto
  // "hueco") — y sube el relleno cian de 0.3 a 0.55: visible sobre el blanco sin taparlo, la
  // forma sigue siendo la que distingue a `detenido` (punteada) de `reportando` (sólida).
  const badge = spec.outline
    ? `<circle cx="${center}" cy="${center}" r="${radius}" fill="#ffffff"/>` +
      `<circle cx="${center}" cy="${center}" r="${radius}" fill="${spec.background}" fill-opacity="0.55" stroke="${spec.background}" stroke-width="4" stroke-dasharray="7 4"/>`
    : `<circle cx="${center}" cy="${center}" r="${radius}" fill="${spec.background}" stroke="#ffffff" stroke-width="3"/>`;
  // El glifo MDI vive en un viewBox de 24×24 — se centra y escala al ~58% del badge.
  const glyphSize = size * 0.58;
  const glyphOffset = (size - glyphSize) / 2;
  const scale = glyphSize / 24;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${size} ${size}" opacity="${spec.opacity}">${badge}` +
    `<g transform="translate(${glyphOffset} ${glyphOffset}) scale(${scale})">` +
    `<path fill="#ffffff" d="${spec.path}"/></g></svg>`
  );
}

/** Etiqueta en español de cada `estadoFrescura` de un vehículo — mismas palabras que
 * `PRESENTACION_FRESCURA` (`apps/web/src/lib/en-vivo/traza.ts`), que este paquete no puede
 * importar. Se usa para el `aria-label` del marcador (el estado no puede depender solo de la
 * forma/color del badge). */
export const ETIQUETA_FRESCURA: Record<EstadoIconoVehiculo, string> = {
  reportando: 'Reportando',
  detenido: 'Detenido',
  perdido: 'Sin señal',
  finalizado: 'Recorrido finalizado',
  en_pausa: 'En pausa',
};

/** Etiqueta de un `estadoFrescura` cualquiera; vacía si no se conoce (no se inventa un estado). */
export function etiquetaFrescura(estado: string | undefined): string {
  return estado && estado in ETIQUETA_FRESCURA ? ETIQUETA_FRESCURA[estado as EstadoIconoVehiculo] : '';
}

/** Color de texto legible (contraste WCAG) sobre un fondo dado: oscuro si el fondo es claro,
 * blanco si es oscuro. Con un formato que no sea hex (no se puede medir) devuelve blanco. El
 * umbral 0.179 es donde el contraste contra blanco y contra negro se igualan. */
export function colorTextoContraste(fondo: string): '#ffffff' | '#111827' {
  if (!parseHexColor(fondo)) return '#ffffff';
  return colorLuminance(fondo) > 0.179 ? '#111827' : '#ffffff';
}

/**
 * Desplazamiento lateral (px de pantalla) de la ruta `indice` entre `total` rutas dibujables:
 * con varias rutas se reparten de a 4 px alrededor del eje; con una sola no hay desplazamiento.
 * Lo usan ambos motores (`line-offset` de MapLibre y `desplazarCamino` de Google).
 */
export function offsetRutaParalela(indice: number, total: number): number {
  return total > 1 ? (indice - (total - 1) / 2) * 4 : 0;
}

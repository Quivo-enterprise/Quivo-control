import type { StyleProp, ViewStyle } from 'react-native';
import type { ContextoOperativoMovil, PaqueteDia } from '@quivo/shared';

/**
 * Props de `RouteMap` (`route-map.tsx`), el mapa de la ruta activa. Motor único: Google nativo
 * (`react-native-maps` + `PROVIDER_GOOGLE`, ver `docs/adr/0004-motor-mapa-google.md`).
 */
export interface RouteMapProps {
  paquete: PaqueteDia;
  vehiculo: ContextoOperativoMovil['vehiculo'];
  proximoPuntoControlId: string | null;
  posicionActual: { lat: number; lng: number } | null;
  tracking: boolean;
  recenterTick: number;
  /** Ruta real siguiendo calles (OSRM), o `null` si no hay ninguna calculada aún o falló */
  rutaCalculada: [number, number][] | null;
  style?: StyleProp<ViewStyle>;
}

/**
 * Posición que dibuja el mapa. Suma, a `{lat, lng}`, los campos opcionales que produce el store
 * visual (`operacion/movimiento/store-visual.ts`): con un emisor que solo manda `{lat, lng}`
 * (el prop `posicionActual`) el mapa se comporta como antes — sin rumbo, sin halo, sin atenuado.
 * (Antes `PosicionMapaProtocolo`, del protocolo de `postMessage` del WebView.)
 */
export interface PosicionMapa {
  lat: number;
  lng: number;
  /** Grados `[0,360)`, o `null` sin rumbo válido todavía (dibuja un punto sin flecha) — a
   * diferencia de `undefined` (campo ausente: el emisor no sabe nada de rumbo todavía). */
  heading?: number | null;
  /** Metros — radio del halo de precisión. */
  accuracy?: number;
  /** m/s, `-1` si desconocida (mismo centinela que `FixVisual.speed`). */
  speed?: number;
  /** Epoch ms del fix que originó esta posición. */
  ts?: number;
  /** `true` cuando el store visual considera el fix obsoleto (`estaObsoleto`, `movimiento/
   * geo.ts`) — el mapa atenúa el marcador con esto. */
  obsoleto?: boolean;
}

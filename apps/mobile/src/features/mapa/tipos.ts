import type { StyleProp, ViewStyle } from 'react-native';
import type { ContextoOperativoMovil, PaqueteDia } from '@quivo/shared';
import type { EstadoCamara } from './modo-camara';
import type { EmisorRumbo } from './rumbo-mapa';

/** Medidas (dp) de lo que tapa el mapa en navegación: borde inferior de la tarjeta superior y
 * alto que ocupa el sheet VISIBLE (expandido o colapsado) desde abajo (ver `paddingNavegacion`). */
export type InsetsNavegacion = { superior: number; inferior: number };

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
  /** Modo de cámara y su acción puntual (`modo-camara.ts`). El mapa ejecuta la acción cuando
   * cambia `camara.seq`; el modo decide si el marcador mueve la cámara cuadro a cuadro. */
  camara: EstadoCamara;
  /** Un gesto del usuario sobre el mapa (solo lo dispara el usuario, nunca la cámara propia):
   * saca de navegación a libre. */
  onPanUsuario: () => void;
  /** Medidas (dp) de lo que tapa el mapa en navegación, para dejar el vehículo en el tercio
   * inferior de la banda visible (`paddingNavegacion`): borde inferior de la tarjeta superior y
   * alto que ocupa el sheet visible (expandido o colapsado) desde abajo. */
  insetsNavegacion: InsetsNavegacion;
  /** Ruta real siguiendo calles (OSRM), o `null` si no hay ninguna calculada aún o falló */
  rutaCalculada: [number, number][] | null;
  /** Canal por el que el mapa publica el rumbo de su cámara (la brújula de la pantalla se
   * suscribe). Opcional: sin él el mapa funciona igual. */
  emisorRumbo?: EmisorRumbo;
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

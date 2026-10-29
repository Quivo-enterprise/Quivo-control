import type { StyleProp, ViewStyle } from 'react-native';
import type {
  ContextoOperativoMovil,
  PaqueteDia,
  PuntoControlPaquete,
  VueltaActualMovil,
} from '@quivo/shared';
import type { FaseVuelta } from '../operacion/fase-vuelta';
import type { EstadoPuntoVuelta } from '../operacion/progreso-vuelta';
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
  /** Estado de cada punto de control por id (`ordenEfectivoPuntos` → `derivarProgresoEstaticoEnOrden` → `conProximo`, RF-GPS-054): el mapa pinta
   * verdes los pasados y rojos los omitidos. */
  estadosPuntosControl: Readonly<Record<string, EstadoPuntoVuelta>>;
  posicionActual: { lat: number; lng: number } | null;
  tracking: boolean;
  /** Modo de cámara y su acción puntual (`modo-camara.ts`). El mapa ejecuta la acción cuando
   * cambia `camara.seq`; el modo decide si el marcador mueve la cámara cuadro a cuadro. */
  camara: EstadoCamara;
  /** Un gesto del usuario sobre el mapa (solo lo dispara el usuario, nunca la cámara propia):
   * saca de navegación a libre. */
  onPanUsuario: () => void;
  /** Dedo apoyado (`true`) o suelto (`false`) sobre el mapa: el auto-recentrado de `libre` solo corre sin dedo. */
  onToqueMapa?: (activo: boolean) => void;
  /** Medidas (dp) de lo que tapa el mapa en navegación, para dejar el vehículo en el tercio
   * inferior de la banda visible (`paddingNavegacion`): borde inferior de la tarjeta superior y
   * alto que ocupa el sheet visible (expandido o colapsado) desde abajo. */
  insetsNavegacion: InsetsNavegacion;
  /** Ruta real siguiendo calles (OSRM), o `null` si no hay ninguna calculada aún o falló */
  rutaCalculada: [number, number][] | null;
  /** Canal por el que el mapa publica el rumbo de su cámara (la brújula de la pantalla se
   * suscribe). Opcional: sin él el mapa funciona igual. */
  emisorRumbo?: EmisorRumbo;
  /** Designación a Molinos vigente: el mapa resalta su tramo y el PC de espera sobre la ruta base.
   * `null`/ausente = ruta base sola. */
  designacion?: Pick<NonNullable<VueltaActualMovil['designacion']>, 'tramo' | 'puntoEspera'> | null;
  /** Orden efectivo de los PC (`ordenEfectivoPuntos`), ya calculado por `useProgresoVuelta`. */
  ordenEfectivo: readonly PuntoControlPaquete[];
  /** Fase de la vuelta (`useProgresoVuelta`): el mapa dibuja (y ajusta el marcador a) solo la mitad
   * del circuito y los PC de esa fase. `null`/ausente = ruta sin fases, todo como siempre. */
  fase?: FaseVuelta | null;
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

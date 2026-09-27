/**
 * Fase B (`docs/plan-ubicacion-fluida.md`, "núcleo de movimiento"): tipos compartidos por todo
 * el módulo `movimiento/`. Sin ninguna dependencia de React ni del SDK nativo — la conversión
 * desde el tipo `Location` real de Transistorsoft vive en `fix-visual.ts`, no acá, para que
 * estos tipos (y todo lo que los usa: `rumbo.ts`, `geo.ts`, `reducer.ts`) se puedan testear con
 * `vitest` sin tocar `react-native-background-geolocation`.
 */

/** Una coordenada `{lat, lng}` — el orden que usa el resto de este feature (`route-map-
 * protocol.ts`, las props de `RouteMapView`), a diferencia de las tuplas `[lon, lat]` GeoJSON
 * que usa `@quivo/shared` (`haversineMetros`). */
export interface Coordenada {
  lat: number;
  lng: number;
}

/**
 * Fix GPS reducido a los campos que el núcleo de movimiento necesita para decidir rumbo,
 * anti-jitter e interpolación. `fixVisualDesdeLocation` (`fix-visual.ts`) es la única función
 * que construye uno de estos a partir de un `Location` real.
 */
export interface FixVisual extends Coordenada {
  /** Epoch ms del fix. */
  ts: number;
  /** Metros/segundo. `-1` cuando el fix no vino de GPS y el SDK no trae velocidad real — ver
   * `Coords.speed` en el `.d.ts` del SDK: "Only present when location came from GPS. -1
   * otherwise." Nunca un negativo válido en la práctica. */
  speed: number;
  /** Grados `[0,360)`. `-1` en el mismo caso que `speed` (no vino de GPS). */
  heading: number;
  /** Grados. Ausente en el mismo caso que `heading`/`speed` (no vino de GPS) — a diferencia de
   * esos dos campos, el SDK no documenta un centinela numérico para éste, así que se modela
   * como opcional en vez de forzar un `-1` que nadie garantiza. */
  headingAccuracy?: number;
  /** Metros. Precisión horizontal reportada por el fix. */
  accuracy: number;
}

import type { ReactNode } from 'react';

/** Opción genérica para `<Select>` — `label` visible, `value` el string que viaja en el
 * evento de cambio. */
export interface SelectOption {
  label: string;
  value: string;
}

/** Evento sintético que emite `<Select>` (no es un `<select>` nativo — ver `Select.tsx` para
 * el porqué). Expone la misma forma mínima que consume todo `apps/web`: `event.target.value`. */
export interface SelectChangeEvent {
  target: {
    value: string;
  };
}

/** Estados soportados por `<StatusBadge>`. Cubre los seis vocabularios de estado que usa
 * `apps/web` (vehículos, rotaciones, sanciones, reglas...), cada uno mapeado a su propio tono
 * visual en `styles.css`. */
export type StatusBadgeStatus = 'active' | 'inactive' | 'idle' | 'warning' | 'canceled' | 'pending';

/** Variantes de color reutilizadas por `<ProgressBar>`. */
export type ProgressBarVariant = 'primary' | 'success' | 'danger' | 'warning' | 'accent';

export interface ProgressBarProps {
  label?: string;
  value: number;
  max: number;
  variant?: ProgressBarVariant;
  showValue?: boolean;
}

/** Columna de `<DataTable>`. `render`, cuando se pasa, recibe la fila ya tipada como `T` —
 * evita el `implicit any` en los callbacks de `apps/web` (TS7006) sin que el consumidor tenga
 * que anotar nada a mano. */
export interface DataColumn<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
}

export interface MapPoint {
  id?: string;
  lat: number;
  lng: number;
  label?: string;
  description?: string;
  color?: string;
  pinType?: 'pin' | 'stop' | 'pulse' | 'node';
  draggable?: boolean;
  onDragEnd?: (point: { lat: number; lng: number }) => void;
  onClick?: () => void;
  /**
   * ENTREGA 14 (iconografía `/en-vivo`). Solo lo consume `pinType: 'pulse'`: selecciona el
   * sprite del vehículo (`quivo-bus-${estadoFrescura}`, ver `route-map-impl.tsx`) — la FORMA
   * cambia con el estado, no solo el color. String suelto (no `EstadoFrescura` de
   * `@quivo/shared`) a propósito: este paquete no depende de tipos de dominio, mismo criterio
   * que el resto de `RouteMapProps`.
   */
  estadoFrescura?: string;
  /** ENTREGA 14. Placa del vehículo — el texto que se dibuja bajo su ícono/fallback en el
   * mapa (`quivo-vehicle-labels`), para que el mapa se lea sin abrir el detalle de la sesión. */
  placa?: string;
}

/** Polilínea (trazado) que dibuja `<RouteMap>` — una ruta, la traza GPS real, un borrador en
 * edición, etc. */
export interface MapRoute {
  id: string;
  label?: string;
  color?: string;
  dashed?: boolean;
  points: { lat: number; lng: number }[];
  onClick?: () => void;
}

/** Círculo de tolerancia alrededor de un punto de control. Prop `zones` de `RouteMap` — la
 * misma que documenta `docs/handoff.md` como agregada al design system original y perdida
 * junto con el repo. */
export interface MapZone {
  id?: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  label?: string;
  color?: string;
  onClick?: () => void;
}

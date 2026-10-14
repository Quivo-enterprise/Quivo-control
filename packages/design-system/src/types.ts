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
  // ENTREGA 16 — `'vehicle'` reemplaza a `'pulse'` como pinType de los vehículos de `/en-vivo`
  // (ver `route-map-impl.tsx`, capas `quivo-vehicle-*`). `'pulse'` vuelve a su significado
  // original de siempre (nodos/puntos pulsantes del editor de trazado — `rutas/page.tsx`, el
  // punto pendiente arrastrable y el nodo seleccionado — y el demo de la landing): un fix de
  // code-review detectó que la Entrega 14 le había robado `'pulse'` a esos consumidores no
  // vehiculares, dejándolos sin marker visible/clickeable/arrastrable apenas cargaban los
  // sprites del bus (`quivo-vehicle-symbols` pedía una imagen `quivo-bus-` que no existe para
  // ellos).
  pinType?: 'pin' | 'stop' | 'pulse' | 'node' | 'vehicle';
  draggable?: boolean;
  onDragEnd?: (point: { lat: number; lng: number }) => void;
  onClick?: () => void;
  /**
   * ENTREGA 14 (iconografía `/en-vivo`). Solo lo consume `pinType: 'vehicle'`: selecciona el
   * sprite del vehículo (`quivo-bus-${estadoFrescura}`, ver `route-map-impl.tsx`) — la FORMA
   * cambia con el estado, no solo el color. String suelto (no `EstadoFrescura` de
   * `@quivo/shared`) a propósito: este paquete no depende de tipos de dominio, mismo criterio
   * que el resto de `RouteMapProps`. Si viaja vacío/ausente en un `pinType: 'vehicle'`, la capa
   * cae al sprite `reportando` (ver `quivo-vehicle-symbols` en `route-map-impl.tsx`) — nunca
   * pide una imagen `quivo-bus-` inexistente.
   */
  estadoFrescura?: string;
  /** ENTREGA 14. Placa del vehículo — el texto que se dibuja bajo su ícono/fallback en el
   * mapa (`quivo-vehicle-labels`), para que el mapa se lea sin abrir el detalle de la sesión. */
  placa?: string;
  /** PR E (`docs/plan-en-vivo-alertas.md`). Foto del vehículo (solo `pinType: 'vehicle'` en el
   * motor Google): círculo de 44 px. Si falta o falla al cargar, se dibuja el sprite de siempre. */
  fotoUrl?: string;
  /** Color de la línea del vehículo: anillo del marcador. Sin él, el anillo usa el color de marca. */
  colorLinea?: string;
  /** Infracciones del vehículo: `nivel` es el máximo; `abiertas` la cantidad de abiertas y
   * `atendidas` (opcional) las ya atendidas. `parpadea` hace alternar el anillo entre el color
   * de la línea y el de la severidad (periodo por nivel, siempre < 3 Hz; con movimiento reducido
   * queda fijo). Aunque no parpadee, el badge de severidad (ícono distinto por nivel + cantidad
   * de abiertas) se mantiene: con `abiertas: 0` y `atendidas > 0` es el ícono fijo de "ya
   * atendida" (pendiente E #1, docs/plan-molinos-designacion.md). */
  alerta?: { nivel: 'leve' | 'grave' | 'gravisima'; abiertas: number; parpadea: boolean; atendidas?: number };
  /** La vuelta en curso está designada a Molinos: pequeño badge "M" en el marcador (solo motor
   * Google, `pinType: 'vehicle'`). */
  molinos?: boolean;
  /** Vehículo con el panel de detalle abierto: se apila por encima de todos y se resalta. */
  seleccionado?: boolean;
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

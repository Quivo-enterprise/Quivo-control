import {
  normalizarPlacaVehiculo,
  type Conductor,
  type EstadoFrescura,
  type JornadaVehiculo,
  type PosicionEnVivo,
  type Vehiculo,
} from '@quivo/shared';
import type { StatusBadgeStatus } from '@quivo/design-system';
import { estadoDe } from '../en-vivo/atencion';
import { velocidadKmh } from '../en-vivo/alertas';
import { presentacionFrescura } from '../en-vivo/traza';

/** Lógica pura de la vista "Hoy" del celular: búsqueda unificada de placa o conductor. */

export interface ResultadoHoy {
  tipo: 'vehiculo' | 'conductor';
  id: string;
  /** Placa (vehículo) o nombre (conductor). */
  titulo: string;
  detalle: string;
  /** Vehículo: conductor y línea de hoy según la jornada (`null` = sin turno). */
  conductorNombre?: string | null;
  lineaNombre?: string | null;
  /** Teléfono crudo del conductor (vehículo: el de su conductor de hoy); `null` = sin botones. */
  telefono: string | null;
}

export const BUSQUEDA_MIN = 2;
export const BUSQUEDA_MAX_RESULTADOS = 20;

/** Minúsculas sin tildes ni espacios/guiones: "4701 eha" encuentra "4701-EHA". */
export function normalizarBusqueda(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s-]+/g, '');
}

export function buscarHoy(
  consulta: string,
  vehiculos: readonly Vehiculo[],
  conductores: readonly Conductor[],
  jornadas: readonly JornadaVehiculo[],
): { resultados: ResultadoHoy[]; total: number } {
  const q = normalizarBusqueda(consulta);
  if (q.length < BUSQUEDA_MIN) return { resultados: [], total: 0 };
  const qPlaca = normalizarPlacaVehiculo(consulta);

  const conductorDe = new Map(conductores.map((c) => [c.id, c]));
  const jornadaDe = new Map(jornadas.map((j) => [j.vehiculoId, j]));

  const deVehiculos: ResultadoHoy[] = [];
  for (const v of vehiculos) {
    if (qPlaca.length < BUSQUEDA_MIN || !normalizarPlacaVehiculo(v.placa).includes(qPlaca)) continue;
    const j = jornadaDe.get(v.id);
    deVehiculos.push({
      tipo: 'vehiculo',
      id: v.id,
      titulo: v.placa,
      detalle: j ? `${j.lineaNombre}${j.conductorNombre ? ` · ${j.conductorNombre}` : ''}` : 'Sin turno hoy',
      conductorNombre: j?.conductorNombre ?? null,
      lineaNombre: j?.lineaNombre ?? null,
      telefono: (j?.conductorId && conductorDe.get(j.conductorId)?.telefono) || null,
    });
  }
  const deConductores: ResultadoHoy[] = [];
  for (const c of conductores) {
    if (!normalizarBusqueda(c.nombre).includes(q)) continue;
    deConductores.push({ tipo: 'conductor', id: c.id, titulo: c.nombre, detalle: 'Conductor', telefono: c.telefono });
  }

  // Al truncar, hasta la mitad por tipo y el resto lo llena el otro: los vehículos no desplazan a los conductores.
  const nVeh = Math.min(deVehiculos.length, Math.max(BUSQUEDA_MAX_RESULTADOS / 2, BUSQUEDA_MAX_RESULTADOS - deConductores.length));
  const nCond = Math.min(deConductores.length, BUSQUEDA_MAX_RESULTADOS - nVeh);
  return {
    resultados: [...deVehiculos.slice(0, nVeh), ...deConductores.slice(0, nCond)],
    total: deVehiculos.length + deConductores.length,
  };
}

/** "Mié 5 nov" en hora de La Paz (el servidor y el celular pueden estar en otra zona). */
export function fechaHoy(ahora: Date = new Date()): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('es-BO', { timeZone: 'America/La_Paz', weekday: 'short', day: 'numeric', month: 'short' })
      .formatToParts(ahora)
      .map((x) => [x.type, x.value.replaceAll('.', '')]),
  );
  return `${p.weekday!.charAt(0).toUpperCase()}${p.weekday!.slice(1)} ${p.day} ${p.month}`;
}

/** Forma del `StatusBadge` por estado: círculo ok, rombo aviso, cuadrado falla, hueco neutro. */
export const INSIGNIA: Record<EstadoFrescura, StatusBadgeStatus> = {
  reportando: 'active',
  detenido: 'idle',
  en_pausa: 'warning',
  perdido: 'canceled',
  finalizado: 'inactive',
  inactivo: 'inactive',
  sin_datos: 'inactive',
};

/** Velocidad para mostrar junto al estado: solo con el vehículo reportando (parado o sin señal, el último valor engaña). */
export function kmhSiReportando(estado: EstadoFrescura, kmh: number | null): number | null {
  return estado === 'reportando' ? kmh : null;
}

/** Sesión de hoy del vehículo; con varias (dos teléfonos) gana la del último fix. */
export function posicionDeVehiculo(posiciones: readonly PosicionEnVivo[], vehiculoId: string): PosicionEnVivo | undefined {
  let mejor: PosicionEnVivo | undefined;
  for (const p of posiciones) {
    if (p.vehiculoId !== vehiculoId) continue;
    if (!mejor || (p.ultimoFixTs ?? '') > (mejor.ultimoFixTs ?? '')) mejor = p;
  }
  return mejor;
}

/** "hace 4 s" / "hace 3 min" / "hace 2 h"; `null` si no hay fix. */
export function haceCorto(ms: number | null): string | null {
  if (ms === null) return null;
  const s = Math.floor(Math.max(0, ms) / 1000);
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  return `hace ${Math.floor(s / 3600)} h`;
}

export interface EstadoVehiculoHoy {
  insignia: StatusBadgeStatus;
  etiqueta: string;
  kmh: number | null;
  vuelta: number | null;
  linea: string;
}

/** Datos de la tarjeta de resultado. La velocidad solo se muestra en vivo: un vehículo perdido/pausado/finalizado no lleva cifra. */
export function estadoVehiculoHoy(p: PosicionEnVivo): EstadoVehiculoHoy {
  const estado = estadoDe(p);
  return {
    insignia: INSIGNIA[estado],
    etiqueta: presentacionFrescura(estado).etiqueta,
    kmh: kmhSiReportando(estado, velocidadKmh(p.speed)),
    vuelta: p.vuelta?.numero ?? null,
    linea: p.lineaNombre,
  };
}

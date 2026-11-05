import { normalizarPlacaVehiculo, type Conductor, type JornadaVehiculo, type Vehiculo } from '@quivo/shared';

/** Lógica pura de la vista "Hoy" del celular: búsqueda unificada de placa o conductor. */

export interface ResultadoHoy {
  tipo: 'vehiculo' | 'conductor';
  id: string;
  /** Placa (vehículo) o nombre (conductor). */
  titulo: string;
  detalle: string;
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

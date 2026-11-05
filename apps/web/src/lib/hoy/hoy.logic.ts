import type { Conductor, JornadaVehiculo, Vehiculo } from '@quivo/shared';

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
): ResultadoHoy[] {
  const q = normalizarBusqueda(consulta);
  if (q.length < BUSQUEDA_MIN) return [];

  // El teléfono del conductor de hoy se cruza por nombre solo si es inequívoco (un único conductor con ese nombre).
  const porNombre = new Map<string, Conductor[]>();
  for (const c of conductores) {
    const k = normalizarBusqueda(c.nombre);
    porNombre.set(k, [...(porNombre.get(k) ?? []), c]);
  }
  const jornadaDe = new Map(jornadas.map((j) => [j.vehiculoId, j]));

  const resultados: ResultadoHoy[] = [];
  for (const v of vehiculos) {
    if (!normalizarBusqueda(v.placa).includes(q)) continue;
    const j = jornadaDe.get(v.id);
    const cands = j?.conductorNombre ? porNombre.get(normalizarBusqueda(j.conductorNombre)) : undefined;
    resultados.push({
      tipo: 'vehiculo',
      id: v.id,
      titulo: v.placa,
      detalle: j ? `${j.lineaNombre}${j.conductorNombre ? ` · ${j.conductorNombre}` : ''}` : 'Sin turno hoy',
      telefono: cands?.length === 1 ? (cands[0]?.telefono ?? null) : null,
    });
  }
  for (const c of conductores) {
    if (!normalizarBusqueda(c.nombre).includes(q)) continue;
    resultados.push({ tipo: 'conductor', id: c.id, titulo: c.nombre, detalle: 'Conductor', telefono: c.telefono });
  }
  return resultados.slice(0, BUSQUEDA_MAX_RESULTADOS);
}

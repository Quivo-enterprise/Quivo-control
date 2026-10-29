import type { Infraccion } from './entities/infraccion.js';

// Textos y regla de la sanción nacida de una infracción: los usan la API (deriva el hecho en el
// servidor) y la web (resumen de solo lectura del modal).

const ETIQUETA_TIPO_INFRACCION: Record<Infraccion['tipo'], string> = {
  desvio_ruta: 'Alteración de ruta',
  pc_omitido: 'Punto de control omitido',
  molinos_omitido: 'Molinos omitido',
  espera_corta: 'Espera corta en Molinos',
};

export function etiquetaTipoInfraccion(tipo: Infraccion['tipo']): string {
  return ETIQUETA_TIPO_INFRACCION[tipo];
}

function numero(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
}

/** "a 180 m de la ruta" (desvío) / "PC 3 omitido". El número del PC es su posición en la lista
 * del recorrido (`idsPuntosControl`, la misma que el mapa y el panel) y, si no se conoce, `orden + 1`. */
export function detalleInfraccion(
  i: Pick<Infraccion, 'tipo' | 'detalle'>,
  idsPuntosControl: readonly string[] = [],
): string {
  if (i.tipo === 'desvio_ruta') {
    const m = numero(i.detalle.distanciaMaxM);
    return m === null ? 'fuera de la ruta' : `a ${Math.round(m)} m de la ruta`;
  }
  if (i.tipo === 'molinos_omitido') return 'cerró la vuelta sin pasar por Molinos';
  if (i.tipo === 'espera_corta') {
    const esperado = numero(i.detalle.esperaMin);
    const requerido = numero(i.detalle.requeridoMin);
    return esperado !== null && requerido !== null
      ? `esperó ${esperado} de ${requerido} min en Molinos`
      : 'salió de Molinos antes de tiempo';
  }
  const posicion = typeof i.detalle.puntoControlId === 'string' ? idsPuntosControl.indexOf(i.detalle.puntoControlId) : -1;
  const orden = posicion >= 0 ? posicion : numero(i.detalle.orden);
  const nombre = typeof i.detalle.nombre === 'string' && i.detalle.nombre.trim() ? i.detalle.nombre.trim() : null;
  const base = orden === null ? 'PC omitido' : `PC ${orden + 1} omitido`;
  return nombre ? `${base} (${nombre})` : base;
}

/** Motivo de la sanción nacida de una infracción. La hora va en Bolivia: el servidor corre en UTC. */
export function motivoSancion(i: Pick<Infraccion, 'tipo' | 'detalle' | 'inicioTs'>, placa?: string, idsPuntosControl: readonly string[] = []): string {
  const hora = i.inicioTs.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/La_Paz' });
  return `${etiquetaTipoInfraccion(i.tipo)}${placa ? ` del vehículo ${placa}` : ''}: ${detalleInfraccion(i, idsPuntosControl)} (${hora}).`;
}

/** Regla preseleccionada de la sanción: la de la infracción si sigue activa; si no, la regla activa
 * del mismo tipo (las infracciones previas a la regla no tienen `reglaId`); si no, la de "Alteración
 * de ruta". Sin ninguna, `undefined`: el admin la elige (no se asume la primera). */
export function reglaInicialSancion(
  inf: Pick<Infraccion, 'reglaId' | 'tipo'>,
  reglasActivas: { id: string; tipo: string }[],
): string | undefined {
  if (inf.reglaId && reglasActivas.some((r) => r.id === inf.reglaId)) return inf.reglaId;
  const delMismoTipo = reglasActivas.find((r) => r.tipo === inf.tipo);
  // Solo desvío y Molinos caen a la regla de desvío; un PC omitido sin su regla no preselecciona la grave.
  const cae = inf.tipo === 'desvio_ruta' || inf.tipo === 'molinos_omitido';
  return (delMismoTipo ?? (cae ? reglasActivas.find((r) => r.tipo === 'desvio_ruta') : undefined))?.id;
}

/** Día calendario `YYYY-MM-DD` sumando `dias` y `meses` (UTC puro, sin zona). El día se recorta al
 * fin del mes destino (31/01 + 1 mes = 28/02). */
function sumarFecha(ymd: string, dias: number, meses: number): string {
  const [a, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const destino = new Date(Date.UTC(a, m - 1 + meses, 1));
  const finMes = new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0)).getUTCDate();
  destino.setUTCDate(Math.min(d, finMes) + dias);
  return destino.toISOString().slice(0, 10);
}

/** Rango permitido para el día de cumplimiento de una sanción compensatoria, dado el día de hoy en
 * Bolivia (`YYYY-MM-DD`): de mañana a hoy + 1 mes calendario. */
export function rangoCumplimiento(hoy: string): { min: string; max: string } {
  return { min: sumarFecha(hoy, 1, 0), max: sumarFecha(hoy, 0, 1) };
}

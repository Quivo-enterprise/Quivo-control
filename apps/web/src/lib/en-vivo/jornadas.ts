import { fechaActualBolivia } from '@quivo/shared';
import type { EstadoJornada, JornadaVehiculo } from '@quivo/shared';

/**
 * Lógica pura del panel "Jornada de hoy" de `/en-vivo` (release 13): filtrar por línea,
 * agrupar por estado, ordenar y contar. Sin React ni reloj implícito — todo lo que depende
 * de "ahora" recibe el instante por parámetro, para testearlo sin fake timers.
 */

/**
 * Orden de los grupos. "Sin iniciar" va primero porque es lo accionable para el delegado
 * (a quién llamar); después los que ya están trabajando y, al final, los que terminaron.
 */
export const ORDEN_ESTADOS: readonly EstadoJornada[] = [
  'sin_iniciar',
  'dia_iniciado',
  'en_recorrido',
  'finalizado',
];

export const ETIQUETA_ESTADO: Record<EstadoJornada, string> = {
  sin_iniciar: 'Sin iniciar',
  dia_iniciado: 'Día iniciado',
  en_recorrido: 'En recorrido',
  finalizado: 'Finalizado',
};

export interface GrupoJornada {
  estado: EstadoJornada;
  etiqueta: string;
  vehiculos: JornadaVehiculo[];
}

export interface ResumenJornadas {
  total: number;
  /** Todo el que no está en `sin_iniciar`: declaró el día, está en ruta o ya terminó. */
  iniciaron: number;
  sinIniciar: number;
  enRecorrido: number;
}

export interface JornadasAgrupadas {
  /** Solo grupos con al menos un vehículo, en `ORDEN_ESTADOS`. */
  grupos: GrupoJornada[];
  resumen: ResumenJornadas;
}

/** Epoch ms de un ISO; `null` (o ilegible) va al final de cualquier orden ascendente. */
function msOInfinito(iso: string | null): number {
  if (iso === null) return Number.POSITIVE_INFINITY;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/** Comparación ascendente tolerante a `Infinity` (`Infinity - Infinity` sería NaN). */
function compararMs(a: number, b: number): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function compararVehiculos(a: JornadaVehiculo, b: JornadaVehiculo): number {
  // Los que aún no iniciaron se ordenan por la hora de salida que les toca (los más
  // urgentes primero); el resto, por cuándo declararon el día. Un `en_recorrido` puede no
  // tener declaración (el recorrido manda sobre ella): cae al final de su grupo.
  const clave =
    a.estado === 'sin_iniciar'
      ? compararMs(msOInfinito(a.horaSalida), msOInfinito(b.horaSalida))
      : compararMs(msOInfinito(a.inicioJornadaTs), msOInfinito(b.inicioJornadaTs));
  if (clave !== 0) return clave;
  return a.placa.localeCompare(b.placa, 'es');
}

/**
 * Filtra por línea (`''` = todas), agrupa por estado y cuenta. El resumen respeta el filtro:
 * lo que dice el panel plegado es lo mismo que el mapa está mostrando.
 *
 * Limitación conocida (viene del API, no se corrige acá): `GET /reportes/jornadas` devuelve
 * UNA fila por vehículo (`SELECT DISTINCT ON (vehiculoId)` en `jornadas.service.ts`, ordenado
 * por `horaSalida ASC NULLS LAST, orden ASC`), con la línea de su turno más temprano del día.
 * Un vehículo que trabaja dos líneas el mismo día solo aparece bajo el filtro de la primera.
 */
export function agruparJornadas(
  vehiculos: readonly JornadaVehiculo[],
  lineaId: string,
): JornadasAgrupadas {
  // Una sola pasada: filtra y reparte en cubetas por estado.
  const cubetas: Record<EstadoJornada, JornadaVehiculo[]> = {
    sin_iniciar: [],
    dia_iniciado: [],
    en_recorrido: [],
    finalizado: [],
  };
  let total = 0;
  for (const v of vehiculos) {
    if (lineaId && v.lineaId !== lineaId) continue;
    cubetas[v.estado].push(v);
    total += 1;
  }

  const grupos: GrupoJornada[] = [];
  for (const estado of ORDEN_ESTADOS) {
    const lista = cubetas[estado];
    if (lista.length === 0) continue;
    grupos.push({ estado, etiqueta: ETIQUETA_ESTADO[estado], vehiculos: lista.sort(compararVehiculos) });
  }

  const sinIniciar = cubetas.sin_iniciar.length;
  return {
    grupos,
    resumen: {
      total,
      iniciaron: total - sinIniciar,
      sinIniciar,
      enRecorrido: cubetas.en_recorrido.length,
    },
  };
}

/** Texto del resumen del panel plegado: `8 iniciaron · 3 sin iniciar · 2 en recorrido`. */
export function textoResumen(r: ResumenJornadas): string {
  if (r.total === 0) return 'Sin vehículos asignados';
  return `${r.iniciaron} iniciaron · ${r.sinIniciar} sin iniciar · ${r.enRecorrido} en recorrido`;
}

const FORMATO_HORA = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/La_Paz',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** `HH:MM` en hora de Bolivia (IANA, sin offsets a mano); `—` si no hay hora válida. */
export function formatearHoraBolivia(iso: string | null): string {
  if (iso === null) return '—';
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? '—' : FORMATO_HORA.format(ms);
}

/**
 * Antigüedad gruesa para el panel (`hace 2 h 05 min`). Distinta de `formatearAntiguedad`
 * (traza.ts), que llega a segundos: acá la fuente se refresca cada 30 s y un contador de
 * segundos sería ruido. Un instante futuro (reloj del navegador atrasado respecto del
 * servidor) se trata como "hace instantes" en vez de mostrar un número negativo.
 */
export function formatearHace(iso: string | null, ahoraMs: number): string {
  if (iso === null) return '—';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  const minutos = Math.floor(Math.max(0, ahoraMs - ms) / 60_000);
  if (minutos < 1) return 'hace instantes';
  if (minutos < 60) return `hace ${minutos} min`;
  return `hace ${Math.floor(minutos / 60)} h ${String(minutos % 60).padStart(2, '0')} min`;
}

/**
 * Línea de tiempo de una fila: solo texto, el estado ya lo dice el encabezado del grupo.
 * Devuelve el texto y si va atenuado (información que falta, no un dato).
 * - `sin_iniciar`: la hora de salida que le toca, si la hay.
 * - `finalizado`: solo "Empezó HH:MM"; el servidor no manda la hora de fin, así que un
 *   "hace X" mentiría (parecería cuánto lleva terminado).
 * - `en_recorrido` sin declaración: el recorrido manda sobre la declaración, pero el
 *   delegado debe saber que no declaró el día.
 */
export function lineaTiempo(
  v: Pick<JornadaVehiculo, 'estado' | 'horaSalida' | 'inicioJornadaTs'>,
  ahoraMs: number,
): { texto: string; atenuado: boolean } | null {
  if (v.estado === 'sin_iniciar') {
    return v.horaSalida ? { texto: `Sale ${formatearHoraBolivia(v.horaSalida)}`, atenuado: false } : null;
  }
  if (!v.inicioJornadaTs) {
    return v.estado === 'en_recorrido'
      ? { texto: 'En recorrido sin declarar el día', atenuado: true }
      : null;
  }
  const empezo = `Empezó ${formatearHoraBolivia(v.inicioJornadaTs)}`;
  if (v.estado === 'finalizado') return { texto: empezo, atenuado: false };
  return { texto: `${empezo} · ${formatearHace(v.inicioJornadaTs, ahoraMs)}`, atenuado: false };
}

/**
 * La `fecha` (YYYY-MM-DD) de la respuesta solo merece mostrarse si NO es la jornada boliviana
 * de hoy — p. ej. pestaña abierta durante el cambio de día con datos del anterior. Devuelve
 * `null` cuando coincide (caso normal: no se muestra nada).
 */
export function fechaSiDifiereDeHoy(fecha: string, ahoraMs: number): string | null {
  const hoy = fechaActualBolivia(new Date(ahoraMs)).toISOString().slice(0, 10);
  return fecha === hoy ? null : fecha;
}

import type { FilaSalidaPanelItem, FrecuenciaRegla, GrupoVehiculo } from '@quivo/shared';

/** `HH:mm` → minutos del día (0–1439); `null` si el texto no es una hora válida. */
export function horaAMinutos(texto: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(texto.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Minutos del día → `HH:mm`. */
export function minutosAHora(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Diferencia reloj-servidor − reloj-navegador, medida al recibir la respuesta. */
export function offsetServidorMs(servidorTs: string, recibidoEnMs: number): number {
  return Date.parse(servidorTs) - recibidoEnMs;
}

/** Milisegundos que faltan para `etaTs` según el reloj del servidor (negativo = ya pasó). */
export function restanteMs(etaTs: string, offsetMs: number, ahoraMs: number): number {
  return Date.parse(etaTs) - (ahoraMs + offsetMs);
}

/** `m:ss` (o `h:mm:ss`); si ya venció, `+m:ss` de demora. */
export function formatearCuenta(restante: number): string {
  const total = Math.floor(Math.abs(restante) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const cuerpo =
    h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  return restante < 0 ? `+${cuerpo}` : cuerpo;
}

export type EstadoVisualFila = 'en_turno' | 'demorado' | 'esperando';

/** Demorado (primero y ya pasó su hora) > en turno (habilitado a salir) > esperando. */
export function estadoVisualFila(item: Pick<FilaSalidaPanelItem, 'demorado' | 'habilitado'>): EstadoVisualFila {
  if (item.demorado) return 'demorado';
  return item.habilitado ? 'en_turno' : 'esperando';
}

export const ETIQUETA_ESTADO_FILA: Record<EstadoVisualFila, string> = {
  en_turno: 'En turno',
  demorado: 'Demorado',
  esperando: 'Esperando',
};

/** Franja de una regla: "08:00–10:30" o "Todo el día". */
export function textoFranja(desdeMin: number | null, hastaMin: number | null): string {
  if (desdeMin === null || hastaMin === null) return 'Todo el día';
  return `${minutosAHora(desdeMin)}–${minutosAHora(hastaMin)}`;
}

/** Alcance de una regla: "Todos los trufis", "Grupo X" o "Trufi ABC123". */
export function textoAlcance(
  regla: Pick<FrecuenciaRegla, 'alcance' | 'grupoId' | 'vehiculoId'>,
  grupos: Pick<GrupoVehiculo, 'id' | 'nombre'>[],
  placaPorVehiculo: Record<string, string>,
): string {
  if (regla.alcance === 'todos') return 'Todos los trufis';
  if (regla.alcance === 'grupo') {
    return `Grupo ${grupos.find((g) => g.id === regla.grupoId)?.nombre ?? '(no visible)'}`;
  }
  return `Trufi ${placaPorVehiculo[regla.vehiculoId ?? ''] ?? '(sin placa)'}`;
}

export const ETIQUETA_ORIGEN: Record<string, string> = {
  boton: 'Botón del conductor',
  geocerca: 'Salió de la zona',
  deteccion: 'Detectada',
  panel: 'Panel',
};

/** Fin del día como `hastaMin` de una franja (el schema admite hasta 1440). */
export const FIN_DEL_DIA_MIN = 1440;

/** `YYYY-MM-DD` → `DD/MM` (string puro: un `Date` de fecha sola se corre de día por zona horaria). */
export function fechaCorta(fecha: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(fecha);
  return m ? `${m[2]}/${m[1]}` : fecha;
}

/** `hastaMin` del formulario: fin del día (1440) si el checkbox está marcado; si no, la hora o `null`. */
export function hastaMinDeFormulario(hasta: string, hastaFinDelDia: boolean): number | null {
  if (hastaFinDelDia) return FIN_DEL_DIA_MIN;
  return hasta ? horaAMinutos(hasta) : null;
}

/** Mapea los issues de zod por `path` (no por texto) a un mensaje por campo del formulario de regla. */
export function mensajesReglaPorCampo(
  issues: { path: PropertyKey[] }[],
  entrada: { alcance: 'todos' | 'grupo' | 'vehiculo'; desdeMin: number | null; hastaMin: number | null },
  limites: { min: number; max: number },
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const campo = String(issue.path[0] ?? 'alcance');
    if (out[campo] || (campo === 'alcance' && (out.grupoId || out.vehiculoId))) continue;
    if (campo === 'minutos') {
      out.minutos = `Ingresá minutos enteros de ${limites.min} a ${limites.max}.`;
    } else if (campo === 'hastaMin') {
      // Un solo path para dos errores: con ambos extremos presentes solo puede ser el rango invertido.
      out.hastaMin =
        entrada.desdeMin !== null && entrada.hastaMin !== null
          ? '"Hasta" tiene que ser posterior a "Desde".'
          : 'Completá "Desde" y "Hasta", o dejá ambos vacíos.';
    } else if (campo === 'alcance') {
      if (entrada.alcance === 'grupo') out.grupoId = 'Elegí un grupo.';
      else if (entrada.alcance === 'vehiculo') out.vehiculoId = 'Elegí un trufi.';
      else out.alcance = 'Alcance inválido.';
    } else {
      out[campo] = 'Valor inválido.';
    }
  }
  return out;
}

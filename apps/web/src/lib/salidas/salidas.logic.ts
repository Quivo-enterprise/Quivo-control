import type { FilaSalidaPanelItem, FrecuenciaRegla, GrupoVehiculo } from '@quivo/shared';

/** Bolivia es UTC-4 todo el año, sin horario de verano (misma regla que `packages/shared/src/tiempo/jornada.ts`). */
const OFFSET_BOLIVIA_MS = -4 * 60 * 60 * 1000;

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

/** Hora local de Bolivia (`HH:mm`) de un instante ISO; `—` si no parsea. */
export function horaLocalBolivia(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  const d = new Date(ms + OFFSET_BOLIVIA_MS);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
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

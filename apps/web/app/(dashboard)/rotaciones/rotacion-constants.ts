import type { CSSProperties } from 'react';
import type { Turno } from '@quivo/shared';

export const HORARIOS: { label: string; value: Turno }[] = [
  { label: 'Mañana', value: 'manana' },
  { label: 'Tarde', value: 'tarde' },
  { label: 'Noche', value: 'noche' },
];

export const celdaEncabezado: CSSProperties = {
  textAlign: 'left',
  padding: '0.5rem',
  borderBottom: '2px solid var(--qv-color-border, #ddd)',
  whiteSpace: 'nowrap',
};

export const celdaCuerpo: CSSProperties = {
  padding: '0.5rem',
  borderBottom: '1px solid var(--qv-color-border, #eee)',
  whiteSpace: 'nowrap',
};

export function etiquetaHorario(horario: Turno): string {
  return HORARIOS.find((h) => h.value === horario)?.label ?? horario;
}

/** Rango inclusivo día a día — el doc técnico no especifica el formato de selección de
 * fechas para generar una rotación, así que "desde/hasta" con todos los días intermedios
 * es una asunción razonable de este equipo. */
export function rangoDeFechas(desde: string, hasta: string): Date[] {
  const fechas: Date[] = [];
  const cursor = new Date(`${desde}T00:00:00Z`);
  const fin = new Date(`${hasta}T00:00:00Z`);
  while (cursor.getTime() <= fin.getTime()) {
    fechas.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return fechas;
}

import type { AgrupacionActividad, EstadoSancion, SujetoTipo } from '@quivo/shared';
import { apiDownload } from './client';

interface RangoFechas {
  desde?: string;
  hasta?: string;
}

function aQueryString(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) usp.set(key, value);
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
}

function comoRecord<T extends object>(valor: T): Record<string, string | undefined> {
  return valor as Record<string, string | undefined>;
}

export const exportesApi = {
  recorridos: (token: string, filtros: RangoFechas) =>
    apiDownload(
      `/reportes/exportar/recorridos${aQueryString(comoRecord(filtros))}`,
      token,
      'recorridos.csv',
    ),
  sanciones: (
    token: string,
    filtros: RangoFechas & { estado?: EstadoSancion; sujetoTipo?: SujetoTipo },
  ) =>
    apiDownload(
      `/reportes/exportar/sanciones${aQueryString(comoRecord(filtros))}`,
      token,
      'sanciones.csv',
    ),
  actividad: (token: string, filtros: RangoFechas & { por: AgrupacionActividad }) =>
    apiDownload(
      `/reportes/exportar/actividad${aQueryString(comoRecord(filtros))}`,
      token,
      'actividad.csv',
    ),
};

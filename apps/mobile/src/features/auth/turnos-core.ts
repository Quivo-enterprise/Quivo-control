type AsignacionConHora = {
  id: string;
  horaSalida?: string | null;
};

export type IconoTurno = 'sunny' | 'partly-sunny' | 'moon';

function horaSalidaMs(asignacion: AsignacionConHora): number | null {
  if (!asignacion.horaSalida) return null;
  const timestamp = Date.parse(asignacion.horaSalida);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function ordenarAsignaciones<T extends AsignacionConHora>(asignaciones: readonly T[]): T[] {
  return [...asignaciones].sort((a, b) => {
    const horaA = horaSalidaMs(a);
    const horaB = horaSalidaMs(b);
    if (horaA === null) return horaB === null ? 0 : 1;
    if (horaB === null) return -1;
    return horaA - horaB;
  });
}

export function buscarProximaAsignacion<T extends AsignacionConHora>(
  asignaciones: readonly T[],
  ahora: number,
): string | null {
  const siguientes = asignaciones.filter((asignacion) => {
    const hora = horaSalidaMs(asignacion);
    return hora !== null && hora >= ahora;
  });
  return siguientes.sort((a, b) => horaSalidaMs(a)! - horaSalidaMs(b)!)[0]?.id ?? null;
}

export function formatearTiempoRelativo(
  horaSalida: string | null | undefined,
  ahora: number,
): string | null {
  if (!horaSalida) return null;
  const timestamp = Date.parse(horaSalida);
  if (!Number.isFinite(timestamp)) return null;

  const minutos = Math.floor(Math.abs(timestamp - ahora) / 60_000);
  const horas = Math.floor(minutos / 60);
  const minutosRestantes = minutos % 60;
  const tiempo = [horas ? `${horas} h` : null, minutosRestantes ? `${minutosRestantes} min` : null]
    .filter(Boolean)
    .join(' ');
  const cantidad = tiempo || 'menos de 1 min';
  return timestamp > ahora ? `en ${cantidad}` : `hace ${cantidad}`;
}

export function formatearTiempoRelativoAccesible(
  horaSalida: string | null | undefined,
  ahora: number,
): string | null {
  if (!horaSalida) return null;
  const timestamp = Date.parse(horaSalida);
  if (!Number.isFinite(timestamp)) return null;

  const minutos = Math.floor(Math.abs(timestamp - ahora) / 60_000);
  const horas = Math.floor(minutos / 60);
  const minutosRestantes = minutos % 60;
  const partes = [
    horas ? `${horas} ${horas === 1 ? 'hora' : 'horas'}` : null,
    minutosRestantes
      ? `${minutosRestantes} ${minutosRestantes === 1 ? 'minuto' : 'minutos'}`
      : null,
  ].filter(Boolean);
  const tiempo = partes.join(' ') || 'menos de un minuto';
  return timestamp > ahora ? `en ${tiempo}` : `hace ${tiempo}`;
}

export function resolverIconoTurno(turno: 'manana' | 'tarde' | 'noche'): IconoTurno {
  const iconos: Record<'manana' | 'tarde' | 'noche', IconoTurno> = {
    manana: 'sunny',
    tarde: 'partly-sunny',
    noche: 'moon',
  };
  return iconos[turno];
}

export function resolverNombreLinea(codigo: string, nombre: string): string | null {
  const nombreNormalizado = nombre.trim();
  const codigoNormalizado = codigo.trim();
  const nombreSinPrefijo = nombreNormalizado.replace(/^línea\s+/i, '');
  return nombreSinPrefijo.toLocaleLowerCase('es-BO') ===
    codigoNormalizado.toLocaleLowerCase('es-BO')
    ? null
    : nombreNormalizado;
}

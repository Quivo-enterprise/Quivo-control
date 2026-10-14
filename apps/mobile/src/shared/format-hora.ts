/** Formatea un instante ISO en la hora local operativa de Bolivia. */
export function formatHoraBolivia(value: string | null | undefined): string | null {
  if (!value) return null;

  const fecha = new Date(value);
  if (Number.isNaN(fecha.getTime())) return null;

  return new Intl.DateTimeFormat('es-BO', {
    timeZone: 'America/La_Paz',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(fecha);
}

/** `14/10/2026 09:05` en hora de Bolivia, o `null` si la fecha no parsea. */
export function formatFechaHoraBolivia(value: string | null | undefined): string | null {
  if (!value) return null;

  const fecha = new Date(value);
  if (Number.isNaN(fecha.getTime())) return null;

  const partes = new Intl.DateTimeFormat('es-BO', {
    timeZone: 'America/La_Paz',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(fecha);
  const parte = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === tipo)?.value ?? '';
  // Algunos ICU devuelven "24" para la medianoche con hour12:false.
  const hora = parte('hour') === '24' ? '00' : parte('hour');
  return `${parte('day')}/${parte('month')}/${parte('year')} ${hora}:${parte('minute')}`;
}

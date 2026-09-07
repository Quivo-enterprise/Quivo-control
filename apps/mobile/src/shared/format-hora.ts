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

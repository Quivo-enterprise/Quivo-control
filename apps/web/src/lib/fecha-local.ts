/**
 * Fechas "solo día" (`YYYY-MM-DD`, el formato del `DatePicker`) de los formularios.
 *
 * `new Date('2026-10-12')` es medianoche UTC: en Bolivia (UTC-4) es el 11 por la tarde. Se
 * interpreta como día LOCAL y se fija al mediodía local, así el mismo día se ve igual en hora
 * local y en UTC (`/reglas` muestra `fechaHecho` con `timeZone: 'UTC'`) y el export CSV
 * (`toISOString().slice(0, 10)`) no se corre de día.
 */

/** `YYYY-MM-DD` → `Date` (mediodía local de ese día); `null` si no es una fecha de calendario válida. */
export function fechaDesdeDiaLocal(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const fecha = new Date(anio, mes - 1, dia, 12, 0, 0, 0);
  const valida = fecha.getFullYear() === anio && fecha.getMonth() === mes - 1 && fecha.getDate() === dia;
  return valida ? fecha : null;
}

/** `Date` → `YYYY-MM-DD` del día LOCAL (no el UTC de `toISOString`). */
export function diaLocalIso(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

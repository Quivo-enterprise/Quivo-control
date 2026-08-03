/**
 * Bolivia no observa horario de verano — UTC-4 todo el año (doc técnico, único mercado del
 * MVP, ver §9 respuesta 1). `venceAt` (RF-57) tiene que representar el fin de la jornada en
 * hora *local* de Bolivia, no UTC: guardar `23:59:59Z` del mismo `fecha` (como hacía la
 * primera versión de esto en QUI-232) vence una asignación a las 19:59:59 en Bolivia — 4
 * horas antes de lo real. QUI-234 encontró este bug al escribir los tests de borde de
 * fecha/zona horaria que pedía el ticket.
 */
const BOLIVIA_UTC_OFFSET_HOURS = 4;

/** Fecha calendario actual de Bolivia representada como medianoche UTC, compatible con
 * columnas Prisma `@db.Date`. Acepta `ahora` para permitir tests deterministas. */
export function fechaActualBolivia(ahora: Date = new Date()): Date {
  const bolivia = new Date(ahora.getTime() - BOLIVIA_UTC_OFFSET_HOURS * 3_600_000);
  return new Date(Date.UTC(bolivia.getUTCFullYear(), bolivia.getUTCMonth(), bolivia.getUTCDate()));
}

/** Instante UTC que corresponde a las 23:59:59 hora de Bolivia del `fecha` dado (que llega
 * como una fecha "pura", típicamente medianoche UTC — ver `z.coerce.date()` en
 * `GenerarRotacionSchema`/`CrearAsignacionManualSchema`). */
export function finDeJornadaBolivia(fecha: Date): Date {
  return new Date(
    Date.UTC(
      fecha.getUTCFullYear(),
      fecha.getUTCMonth(),
      fecha.getUTCDate(),
      23 + BOLIVIA_UTC_OFFSET_HOURS,
      59,
      59,
    ),
  );
}

export interface GpsArchiveRow {
  [column: string]: unknown;
  event_id: string;
  sesion_id: string;
  device_id: string;
  ts: Date | string;
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
  received_at: Date | string;
  // QUI-358/hallazgo 2 (code-review piloto): agregada por
  // `20260815120000_gps_points_sindicato_rls` — sin esta columna el archivo frío pierde la
  // atribución de tenant y no se puede restaurar a una tabla protegida por RLS sin
  // re-derivar el dueño vía `sesiones_operativas`. Nombre de columna real en Postgres es
  // camelCase entre comillas (`"sindicatoId"`), ver el SELECT en retencion-gps.service.ts.
  sindicatoId: string;
}

const PARTITION_PATTERN = /^gps_points_(\d{4})(\d{2})(\d{2})$/;

export function assertGpsPartitionName(name: string): string {
  if (!PARTITION_PATTERN.test(name)) {
    throw new Error(`Nombre de partición GPS inválido: ${name}`);
  }
  return name;
}

export function quoteIdentifier(name: string): string {
  return `"${assertGpsPartitionName(name)}"`;
}

export function gpsArchiveObjectKey(prefix: string, partitionName: string): string {
  const match = PARTITION_PATTERN.exec(assertGpsPartitionName(partitionName));
  if (!match) throw new Error(`Nombre de partición GPS inválido: ${partitionName}`);
  const [, year, month, day] = match;
  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, '');
  const filename = `${partitionName}.csv.gz`;
  return [cleanPrefix, 'gps_points', `year=${year}`, `month=${month}`, `day=${day}`, filename]
    .filter(Boolean)
    .join('/');
}

export const GPS_ARCHIVE_CSV_HEADER =
  'event_id,sesion_id,device_id,ts,lat,lng,accuracy,speed,received_at,sindicatoId\n';

export function gpsRowToCsv(row: GpsArchiveRow): string {
  return [
    row.event_id,
    row.sesion_id,
    row.device_id,
    isoDate(row.ts),
    row.lat,
    row.lng,
    row.accuracy,
    row.speed,
    isoDate(row.received_at),
    row.sindicatoId,
  ]
    .map(csvCell)
    .join(',')
    .concat('\n');
}

function isoDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

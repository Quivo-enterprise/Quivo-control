import { describe, expect, it } from 'vitest';
import {
  assertGpsPartitionName,
  gpsArchiveObjectKey,
  gpsRowToCsv,
  quoteIdentifier,
} from './retencion-gps.logic.js';

describe('retención GPS', () => {
  it('solo permite identificadores de partición controlados', () => {
    expect(assertGpsPartitionName('gps_points_20260131')).toBe('gps_points_20260131');
    expect(quoteIdentifier('gps_points_20260131')).toBe('"gps_points_20260131"');
    expect(() => quoteIdentifier('gps_points_20260131; DROP TABLE usuarios')).toThrow(
      'Nombre de partición GPS inválido',
    );
  });

  it('genera una clave particionada compatible con S3 y R2', () => {
    expect(gpsArchiveObjectKey('/quivo/cold/', 'gps_points_20260131')).toBe(
      'quivo/cold/gps_points/year=2026/month=01/day=31/gps_points_20260131.csv.gz',
    );
  });

  it('serializa CSV escapando texto y preservando nulls', () => {
    expect(
      gpsRowToCsv({
        event_id: 'event',
        sesion_id: 'session',
        device_id: 'bus,"42"',
        ts: '2026-01-31T12:00:00.000Z',
        lat: -16.4,
        lng: -68.1,
        accuracy: null,
        speed: 5,
        received_at: new Date('2026-01-31T12:00:01.000Z'),
      }),
    ).toBe(
      'event,session,"bus,""42""",2026-01-31T12:00:00.000Z,-16.4,-68.1,,5,2026-01-31T12:00:01.000Z\n',
    );
  });
});

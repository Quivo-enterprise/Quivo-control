import { describe, expect, it } from 'vitest';
import { diaLocalIso, fechaDesdeDiaLocal } from './fecha-local';

describe('fecha-local', () => {
  it('YYYY-MM-DD se interpreta como día local, no como medianoche UTC', () => {
    const f = fechaDesdeDiaLocal('2026-10-12')!;
    expect(f.getFullYear()).toBe(2026);
    expect(f.getMonth()).toBe(9);
    expect(f.getDate()).toBe(12);
    expect(f.getHours()).toBe(12);
    expect(diaLocalIso(f)).toBe('2026-10-12');
  });
  it('rechaza formatos y días de calendario inexistentes', () => {
    expect(fechaDesdeDiaLocal('2026-02-31')).toBeNull();
    expect(fechaDesdeDiaLocal('12/10/2026')).toBeNull();
    expect(fechaDesdeDiaLocal('')).toBeNull();
  });
  it('diaLocalIso usa el día local aunque el instante UTC sea otro', () => {
    expect(diaLocalIso(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});

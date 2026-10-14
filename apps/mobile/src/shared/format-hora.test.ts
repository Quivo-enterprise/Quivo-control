import { describe, expect, it } from 'vitest';
import { formatFechaHoraBolivia } from './format-hora';

describe('formatFechaHoraBolivia', () => {
  it('formatea dd/mm/aaaa hh:mm en hora de Bolivia (UTC-4)', () => {
    expect(formatFechaHoraBolivia('2026-10-14T13:05:00.000Z')).toBe('14/10/2026 09:05');
    // 02:00Z = 22:00 del día anterior en La Paz
    expect(formatFechaHoraBolivia('2026-10-14T02:00:00Z')).toBe('13/10/2026 22:00');
    // 04:00Z = medianoche en La Paz
    expect(formatFechaHoraBolivia('2026-10-14T04:00:00Z')).toBe('14/10/2026 00:00');
  });
  it('devuelve null si no parsea o está vacía', () => {
    expect(formatFechaHoraBolivia('basura')).toBeNull();
    expect(formatFechaHoraBolivia(null)).toBeNull();
  });
});

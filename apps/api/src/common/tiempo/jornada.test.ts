import { describe, expect, it } from 'vitest';
import { finDeJornadaBolivia } from './jornada.js';

describe('finDeJornadaBolivia', () => {
  it('vence a las 03:59:59 UTC del día siguiente (= 23:59:59 en Bolivia, UTC-4)', () => {
    const fin = finDeJornadaBolivia(new Date('2027-01-05T00:00:00.000Z'));
    expect(fin.toISOString()).toBe('2027-01-06T03:59:59.000Z');
  });

  it('cruza correctamente un cambio de mes', () => {
    const fin = finDeJornadaBolivia(new Date('2027-01-31T00:00:00.000Z'));
    expect(fin.toISOString()).toBe('2027-02-01T03:59:59.000Z');
  });

  it('cruza correctamente un cambio de año', () => {
    const fin = finDeJornadaBolivia(new Date('2026-12-31T00:00:00.000Z'));
    expect(fin.toISOString()).toBe('2027-01-01T03:59:59.000Z');
  });

  it('29 de febrero de un año bisiesto', () => {
    const fin = finDeJornadaBolivia(new Date('2028-02-29T00:00:00.000Z'));
    expect(fin.toISOString()).toBe('2028-03-01T03:59:59.000Z');
  });

  it('no se ve afectado por horario de verano (Bolivia no lo observa)', () => {
    // A diferencia de zonas con DST, el offset es siempre -4, todo el año — no hay un caso
    // "de invierno" vs "de verano" a probar acá, pero se deja explícito como documentación
    // ejecutable de esa asunción (doc técnico §9, único mercado del MVP).
    const finVerano = finDeJornadaBolivia(new Date('2027-01-15T00:00:00.000Z'));
    const finInvierno = finDeJornadaBolivia(new Date('2027-07-15T00:00:00.000Z'));
    expect(finVerano.getUTCHours()).toBe(3);
    expect(finInvierno.getUTCHours()).toBe(3);
  });
});

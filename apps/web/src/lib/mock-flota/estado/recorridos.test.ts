import { describe, expect, it } from 'vitest';
import { TRUFIS_MOCK } from '../datos';
import { sembrarHistorial } from './recorridos';

/** Ítem 9 del guion delegado: `sembrarHistorial` nunca cierra un recorrido con `fin` en el
 * futuro respecto de `now`, ni una `SalidaMock.programada`/`real` futura. */

describe('sembrarHistorial — nunca termina en el futuro (ítem 9)', () => {
  it('con distintos `now` a lo largo del día, ningún recorrido sembrado cierra después de `now`', () => {
    const horas = [5, 5, 6, 8, 9, 10, 12, 12, 30, 15, 18, 20, 22];
    for (const h of horas) {
      const now = new Date(2026, 8, 27, h, 30, 0, 0);
      const { recorridos, salidas } = sembrarHistorial(now);
      for (const r of recorridos) {
        expect(r.fin).toBeDefined();
        expect(Date.parse(r.fin!)).toBeLessThanOrEqual(now.getTime());
        expect(Date.parse(r.inicio)).toBeLessThanOrEqual(now.getTime());
      }
      for (const s of salidas) {
        expect(Date.parse(s.programada)).toBeLessThanOrEqual(now.getTime());
        if (s.real) {
          expect(Date.parse(s.real)).toBeLessThanOrEqual(now.getTime());
        }
      }
    }
  });

  it('el caso límite descrito en el bug (39 min antes de `now`, duración sorteada de 60 min) queda clampeado', () => {
    // Recorre varios `now` "impares" (no redondos) para forzar el caso borde sin depender de
    // conocer la semilla exacta.
    for (let minuto = 0; minuto < 60; minuto += 7) {
      const now = new Date(2026, 8, 27, 10, minuto, 0, 0);
      const { recorridos } = sembrarHistorial(now);
      for (const r of recorridos) {
        expect(Date.parse(r.fin!)).toBeLessThanOrEqual(now.getTime());
      }
    }
  });

  it('siembra al menos un recorrido por trufi cuando `now` es bien entrada la mañana', () => {
    const now = new Date(2026, 8, 27, 12, 0, 0, 0);
    const { recorridos } = sembrarHistorial(now);
    for (const trufi of TRUFIS_MOCK) {
      expect(recorridos.some((r) => r.trufiId === trufi.id)).toBe(true);
    }
  });

  it('los recorridos y las salidas quedan en orden cronológico (ítem 11)', () => {
    const now = new Date(2026, 8, 27, 14, 0, 0, 0);
    const { recorridos, salidas } = sembrarHistorial(now);
    for (let i = 1; i < recorridos.length; i++) {
      expect(Date.parse(recorridos[i]!.inicio)).toBeGreaterThanOrEqual(Date.parse(recorridos[i - 1]!.inicio));
    }
    for (let i = 1; i < salidas.length; i++) {
      expect(Date.parse(salidas[i]!.programada)).toBeGreaterThanOrEqual(Date.parse(salidas[i - 1]!.programada));
    }
  });
});

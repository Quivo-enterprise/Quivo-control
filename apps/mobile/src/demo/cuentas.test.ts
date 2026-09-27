import { describe, expect, it } from 'vitest';
import { CUENTAS_DEMO, contextoDeCuenta, idParadaDemo, uuidDemo } from './cuentas';
import { LINEAS_MOCK } from './datos/datos';

describe('uuidDemo', () => {
  it('es determinístico: la misma semilla siempre produce el mismo id', () => {
    expect(uuidDemo('semilla-cualquiera')).toBe(uuidDemo('semilla-cualquiera'));
  });

  it('tiene forma de UUID v4 válida (la misma que exige z.string().uuid())', () => {
    const id = uuidDemo('cualquier-semilla-de-prueba-mas-larga-que-16-chars');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  // Hallazgo de revisión: la versión anterior truncaba la semilla a sus primeros 16 caracteres —
  // dos semillas que solo divergían DESPUÉS del char 16 colisionaban en el mismo id.
  it('semillas que solo difieren después del carácter 16 ya NO colisionan', () => {
    // Mismo prefijo de 16 chars ("punto-l120-parad"), diverge recién en "a-san-…" vs "a-uyustus".
    expect(uuidDemo('punto-l120-parada-san-sebastian')).not.toBe(
      uuidDemo('punto-l120-parada-uyustus'),
    );
  });

  it('sesionId distinto para dos conductores aunque el contador arranque en el mismo valor (simula un contador reseteado por reinicio/hot reload)', () => {
    const seedA = `sesion-1-${CUENTAS_DEMO[0]!.conductorId}`;
    const seedB = `sesion-1-${CUENTAS_DEMO[1]!.conductorId}`;
    expect(uuidDemo(seedA)).not.toBe(uuidDemo(seedB));
  });
});

describe('idParadaDemo — sin colisiones dentro de una línea', () => {
  it.each(['z12', 'l120'] as const)('cada parada/punto de control de %s tiene un id único', (lineaId) => {
    const ids = LINEAS_MOCK[lineaId].paradas.map((p) => idParadaDemo(lineaId, p.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('caso concreto reportado: parada-san-sebastian y parada-uyustus (L120) ya no colisionan', () => {
    expect(idParadaDemo('l120', 'parada-san-sebastian')).not.toBe(
      idParadaDemo('l120', 'parada-uyustus'),
    );
  });
});

describe('contextoDeCuenta — sesionId distinto por conductor', () => {
  it('produce sesionId distintos para todas las cuentas demo', () => {
    const sesiones = CUENTAS_DEMO.map((c) => contextoDeCuenta(c, Date.now()).sesionId);
    expect(new Set(sesiones).size).toBe(sesiones.length);
  });
});

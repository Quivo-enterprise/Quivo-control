import { describe, expect, it } from 'vitest';
import {
  bateriaConsumidaPorcentaje,
  detectarHuecos,
  evaluarCriteriosGo,
} from './battery-gap-monitor.js';

const MIN = 60_000;

describe('detectarHuecos', () => {
  it('no reporta huecos si los puntos están dentro del umbral', () => {
    const reporte = detectarHuecos([0, MIN, 2 * MIN, 3 * MIN]);
    expect(reporte.cantidad).toBe(0);
  });

  it('detecta un hueco mayor a 2 minutos', () => {
    const reporte = detectarHuecos([0, MIN, 10 * MIN, 11 * MIN]);
    expect(reporte.cantidad).toBe(1);
    expect(reporte.huecos[0]?.duracionMs).toBe(9 * MIN);
  });
});

describe('bateriaConsumidaPorcentaje', () => {
  it('calcula el consumo entre la primera y última muestra, sin importar el orden', () => {
    const consumo = bateriaConsumidaPorcentaje([
      { ts: 2, nivel: 90 },
      { ts: 0, nivel: 100 },
    ]);
    expect(consumo).toBe(10);
  });
});

describe('evaluarCriteriosGo', () => {
  it('da GO cuando batería < 5%/jornada y sin huecos', () => {
    const resultado = evaluarCriteriosGo({
      bateriaConsumidaPorcentaje: 3,
      reporteHuecos: { cantidad: 0, huecoMaximoMs: 0, huecos: [] },
      duracionMedicionHoras: 8,
    });
    expect(resultado.go).toBe(true);
  });

  it('da NO-GO cuando hay huecos, aunque la batería esté bien', () => {
    const resultado = evaluarCriteriosGo({
      bateriaConsumidaPorcentaje: 2,
      reporteHuecos: { cantidad: 1, huecoMaximoMs: 9 * MIN, huecos: [] },
      duracionMedicionHoras: 8,
    });
    expect(resultado.go).toBe(false);
    expect(resultado.motivos).toHaveLength(1);
  });
});

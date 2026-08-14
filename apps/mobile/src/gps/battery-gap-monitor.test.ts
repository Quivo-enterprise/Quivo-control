import { describe, expect, it } from 'vitest';
import {
  bateriaConsumidaPorcentaje,
  detectarHuecos,
  duracionVentanaBateriaHoras,
  evaluarCriteriosGo,
} from './battery-gap-monitor';

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

describe('duracionVentanaBateriaHoras', () => {
  it('calcula la duración entre la primera y última muestra de batería, en horas', () => {
    const duracion = duracionVentanaBateriaHoras([
      { ts: 30 * MIN, nivel: 90 },
      { ts: 0, nivel: 100 },
    ]);
    expect(duracion).toBeCloseTo(0.5);
  });

  it('devuelve 0 con menos de dos muestras', () => {
    expect(duracionVentanaBateriaHoras([])).toBe(0);
    expect(duracionVentanaBateriaHoras([{ ts: 0, nivel: 100 }])).toBe(0);
  });
});

describe('evaluarCriteriosGo', () => {
  it('da GO cuando batería < 5%/jornada y sin huecos', () => {
    const resultado = evaluarCriteriosGo({
      bateriaConsumidaPorcentaje: 3,
      reporteHuecos: { cantidad: 0, huecoMaximoMs: 0, huecos: [] },
      duracionMedicionHoras: 8,
      duracionBateriaHoras: 8,
    });
    expect(resultado.go).toBe(true);
  });

  it('da NO-GO cuando hay huecos, aunque la batería esté bien', () => {
    const resultado = evaluarCriteriosGo({
      bateriaConsumidaPorcentaje: 2,
      reporteHuecos: { cantidad: 1, huecoMaximoMs: 9 * MIN, huecos: [] },
      duracionMedicionHoras: 8,
      duracionBateriaHoras: 8,
    });
    expect(resultado.go).toBe(false);
    expect(resultado.motivos).toHaveLength(1);
  });

  it('da NO-GO si alguna ubicación recibida no se pudo escribir en el outbox', () => {
    const resultado = evaluarCriteriosGo({
      bateriaConsumidaPorcentaje: 2,
      reporteHuecos: { cantidad: 0, huecoMaximoMs: 0, huecos: [] },
      duracionMedicionHoras: 8,
      duracionBateriaHoras: 8,
      erroresEscrituraOutbox: 3,
    });
    expect(resultado.go).toBe(false);
    expect(resultado.motivos).toHaveLength(1);
  });

  it('sin errores de escritura declarados, el veredicto no cambia', () => {
    const resultado = evaluarCriteriosGo({
      bateriaConsumidaPorcentaje: 2,
      reporteHuecos: { cantidad: 0, huecoMaximoMs: 0, huecos: [] },
      duracionMedicionHoras: 8,
      duracionBateriaHoras: 8,
    });
    expect(resultado.go).toBe(true);
  });

  it('da NO-GO con motivo "no concluyente" si la medición dura menos de 1h, aunque todo lo demás esté limpio', () => {
    // El chofer reabre la app 2 minutos a mitad de turno, la batería no bajó, y aprieta
    // Detener: sin el piso de duración esto era un GO limpio sobre una medición que no dice
    // nada de una jornada de 8h.
    const resultado = evaluarCriteriosGo({
      bateriaConsumidaPorcentaje: 0,
      reporteHuecos: { cantidad: 0, huecoMaximoMs: 0, huecos: [] },
      duracionMedicionHoras: 2 / 60,
      duracionBateriaHoras: 2 / 60,
    });
    expect(resultado.go).toBe(false);
    expect(resultado.motivos).toHaveLength(1);
    expect(resultado.motivos[0]).toMatch(/no concluyente/i);
  });

  it('a partir de 1h de medición, evalúa los criterios normalmente (no "no concluyente")', () => {
    const resultado = evaluarCriteriosGo({
      bateriaConsumidaPorcentaje: 0.5,
      reporteHuecos: { cantidad: 0, huecoMaximoMs: 0, huecos: [] },
      duracionMedicionHoras: 1,
      duracionBateriaHoras: 1,
    });
    expect(resultado.go).toBe(true);
    expect(resultado.motivos).toHaveLength(0);
  });

  describe('ventana de batería corta contra ventana de medición larga (hallazgo A9, QUI-216 criterio A)', () => {
    it('NO da GO cuando la batería solo se muestreó 30 min de una corrida de 8h, aunque el consumo medido sea bajo', () => {
      // Escenario del hallazgo: corrida de 8h, el chofer mata la app a las 2h (criterio C) —
      // Android recicla el proceso y el `useRef` de batería se pierde — y la reabre recién a
      // las 7h30. Las muestras de batería cubren 30 min; `duracionMedicionHoras` (huecos,
      // leída del outbox) dice 8h. Con el bug (extrapolar sobre la ventana de huecos):
      // (1 / 8) * 8 = 1% → GO falso. Con el denominador correcto (ventana de batería):
      // (1 / 0.5) * 8 = 16% → ya sería NO-GO por batería; además la cobertura (0.5h sobre 8h,
      // 6.25%) cae bajo el piso de cobertura y el veredicto es directamente "no concluyente".
      const resultado = evaluarCriteriosGo({
        bateriaConsumidaPorcentaje: 1,
        reporteHuecos: { cantidad: 0, huecoMaximoMs: 0, huecos: [] },
        duracionMedicionHoras: 8,
        duracionBateriaHoras: 0.5,
      });
      expect(resultado.go).toBe(false);
      expect(resultado.motivos.some((m) => /no concluyente/i.test(m))).toBe(true);
    });

    it('NO da GO por baja cobertura aunque la ventana de batería supere el piso absoluto de 1h', () => {
      // Corrida larga (16h, doble turno): la ventana de batería (1h30) supera el piso
      // ABSOLUTO de 1h, pero cubre menos del 10% de la medición total — el piso de COBERTURA
      // tiene que atajar esto igual, o una corrida larga con una ventana de batería
      // "razonable" en horas absolutas coló un veredicto que no representa la jornada.
      const resultado = evaluarCriteriosGo({
        bateriaConsumidaPorcentaje: 0.5,
        reporteHuecos: { cantidad: 0, huecoMaximoMs: 0, huecos: [] },
        duracionMedicionHoras: 16,
        duracionBateriaHoras: 1.5,
      });
      expect(resultado.go).toBe(false);
      expect(resultado.motivos.some((m) => /no concluyente/i.test(m))).toBe(true);
    });

    it('sí evalúa (y puede dar GO) cuando la ventana de batería cubre la mayor parte de la medición', () => {
      // Control positivo: la app estuvo viva casi toda la corrida (7.5h de batería sobre 8h de
      // medición, 93.75% de cobertura) — el piso de cobertura no debe bloquear un veredicto
      // legítimo.
      const resultado = evaluarCriteriosGo({
        bateriaConsumidaPorcentaje: 3,
        reporteHuecos: { cantidad: 0, huecoMaximoMs: 0, huecos: [] },
        duracionMedicionHoras: 8,
        duracionBateriaHoras: 7.5,
      });
      expect(resultado.go).toBe(true);
      expect(resultado.bateriaEstimadaPorJornada8h).toBeCloseTo((3 / 7.5) * 8);
    });

    it('devuelve `duracionBateriaHoras` en el resultado para que el caller pueda mostrar ambas ventanas', () => {
      const resultado = evaluarCriteriosGo({
        bateriaConsumidaPorcentaje: 1,
        reporteHuecos: { cantidad: 0, huecoMaximoMs: 0, huecos: [] },
        duracionMedicionHoras: 8,
        duracionBateriaHoras: 0.5,
      });
      expect(resultado.duracionBateriaHoras).toBe(0.5);
    });
  });
});

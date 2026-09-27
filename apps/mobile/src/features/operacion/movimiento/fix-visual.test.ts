import { describe, expect, it } from 'vitest';
import type { Location } from 'react-native-background-geolocation';
import { esFixVisual, fixVisualDesdeLocation } from './fix-visual';

/** `Location` de prueba mínimo — solo los campos que `fixVisualDesdeLocation`/`esFixVisual`
 * leen realmente. El resto de la interfaz (`odometer`, `uuid`, `battery`, `activity`, …) no le
 * importa a ninguna de las dos funciones, así que se castea en vez de rellenar un objeto
 * completo con valores que nadie verifica. */
function locationDePrueba(parcial: {
  lat?: number;
  lng?: number;
  timestamp?: string;
  speed?: number;
  heading?: number;
  headingAccuracy?: number;
  accuracy?: number;
  extras?: Record<string, unknown>;
}): Location {
  return {
    timestamp: parcial.timestamp ?? '2026-09-27T12:00:00.000Z',
    coords: {
      latitude: parcial.lat ?? -17.38,
      longitude: parcial.lng ?? -66.15,
      // `'accuracy' in parcial` (no `??`) para poder testear el caso "explícitamente undefined"
      // (bridge nativo que no trae el campo) sin que el default de 8 lo tape.
      accuracy: 'accuracy' in parcial ? parcial.accuracy : 8,
      speed: parcial.speed,
      heading: parcial.heading,
      heading_accuracy: parcial.headingAccuracy,
    },
    extras: parcial.extras,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver docblock de arriba.
  } as any as Location;
}

describe('fixVisualDesdeLocation', () => {
  it('copia lat/lng/accuracy tal cual', () => {
    const fix = fixVisualDesdeLocation(locationDePrueba({ lat: -17.4, lng: -66.2, accuracy: 12 }));
    expect(fix.lat).toBe(-17.4);
    expect(fix.lng).toBe(-66.2);
    expect(fix.accuracy).toBe(12);
  });

  it('parsea el timestamp ISO a epoch ms', () => {
    const fix = fixVisualDesdeLocation(locationDePrueba({ timestamp: '2026-09-27T12:00:00.000Z' }));
    expect(fix.ts).toBe(new Date('2026-09-27T12:00:00.000Z').getTime());
  });

  it('cae a Date.now() con un timestamp ilegible, en vez de NaN', () => {
    const antes = Date.now();
    const fix = fixVisualDesdeLocation(locationDePrueba({ timestamp: 'no-es-una-fecha' }));
    const despues = Date.now();
    expect(fix.ts).toBeGreaterThanOrEqual(antes);
    expect(fix.ts).toBeLessThanOrEqual(despues);
  });

  it('propaga speed/heading numéricos', () => {
    const fix = fixVisualDesdeLocation(locationDePrueba({ speed: 3.5, heading: 90 }));
    expect(fix.speed).toBe(3.5);
    expect(fix.heading).toBe(90);
  });

  it('cae a -1 cuando speed/heading no son numéricos (undefined del bridge nativo)', () => {
    const fix = fixVisualDesdeLocation(locationDePrueba({}));
    expect(fix.speed).toBe(-1);
    expect(fix.heading).toBe(-1);
  });

  it('propaga heading_accuracy cuando es numérica, y la deja undefined si no', () => {
    const conAccuracy = fixVisualDesdeLocation(locationDePrueba({ headingAccuracy: 20 }));
    expect(conAccuracy.headingAccuracy).toBe(20);

    const sinAccuracy = fixVisualDesdeLocation(locationDePrueba({}));
    expect(sinAccuracy.headingAccuracy).toBeUndefined();
  });

  it('cae a 0 de accuracy cuando no es numérica', () => {
    const fix = fixVisualDesdeLocation(locationDePrueba({ accuracy: undefined }));
    expect(fix.accuracy).toBe(0);
  });
});

describe('esFixVisual', () => {
  it('es true cuando extras.fuente === "visual"', () => {
    expect(esFixVisual(locationDePrueba({ extras: { fuente: 'visual' } }))).toBe(true);
  });

  it('es false sin extras', () => {
    expect(esFixVisual(locationDePrueba({}))).toBe(false);
  });

  it('es false con extras que no tienen fuente "visual"', () => {
    expect(esFixVisual(locationDePrueba({ extras: { fuente: 'otra-cosa' } }))).toBe(false);
    expect(esFixVisual(locationDePrueba({ extras: { otroCampo: 1 } }))).toBe(false);
  });
});

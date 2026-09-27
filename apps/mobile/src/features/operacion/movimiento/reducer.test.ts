import { describe, expect, it } from 'vitest';
import { aplicarFix } from './reducer';
import type { FixVisual } from './tipos';

function fix(parcial: Partial<FixVisual> & Pick<FixVisual, 'lat' | 'lng' | 'ts'>): FixVisual {
  return {
    speed: -1,
    heading: -1,
    accuracy: 5,
    ...parcial,
  };
}

describe('aplicarFix — primer fix', () => {
  it('toma la posición del primer fix tal cual, sin rumbo (nunca hubo uno)', () => {
    const estado = aplicarFix(null, fix({ lat: -17.38, lng: -66.15, ts: 1000, accuracy: 8 }));
    expect(estado.lat).toBe(-17.38);
    expect(estado.lng).toBe(-66.15);
    expect(estado.rumbo).toBeNull();
    expect(estado.accuracy).toBe(8);
    expect(estado.ts).toBe(1000);
  });
});

describe('aplicarFix — anti-jitter', () => {
  it('con speed < 0.5 m/s y desplazamiento < accuracy, la posición mostrada no cambia', () => {
    const inicial = aplicarFix(null, fix({ lat: 0, lng: 0, ts: 0, accuracy: 10 }));
    // ~1.1m de desplazamiento (0.00001° de latitud), muy por debajo de accuracy=10.
    const siguiente = aplicarFix(
      inicial,
      fix({ lat: 0.00001, lng: 0, ts: 1000, speed: 0.2, accuracy: 10 }),
    );
    expect(siguiente.lat).toBe(0);
    expect(siguiente.lng).toBe(0);
    // accuracy/ts/rumbo sí se actualizan aunque la posición no se mueva.
    expect(siguiente.ts).toBe(1000);
  });

  it('con speed >= 0.5 m/s, aunque el desplazamiento sea chico, SÍ actualiza la posición', () => {
    const inicial = aplicarFix(null, fix({ lat: 0, lng: 0, ts: 0, accuracy: 10 }));
    const siguiente = aplicarFix(
      inicial,
      fix({ lat: 0.00001, lng: 0, ts: 1000, speed: 0.6, accuracy: 10 }),
    );
    expect(siguiente.lat).toBe(0.00001);
  });

  it('con desplazamiento >= accuracy, aunque la velocidad sea baja, SÍ actualiza la posición', () => {
    const inicial = aplicarFix(null, fix({ lat: 0, lng: 0, ts: 0, accuracy: 5 }));
    // ~11.1m de desplazamiento (0.0001° de latitud), por encima de accuracy=5.
    const siguiente = aplicarFix(
      inicial,
      fix({ lat: 0.0001, lng: 0, ts: 1000, speed: 0.2, accuracy: 5 }),
    );
    expect(siguiente.lat).toBe(0.0001);
  });

  it('con speed desconocida (-1) no activa el anti-jitter: actualiza la posición igual', () => {
    const inicial = aplicarFix(null, fix({ lat: 0, lng: 0, ts: 0, accuracy: 10 }));
    const siguiente = aplicarFix(
      inicial,
      fix({ lat: 0.00001, lng: 0, ts: 1000, speed: -1, accuracy: 10 }),
    );
    expect(siguiente.lat).toBe(0.00001);
  });
});

describe('aplicarFix — integración con seleccionarRumbo', () => {
  it('propaga el rumbo calculado por seleccionarRumbo en cada fix', () => {
    const inicial = aplicarFix(
      null,
      fix({ lat: 0, lng: 0, ts: 0, speed: 3, heading: 45 }),
    );
    expect(inicial.rumbo).toBe(45);

    const siguiente = aplicarFix(
      inicial,
      fix({ lat: 0.001, lng: 0, ts: 1000, speed: 3, heading: 60 }),
    );
    expect(siguiente.rumbo).toBe(60);
  });

  it('conserva el estadoRumbo entre fixes (la histéresis persiste)', () => {
    const enCurso = aplicarFix(null, fix({ lat: 0, lng: 0, ts: 0, speed: 3, heading: 10 }));
    expect(enCurso.estadoRumbo.enRumboDeCurso).toBe(true);

    // Baja de golpe a 0.5 m/s (< salida 1.0): sale de rumbo de curso.
    const detenido = aplicarFix(
      enCurso,
      fix({ lat: 0, lng: 0, ts: 1000, speed: 0.5, heading: 10 }),
    );
    expect(detenido.estadoRumbo.enRumboDeCurso).toBe(false);
  });
});

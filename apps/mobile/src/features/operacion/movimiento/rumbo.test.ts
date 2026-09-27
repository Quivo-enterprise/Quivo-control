import { describe, expect, it } from 'vitest';
import { ESTADO_RUMBO_INICIAL, seleccionarRumbo, type EstadoRumbo } from './rumbo';
import type { FixVisual } from './tipos';

/** Fix de prueba con defaults razonables — cada test pisa solo lo que le importa. */
function fix(parcial: Partial<FixVisual> & Pick<FixVisual, 'lat' | 'lng'>): FixVisual {
  return {
    ts: 0,
    speed: -1,
    heading: -1,
    accuracy: 5,
    ...parcial,
  };
}

describe('seleccionarRumbo — sin rumbo válido aún', () => {
  it('devuelve null en el primer fix sin heading y sin punto de referencia previo', () => {
    const estado = seleccionarRumbo(fix({ lat: -17.38, lng: -66.15 }), ESTADO_RUMBO_INICIAL);
    expect(estado.rumbo).toBeNull();
  });
});

describe('seleccionarRumbo — histéresis de velocidad', () => {
  it('entra a rumbo de curso con speed >= 2.0 m/s y usa el heading del fix', () => {
    const estado = seleccionarRumbo(
      fix({ lat: 0, lng: 0, speed: 2.0, heading: 90 }),
      ESTADO_RUMBO_INICIAL,
    );
    expect(estado.enRumboDeCurso).toBe(true);
    expect(estado.rumbo).toBe(90);
  });

  it('con speed < 2.0 m/s no entra a rumbo de curso (no usa el heading del fix)', () => {
    const estado = seleccionarRumbo(
      fix({ lat: 0, lng: 0, speed: 1.9, heading: 90 }),
      ESTADO_RUMBO_INICIAL,
    );
    expect(estado.enRumboDeCurso).toBe(false);
  });

  it('sale de rumbo de curso con speed < 1.0 m/s', () => {
    const enCurso: EstadoRumbo = {
      rumbo: 90,
      enRumboDeCurso: true,
      referencia: { lat: 0, lng: 0 },
    };
    const estado = seleccionarRumbo(fix({ lat: 0, lng: 0, speed: 0.9, heading: 90 }), enCurso);
    expect(estado.enRumboDeCurso).toBe(false);
  });

  it('mantiene el modo previo (histéresis) con speed entre 1.0 y 2.0 m/s', () => {
    const enCurso: EstadoRumbo = {
      rumbo: 90,
      enRumboDeCurso: true,
      referencia: { lat: 0, lng: 0 },
    };
    const sostenido = seleccionarRumbo(fix({ lat: 0, lng: 0, speed: 1.5, heading: 100 }), enCurso);
    expect(sostenido.enRumboDeCurso).toBe(true);
    expect(sostenido.rumbo).toBe(100); // sigue en curso: usa el heading nuevo

    const fueraDeCurso: EstadoRumbo = {
      rumbo: 90,
      enRumboDeCurso: false,
      referencia: { lat: 0, lng: 0 },
    };
    const noSostenido = seleccionarRumbo(
      fix({ lat: 0, lng: 0, speed: 1.5, heading: 100 }),
      fueraDeCurso,
    );
    expect(noSostenido.enRumboDeCurso).toBe(false); // sigue fuera: no usa el heading
  });

  it('oscila correctamente al cruzar los dos umbrales varias veces en secuencia', () => {
    let estado = ESTADO_RUMBO_INICIAL;
    estado = seleccionarRumbo(fix({ lat: 0, lng: 0, speed: 2.5, heading: 10 }), estado); // entra
    expect(estado.enRumboDeCurso).toBe(true);
    estado = seleccionarRumbo(fix({ lat: 0, lng: 0, speed: 1.5, heading: 10 }), estado); // sostiene
    expect(estado.enRumboDeCurso).toBe(true);
    estado = seleccionarRumbo(fix({ lat: 0, lng: 0, speed: 0.9, heading: 10 }), estado); // sale
    expect(estado.enRumboDeCurso).toBe(false);
    estado = seleccionarRumbo(fix({ lat: 0, lng: 0, speed: 1.5, heading: 10 }), estado); // sigue afuera
    expect(estado.enRumboDeCurso).toBe(false);
    estado = seleccionarRumbo(fix({ lat: 0, lng: 0, speed: 2.0, heading: 10 }), estado); // vuelve a entrar
    expect(estado.enRumboDeCurso).toBe(true);
  });

  it('con speed desconocida (-1) no toca el modo previo', () => {
    const enCurso: EstadoRumbo = { rumbo: 90, enRumboDeCurso: true, referencia: { lat: 0, lng: 0 } };
    const estado = seleccionarRumbo(fix({ lat: 0, lng: 0, speed: -1, heading: 90 }), enCurso);
    expect(estado.enRumboDeCurso).toBe(true);
  });
});

describe('seleccionarRumbo — heading inválido', () => {
  it('heading -1 (no vino de GPS) no se usa aunque estemos en rumbo de curso', () => {
    const enCurso: EstadoRumbo = {
      rumbo: 45,
      enRumboDeCurso: true,
      referencia: { lat: 0, lng: 0 },
    };
    // Desplazamiento insuficiente para el fallback: debe mantener el rumbo previo.
    const estado = seleccionarRumbo(
      fix({ lat: 0.00001, lng: 0.00001, speed: 3, heading: -1 }),
      enCurso,
    );
    expect(estado.rumbo).toBe(45);
  });

  it('heading_accuracy > 45° invalida el heading aunque heading >= 0', () => {
    const enCurso: EstadoRumbo = {
      rumbo: 45,
      enRumboDeCurso: true,
      referencia: { lat: 0, lng: 0 },
    };
    const estado = seleccionarRumbo(
      fix({ lat: 0.00001, lng: 0.00001, speed: 3, heading: 200, headingAccuracy: 46 }),
      enCurso,
    );
    expect(estado.rumbo).not.toBe(200);
    expect(estado.rumbo).toBe(45); // desplazamiento insuficiente para el fallback: mantiene
  });

  it('heading_accuracy <= 45° sí se acepta', () => {
    const enCurso: EstadoRumbo = { rumbo: 45, enRumboDeCurso: true, referencia: { lat: 0, lng: 0 } };
    const estado = seleccionarRumbo(
      fix({ lat: 0, lng: 0, speed: 3, heading: 200, headingAccuracy: 45 }),
      enCurso,
    );
    expect(estado.rumbo).toBe(200);
  });

  it('heading_accuracy ausente no invalida el heading', () => {
    const enCurso: EstadoRumbo = { rumbo: 45, enRumboDeCurso: true, referencia: { lat: 0, lng: 0 } };
    const estado = seleccionarRumbo(fix({ lat: 0, lng: 0, speed: 3, heading: 77 }), enCurso);
    expect(estado.rumbo).toBe(77);
  });

  it('heading_accuracy <= 0 se trata como "sin dato de precisión" (no invalida)', () => {
    const enCurso: EstadoRumbo = { rumbo: 45, enRumboDeCurso: true, referencia: { lat: 0, lng: 0 } };
    const estado = seleccionarRumbo(
      fix({ lat: 0, lng: 0, speed: 3, heading: 77, headingAccuracy: 0 }),
      enCurso,
    );
    expect(estado.rumbo).toBe(77);
  });
});

describe('seleccionarRumbo — fallback por bearing', () => {
  it('usa el bearing entre la referencia previa y la actual cuando no hay heading confiable y el desplazamiento supera max(10,accuracy)', () => {
    const previo: EstadoRumbo = { rumbo: null, enRumboDeCurso: false, referencia: { lat: 0, lng: 0 } };
    // ~111m al norte (0.001° de latitud) — supera el umbral de 10m.
    const estado = seleccionarRumbo(fix({ lat: 0.001, lng: 0, speed: -1, accuracy: 5 }), previo);
    expect(estado.rumbo).toBeCloseTo(0, 3); // hacia el norte puro
  });

  it('no dispara el fallback si el desplazamiento no supera max(10,accuracy)', () => {
    const previo: EstadoRumbo = { rumbo: 15, enRumboDeCurso: false, referencia: { lat: 0, lng: 0 } };
    // ~1.1m — muy por debajo de 10m.
    const estado = seleccionarRumbo(fix({ lat: 0.00001, lng: 0, speed: -1, accuracy: 5 }), previo);
    expect(estado.rumbo).toBe(15); // mantiene
  });

  it('usa accuracy como umbral cuando accuracy > 10', () => {
    const previo: EstadoRumbo = { rumbo: 15, enRumboDeCurso: false, referencia: { lat: 0, lng: 0 } };
    // ~13.3m de desplazamiento (0.00012°), con accuracy=20 el umbral es max(10,20)=20 → no dispara.
    const noDispara = seleccionarRumbo(
      fix({ lat: 0.00012, lng: 0, speed: -1, accuracy: 20 }),
      previo,
    );
    expect(noDispara.rumbo).toBe(15);

    // Con accuracy=5 el umbral es max(10,5)=10 → el mismo desplazamiento (~13.3m) sí dispara.
    const dispara = seleccionarRumbo(fix({ lat: 0.00012, lng: 0, speed: -1, accuracy: 5 }), previo);
    expect(dispara.rumbo).toBeCloseTo(0, 1);
  });
});

describe('seleccionarRumbo — hold (mantiene el último rumbo)', () => {
  it('sin heading confiable y sin desplazamiento suficiente, mantiene el rumbo previo tal cual', () => {
    const previo: EstadoRumbo = { rumbo: 123, enRumboDeCurso: false, referencia: { lat: 0, lng: 0 } };
    const estado = seleccionarRumbo(fix({ lat: 0, lng: 0, speed: 0, heading: -1 }), previo);
    expect(estado.rumbo).toBe(123);
  });

  it('detenido (fuera de rumbo de curso), aunque el heading del fix sea válido, no lo usa', () => {
    const previo: EstadoRumbo = { rumbo: 123, enRumboDeCurso: false, referencia: { lat: 0, lng: 0 } };
    const estado = seleccionarRumbo(fix({ lat: 0, lng: 0, speed: 0.2, heading: 300 }), previo);
    expect(estado.rumbo).toBe(123);
  });
});

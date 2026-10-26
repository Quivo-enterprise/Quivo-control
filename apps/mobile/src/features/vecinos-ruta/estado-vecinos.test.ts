import { describe, expect, it } from 'vitest';
import { UMBRAL_VECINO_FRESCO_MS, type VecinoRuta } from '@quivo/shared';
import {
  decidirAlertaVecino,
  estadoDistanciaVecino,
  estadoFila,
  etiquetaAccesibleFila,
  minutosDesde,
  sinActualizar,
  tarjetaVisible,
  textoDistancia,
  textoEdad,
  textoVacio,
  vecinoVisible,
} from './estado-vecinos';

const vecino: VecinoRuta = {
  placa: '1234-ABC',
  numeroInterno: '12',
  tipo: 'minibus',
  marca: 'Toyota',
  modelo: 'Hiace',
  color: 'rojo',
  colorSecundario: null,
  distanciaM: 850,
  edadFixS: 60,
};

describe('vecinoVisible', () => {
  it('oculta null', () => expect(vecinoVisible(null)).toBe(false));
  it('muestra un fix fresco', () => expect(vecinoVisible(vecino)).toBe(true));
  it('muestra justo en el umbral y oculta pasado', () => {
    const limite = { ...vecino, edadFixS: UMBRAL_VECINO_FRESCO_MS / 1000 };
    expect(vecinoVisible(limite)).toBe(true);
    expect(vecinoVisible({ ...limite, edadFixS: limite.edadFixS + 1 })).toBe(false);
  });
  it('suma el tiempo transcurrido desde la recepción', () => {
    expect(vecinoVisible({ ...vecino, edadFixS: 590 }, 20_000)).toBe(false);
  });
});

describe('textoEdad', () => {
  it('menos de un minuto', () => expect(textoEdad(59)).toBe('hace menos de 1 min'));
  it('minutos enteros', () => {
    expect(textoEdad(60)).toBe('hace 1 min');
    expect(textoEdad(185)).toBe('hace 3 min');
  });
  it('suma transcurrido', () => expect(textoEdad(50, 15_000)).toBe('hace 1 min'));
});

describe('textos', () => {
  it('distancia reutiliza el formato de la app', () => {
    expect(textoDistancia(850)).toBe('850 m');
    expect(textoDistancia(1200)).toBe('1.2 km');
  });
  it('vacíos', () => {
    expect(textoVacio('delante')).toBe('Nadie delante en tu ruta');
    expect(textoVacio('detras')).toBe('Nadie detrás en tu ruta');
  });
});

describe('minutosDesde', () => {
  it('trunca a minutos enteros', () => {
    expect(minutosDesde(59)).toBe(0);
    expect(minutosDesde(60)).toBe(1);
    expect(minutosDesde(185)).toBe(3);
  });
  it('suma transcurrido y tolera negativos', () => {
    expect(minutosDesde(50, 15_000)).toBe(1);
    expect(minutosDesde(-5, -100)).toBe(0);
  });
});

describe('estadoFila', () => {
  it('vecino fresco', () => expect(estadoFila(vecino, 0)).toEqual({ tipo: 'vecino', vecino }));
  it('vecino vencido es sinDato, no nadie', () => {
    expect(estadoFila({ ...vecino, edadFixS: 590 }, 20_000)).toEqual({ tipo: 'sinDato' });
  });
  it('null con respuesta fresca es nadie', () => {
    expect(estadoFila(null, 0)).toEqual({ tipo: 'nadie' });
    expect(estadoFila(null, UMBRAL_VECINO_FRESCO_MS)).toEqual({ tipo: 'nadie' });
  });
  it('null con respuesta vencida es sinDato', () => {
    expect(estadoFila(null, UMBRAL_VECINO_FRESCO_MS + 1)).toEqual({ tipo: 'sinDato' });
  });
});

describe('tarjetaVisible', () => {
  it('se oculta solo si ambas filas son sinDato', () => {
    expect(tarjetaVisible({ tipo: 'sinDato' }, { tipo: 'sinDato' })).toBe(false);
    expect(tarjetaVisible({ tipo: 'sinDato' }, { tipo: 'nadie' })).toBe(true);
    expect(tarjetaVisible({ tipo: 'vecino', vecino }, { tipo: 'sinDato' })).toBe(true);
  });
});

describe('sinActualizar', () => {
  it('avisa desde 2 fallos seguidos', () => {
    expect(sinActualizar(0)).toBe(false);
    expect(sinActualizar(1)).toBe(false);
    expect(sinActualizar(2)).toBe(true);
  });
});

describe('etiquetaAccesibleFila', () => {
  const v = (x: VecinoRuta) => ({ tipo: 'vecino', vecino: x }) as const;
  it('frase completa', () => {
    expect(etiquetaAccesibleFila('delante', v(vecino))).toBe(
      'Delante: placa 1234-ABC, interno 12, a 850 metros, hace 1 minuto',
    );
  });
  it('sin interno y en km', () => {
    expect(
      etiquetaAccesibleFila(
        'detras',
        v({ ...vecino, numeroInterno: null, distanciaM: 1200, edadFixS: 5 }),
      ),
    ).toBe('Detrás: placa 1234-ABC, a 1,2 kilómetros, hace menos de un minuto');
  });
  it('delante añade el semáforo; detrás no', () => {
    expect(etiquetaAccesibleFila('delante', v({ ...vecino, distanciaM: 400 }))).toContain(
      '400 metros, cerca, hace',
    );
    expect(etiquetaAccesibleFila('delante', v({ ...vecino, distanciaM: 250 }))).toContain(
      '250 metros, muy cerca, hace',
    );
    expect(etiquetaAccesibleFila('detras', v({ ...vecino, distanciaM: 250 }))).not.toContain(
      'cerca',
    );
  });
  it('fila vacía', () => {
    expect(etiquetaAccesibleFila('detras', { tipo: 'nadie' })).toBe('Nadie detrás en tu ruta');
  });
  it('fila sin datos', () => {
    expect(etiquetaAccesibleFila('delante', { tipo: 'sinDato' })).toBe(
      'Delante: sin datos recientes',
    );
  });
});

describe('estadoDistanciaVecino', () => {
  it('normal por encima de 500 m', () => {
    expect(estadoDistanciaVecino(620)).toBe('normal');
    expect(estadoDistanciaVecino(500.1)).toBe('normal');
  });
  it('atención entre 300 (excl.) y 500 m (incl.)', () => {
    expect(estadoDistanciaVecino(500)).toBe('atencion');
    expect(estadoDistanciaVecino(300.1)).toBe('atencion');
  });
  it('alerta en 300 m o menos', () => {
    expect(estadoDistanciaVecino(300)).toBe('alerta');
    expect(estadoDistanciaVecino(0)).toBe('alerta');
  });
});

describe('decidirAlertaVecino', () => {
  it('habla al cruzar a alerta y se desarma', () => {
    expect(decidirAlertaVecino(290, true)).toEqual({ hablar: true, armada: false });
  });
  it('no repite mientras siga en alerta ni con jitter entre 300 y 350', () => {
    expect(decidirAlertaVecino(280, false)).toEqual({ hablar: false, armada: false });
    expect(decidirAlertaVecino(340, false)).toEqual({ hablar: false, armada: false });
    expect(decidirAlertaVecino(350, false)).toEqual({ hablar: false, armada: false });
  });
  it('se re-arma por encima de 350 m y vuelve a hablar', () => {
    const r = decidirAlertaVecino(351, false);
    expect(r).toEqual({ hablar: false, armada: true });
    expect(decidirAlertaVecino(299, r.armada).hablar).toBe(true);
  });
  it('armada y fuera de alerta no habla; null no cambia nada', () => {
    expect(decidirAlertaVecino(400, true)).toEqual({ hablar: false, armada: true });
    expect(decidirAlertaVecino(null, false)).toEqual({ hablar: false, armada: false });
  });
});

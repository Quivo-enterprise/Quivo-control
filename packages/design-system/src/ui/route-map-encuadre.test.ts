import { describe, expect, it } from 'vitest';
import {
  encuadreAuto,
  encuadreUnaVez,
  estadoEncuadreAutoInicial,
  estadoEncuadreUnaVezInicial,
} from './route-map-encuadre.js';

describe('encuadreAuto', () => {
  it('encuadra cuando cambia la firma y no cuando se repite', () => {
    const primero = encuadreAuto({
      firma: 'a',
      hayPuntos: true,
      estado: estadoEncuadreAutoInicial(),
    });
    expect(primero.encuadrar).toBe(true);
    const igual = encuadreAuto({ firma: 'a', hayPuntos: true, estado: primero.estado });
    expect(igual.encuadrar).toBe(false);
    const cambio = encuadreAuto({ firma: 'b', hayPuntos: true, estado: igual.estado });
    expect(cambio.encuadrar).toBe(true);
  });

  it('no encuadra sin puntos', () => {
    const r = encuadreAuto({ firma: '', hayPuntos: false, estado: estadoEncuadreAutoInicial() });
    expect(r.encuadrar).toBe(false);
  });

  it('A -> [] -> A reencuadra', () => {
    const a = encuadreAuto({ firma: 'a', hayPuntos: true, estado: estadoEncuadreAutoInicial() });
    const vacio = encuadreAuto({ firma: '', hayPuntos: false, estado: a.estado });
    expect(vacio.encuadrar).toBe(false);
    const deNuevoA = encuadreAuto({ firma: 'a', hayPuntos: true, estado: vacio.estado });
    expect(deNuevoA.encuadrar).toBe(true);
  });
});

describe('encuadreUnaVez', () => {
  it('encuadra en cuanto aparecen puntos y no antes', () => {
    const vacio = encuadreUnaVez({
      fitKey: 0,
      hayPuntos: false,
      estado: estadoEncuadreUnaVezInicial(0),
    });
    expect(vacio.encuadrar).toBe(false);
    const conPuntos = encuadreUnaVez({ fitKey: 0, hayPuntos: true, estado: vacio.estado });
    expect(conPuntos.encuadrar).toBe(true);
  });

  it('los cambios de marcadores no lo afectan (no recibe firma): no reencuadra', () => {
    const primero = encuadreUnaVez({
      fitKey: 0,
      hayPuntos: true,
      estado: estadoEncuadreUnaVezInicial(0),
    });
    expect(primero.encuadrar).toBe(true);
    let estado = primero.estado;
    for (let i = 0; i < 3; i++) {
      const r = encuadreUnaVez({ fitKey: 0, hayPuntos: true, estado });
      expect(r.encuadrar).toBe(false);
      estado = r.estado;
    }
  });

  it('reencuadra una vez cuando cambia fitKey', () => {
    const primero = encuadreUnaVez({
      fitKey: 0,
      hayPuntos: true,
      estado: estadoEncuadreUnaVezInicial(0),
    });
    const tras = encuadreUnaVez({ fitKey: 1, hayPuntos: true, estado: primero.estado });
    expect(tras.encuadrar).toBe(true);
    const otraVez = encuadreUnaVez({ fitKey: 1, hayPuntos: true, estado: tras.estado });
    expect(otraVez.encuadrar).toBe(false);
  });

  it('si cambia fitKey sin puntos, difiere el encuadre hasta que haya puntos', () => {
    const primero = encuadreUnaVez({
      fitKey: 0,
      hayPuntos: true,
      estado: estadoEncuadreUnaVezInicial(0),
    });
    const sinPuntos = encuadreUnaVez({ fitKey: 1, hayPuntos: false, estado: primero.estado });
    expect(sinPuntos.encuadrar).toBe(false);
    const conPuntos = encuadreUnaVez({ fitKey: 1, hayPuntos: true, estado: sinPuntos.estado });
    expect(conPuntos.encuadrar).toBe(true);
  });
});

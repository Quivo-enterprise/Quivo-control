import { describe, expect, it } from 'vitest';
import { debeEncuadrar, estadoEncuadreInicial } from './route-map-encuadre.js';

describe("debeEncuadrar — modo 'once'", () => {
  it('encuadra la primera vez que hay puntos', () => {
    const r = debeEncuadrar({ modo: 'once', firma: 'a', hayPuntos: true, fitKey: 0, estado: estadoEncuadreInicial(0) });
    expect(r.encuadrar).toBe(true);
  });

  it('no reencuadra cuando cambian los marcadores (respeta el zoom del usuario)', () => {
    const primero = debeEncuadrar({ modo: 'once', firma: 'a', hayPuntos: true, fitKey: 0, estado: estadoEncuadreInicial(0) });
    const segundo = debeEncuadrar({ modo: 'once', firma: 'b', hayPuntos: true, fitKey: 0, estado: primero.estado });
    expect(segundo.encuadrar).toBe(false);
  });

  it('reencuadra una vez cuando cambia fitKey (botón Reencuadrar)', () => {
    const primero = debeEncuadrar({ modo: 'once', firma: 'a', hayPuntos: true, fitKey: 0, estado: estadoEncuadreInicial(0) });
    const tras = debeEncuadrar({ modo: 'once', firma: 'a', hayPuntos: true, fitKey: 1, estado: primero.estado });
    expect(tras.encuadrar).toBe(true);
    const otraVez = debeEncuadrar({ modo: 'once', firma: 'b', hayPuntos: true, fitKey: 1, estado: tras.estado });
    expect(otraVez.encuadrar).toBe(false);
  });

  it('no dispara sin puntos y dispara en cuanto aparecen', () => {
    const vacio = debeEncuadrar({ modo: 'once', firma: '', hayPuntos: false, fitKey: 0, estado: estadoEncuadreInicial(0) });
    expect(vacio.encuadrar).toBe(false);
    const conPuntos = debeEncuadrar({ modo: 'once', firma: 'a', hayPuntos: true, fitKey: 0, estado: vacio.estado });
    expect(conPuntos.encuadrar).toBe(true);
  });
});

describe("debeEncuadrar — modo 'auto'", () => {
  it('encuadra cuando cambia la firma', () => {
    const inicial = estadoEncuadreInicial(undefined);
    const primero = debeEncuadrar({ modo: 'auto', firma: 'a', hayPuntos: true, fitKey: undefined, estado: inicial });
    expect(primero.encuadrar).toBe(true);
    const igual = debeEncuadrar({ modo: 'auto', firma: 'a', hayPuntos: true, fitKey: undefined, estado: primero.estado });
    expect(igual.encuadrar).toBe(false);
    const cambio = debeEncuadrar({ modo: 'auto', firma: 'b', hayPuntos: true, fitKey: undefined, estado: igual.estado });
    expect(cambio.encuadrar).toBe(true);
  });

  it('no encuadra sin puntos', () => {
    const r = debeEncuadrar({ modo: 'auto', firma: '', hayPuntos: false, fitKey: undefined, estado: estadoEncuadreInicial(undefined) });
    expect(r.encuadrar).toBe(false);
  });
});

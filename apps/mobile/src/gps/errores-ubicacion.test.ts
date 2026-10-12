import { describe, expect, it } from 'vitest';
import {
  clasificarErrorUbicacion,
  codigoDeErrorUbicacion,
  reducirSenalGps,
} from './errores-ubicacion';

describe('clasificarErrorUbicacion', () => {
  it.each([408, 0, 2, 499])('código %i: transitorio, sin mensaje', (code) => {
    expect(clasificarErrorUbicacion(code)).toEqual({ tipo: 'transitorio', mensaje: null });
  });

  it('código 1: permanente, pide activar el permiso en Ajustes', () => {
    expect(clasificarErrorUbicacion(1)).toEqual({
      tipo: 'permanente',
      mensaje:
        'Quivo no tiene permiso de ubicación. Actívalo en Ajustes para registrar el recorrido.',
    });
  });

  it('código 3: permanente, pide "Permitir siempre"', () => {
    expect(clasificarErrorUbicacion(3)).toEqual({
      tipo: 'permanente',
      mensaje:
        "La ubicación está en 'Solo mientras se usa'. Cámbiala a 'Permitir siempre' para registrar con la pantalla apagada.",
    });
  });

  it.each([999, 500, 4, -1, null, undefined])('código %s: desconocido, sin mensaje', (code) => {
    expect(clasificarErrorUbicacion(code)).toEqual({ tipo: 'desconocido', mensaje: null });
  });
});

describe('codigoDeErrorUbicacion', () => {
  it('lee número, objeto con code y devuelve null para lo demás', () => {
    expect(codigoDeErrorUbicacion(408)).toBe(408);
    expect(codigoDeErrorUbicacion({ code: 1 })).toBe(1);
    expect(codigoDeErrorUbicacion(new Error('x'))).toBeNull();
    expect(codigoDeErrorUbicacion('408')).toBeNull();
    expect(codigoDeErrorUbicacion(null)).toBeNull();
  });
});

describe('reducirSenalGps', () => {
  it('un error transitorio activa la señal débil', () => {
    expect(reducirSenalGps(false, 'error_transitorio')).toBe(true);
    expect(reducirSenalGps(true, 'error_transitorio')).toBe(true);
  });

  it('un fix válido posterior la limpia', () => {
    expect(reducirSenalGps(true, 'fix_valido')).toBe(false);
  });

  it('detener el tracking la limpia', () => {
    expect(reducirSenalGps(true, 'tracking_detenido')).toBe(false);
  });

  it('sin errores, un fix válido mantiene falso (parada sin fixes no es señal débil)', () => {
    expect(reducirSenalGps(false, 'fix_valido')).toBe(false);
  });
});

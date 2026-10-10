import { describe, expect, it } from 'vitest';
import { MOTOR_MAPA_DEFAULT, alternarMotorMapa, etiquetaMotorMapa, spikeHabilitado } from './spike-motor-mapa';

describe('spikeHabilitado', () => {
  it('es false sin EXPO_PUBLIC_SPIKE', () => {
    expect(spikeHabilitado(undefined)).toBe(false);
  });

  it('es false con cualquier valor que no sea el string "1"', () => {
    expect(spikeHabilitado('true')).toBe(false);
    expect(spikeHabilitado('0')).toBe(false);
  });

  it('es true solo con EXPO_PUBLIC_SPIKE === "1"', () => {
    expect(spikeHabilitado('1')).toBe(true);
  });
});

describe('MOTOR_MAPA_DEFAULT', () => {
  it('es siempre leaflet — invariante "fuera del spike, cero cambio de comportamiento"', () => {
    expect(MOTOR_MAPA_DEFAULT).toBe('leaflet');
  });
});

describe('alternarMotorMapa', () => {
  it('pasa de leaflet a google', () => {
    expect(alternarMotorMapa('leaflet')).toBe('google');
  });

  it('pasa de google a leaflet', () => {
    expect(alternarMotorMapa('google')).toBe('leaflet');
  });

  it('alternar dos veces vuelve al motor original', () => {
    expect(alternarMotorMapa(alternarMotorMapa('leaflet'))).toBe('leaflet');
  });
});

describe('etiquetaMotorMapa', () => {
  it('con leaflet activo, ofrece cambiar a Google', () => {
    expect(etiquetaMotorMapa('leaflet')).toBe('Google');
  });

  it('con google activo, ofrece cambiar a Leaflet', () => {
    expect(etiquetaMotorMapa('google')).toBe('Leaflet');
  });
});

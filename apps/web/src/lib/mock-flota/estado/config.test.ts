import { describe, expect, it } from 'vitest';
import { configDe, configInicial, guardarConfigLinea, paradasDe, puntosControlActivosDe, validarConfigLinea } from './config';
import { estadoInicial } from './index';
import { LINEAS_MOCK } from '../datos';
import type { ConfigLineaInput } from '../tipos';

const AHORA = new Date('2026-09-27T12:00:00-04:00');

function configValidaDeZ12(): ConfigLineaInput {
  const config = configInicial().z12;
  return { frecuenciaMin: config.frecuenciaMin, horaInicio: config.horaInicio, horaFin: config.horaFin, paradas: config.paradas };
}

describe('validarConfigLinea', () => {
  it('acepta una config válida (sin errores)', () => {
    expect(validarConfigLinea(configValidaDeZ12())).toEqual([]);
  });

  it('rechaza frecuencia fuera de [3, 60]', () => {
    expect(validarConfigLinea({ ...configValidaDeZ12(), frecuenciaMin: 2 }).length).toBeGreaterThan(0);
    expect(validarConfigLinea({ ...configValidaDeZ12(), frecuenciaMin: 61 }).length).toBeGreaterThan(0);
  });

  it('acepta los límites 3 y 60', () => {
    expect(validarConfigLinea({ ...configValidaDeZ12(), frecuenciaMin: 3 })).toEqual([]);
    expect(validarConfigLinea({ ...configValidaDeZ12(), frecuenciaMin: 60 })).toEqual([]);
  });

  it('rechaza horaInicio >= horaFin', () => {
    const errores = validarConfigLinea({ ...configValidaDeZ12(), horaInicio: '10:00', horaFin: '10:00' });
    expect(errores.length).toBeGreaterThan(0);
    const errores2 = validarConfigLinea({ ...configValidaDeZ12(), horaInicio: '22:00', horaFin: '05:00' });
    expect(errores2.length).toBeGreaterThan(0);
  });

  it('rechaza formato de hora inválido', () => {
    expect(validarConfigLinea({ ...configValidaDeZ12(), horaInicio: '5:00', horaFin: '22:00' }).length).toBeGreaterThan(0);
  });

  // ==============================================================================================
  // Ítem 14 del guion delegado: validación por parada (nombre y radio de tolerancia).
  // ==============================================================================================

  it('rechaza un nombre de parada vacío (o solo espacios)', () => {
    const config = configValidaDeZ12();
    const objetivo = config.paradas[0]!.id;
    const invalida = { ...config, paradas: config.paradas.map((p) => (p.id === objetivo ? { ...p, nombre: '   ' } : p)) };
    expect(validarConfigLinea(invalida).length).toBeGreaterThan(0);
  });

  it('rechaza un nombre de parada de más de 40 caracteres', () => {
    const config = configValidaDeZ12();
    const objetivo = config.paradas[0]!.id;
    const nombreLargo = 'x'.repeat(41);
    const invalida = { ...config, paradas: config.paradas.map((p) => (p.id === objetivo ? { ...p, nombre: nombreLargo } : p)) };
    expect(validarConfigLinea(invalida).length).toBeGreaterThan(0);
  });

  it('acepta un nombre de exactamente 40 caracteres', () => {
    const config = configValidaDeZ12();
    const objetivo = config.paradas[0]!.id;
    const nombre40 = 'x'.repeat(40);
    const valida = { ...config, paradas: config.paradas.map((p) => (p.id === objetivo ? { ...p, nombre: nombre40 } : p)) };
    expect(validarConfigLinea(valida)).toEqual([]);
  });

  it('rechaza un radio de tolerancia fuera de [20, 300] SOLO si la parada es punto de control', () => {
    const config = configValidaDeZ12();
    const puntoControl = config.paradas.find((p) => p.esPuntoControl)!;
    const noPuntoControl = config.paradas.find((p) => !p.esPuntoControl)!;

    const conRadioMalo = (paradaId: string, radio: number): ConfigLineaInput => ({
      ...config,
      paradas: config.paradas.map((p) => (p.id === paradaId ? { ...p, radioToleranciaM: radio } : p)),
    });

    expect(validarConfigLinea(conRadioMalo(puntoControl.id, 19)).length).toBeGreaterThan(0);
    expect(validarConfigLinea(conRadioMalo(puntoControl.id, 301)).length).toBeGreaterThan(0);
    expect(validarConfigLinea(conRadioMalo(puntoControl.id, 20.5)).length).toBeGreaterThan(0); // no entero
    // Una parada que NO es punto de control puede tener cualquier radio (no se usa) sin que
    // rompa la validación.
    expect(validarConfigLinea(conRadioMalo(noPuntoControl.id, 5))).toEqual([]);
  });

  it('acepta los límites 20 y 300 en un punto de control', () => {
    const config = configValidaDeZ12();
    const puntoControl = config.paradas.find((p) => p.esPuntoControl)!;
    const conRadio = (radio: number): ConfigLineaInput => ({
      ...config,
      paradas: config.paradas.map((p) => (p.id === puntoControl.id ? { ...p, radioToleranciaM: radio } : p)),
    });
    expect(validarConfigLinea(conRadio(20))).toEqual([]);
    expect(validarConfigLinea(conRadio(300))).toEqual([]);
  });
});

describe('paradasDe (ítem 14)', () => {
  it('sin ediciones, coincide con `LINEAS_MOCK[lineaId].paradas`', () => {
    const estado = estadoInicial(AHORA);
    expect(paradasDe(estado, 'z12')).toEqual(LINEAS_MOCK.z12.paradas);
  });

  it('después de `guardarConfigLinea`, refleja el nombre/esPuntoControl/radioToleranciaM editados', () => {
    const estado = estadoInicial(AHORA);
    const config = configDe(estado, 'z12');
    const objetivo = config.paradas[0]!.id;
    const nuevaConfig: ConfigLineaInput = {
      frecuenciaMin: config.frecuenciaMin,
      horaInicio: config.horaInicio,
      horaFin: config.horaFin,
      paradas: config.paradas.map((p) => (p.id === objetivo ? { ...p, nombre: 'Nombre Editado' } : p)),
    };
    const siguiente = guardarConfigLinea(estado, 'z12', nuevaConfig);
    const parada = paradasDe(siguiente, 'z12').find((p) => p.id === objetivo)!;
    expect(parada.nombre).toBe('Nombre Editado');
    // La geometría fija (lat/lng/orden/avance) NO cambia con la config.
    const original = LINEAS_MOCK.z12.paradas.find((p) => p.id === objetivo)!;
    expect(parada.lat).toBe(original.lat);
    expect(parada.lng).toBe(original.lng);
    expect(parada.avance).toBe(original.avance);
  });
});

describe('guardarConfigLinea', () => {
  it('con input válido, reemplaza la config de la línea', () => {
    const estado = estadoInicial(AHORA);
    const nuevaConfig: ConfigLineaInput = { ...configValidaDeZ12(), frecuenciaMin: 15 };
    const siguiente = guardarConfigLinea(estado, 'z12', nuevaConfig);
    expect(configDe(siguiente, 'z12').frecuenciaMin).toBe(15);
  });

  it('con input INVÁLIDO, el reducer lo ignora (estado sin cambios)', () => {
    const estado = estadoInicial(AHORA);
    const invalida: ConfigLineaInput = { ...configValidaDeZ12(), frecuenciaMin: 999 };
    const siguiente = guardarConfigLinea(estado, 'z12', invalida);
    expect(siguiente).toBe(estado);
  });

  it('desactivar un punto de control hace que `puntosControlActivosDe` deje de listarlo', () => {
    const estado = estadoInicial(AHORA);
    const antes = puntosControlActivosDe(estado, 'z12');
    expect(antes.length).toBeGreaterThan(0);
    const objetivo = antes[0]!.id;

    const config = configDe(estado, 'z12');
    const nuevaConfig: ConfigLineaInput = {
      frecuenciaMin: config.frecuenciaMin,
      horaInicio: config.horaInicio,
      horaFin: config.horaFin,
      paradas: config.paradas.map((p) => (p.id === objetivo ? { ...p, esPuntoControl: false } : p)),
    };
    const siguiente = guardarConfigLinea(estado, 'z12', nuevaConfig);
    const despues = puntosControlActivosDe(siguiente, 'z12');
    expect(despues.find((p) => p.id === objetivo)).toBeUndefined();
    expect(despues.length).toBe(antes.length - 1);
  });
});

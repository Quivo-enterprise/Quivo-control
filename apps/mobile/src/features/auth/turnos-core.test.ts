import { describe, expect, it } from 'vitest';
import {
  buscarProximaAsignacion,
  formatearTiempoRelativo,
  formatearTiempoRelativoAccesible,
  ordenarAsignaciones,
  resolverIconoTurno,
  resolverNombreLinea,
} from './turnos-core';

const ahora = Date.parse('2026-10-26T15:00:00.000Z');

describe('turnos-core', () => {
  it('ordena primero las salidas por hora y deja las ausentes al final', () => {
    const asignaciones = [
      { id: 'sin-hora', horaSalida: null },
      { id: 'tarde', horaSalida: '2026-10-26T20:00:00.000Z' },
      { id: 'pasada', horaSalida: '2026-10-26T14:00:00.000Z' },
    ];

    expect(ordenarAsignaciones(asignaciones).map(({ id }) => id)).toEqual([
      'pasada',
      'tarde',
      'sin-hora',
    ]);
  });

  it('elige solo la salida futura más próxima', () => {
    const asignaciones = [
      { id: 'pasada', horaSalida: '2026-10-26T14:00:00.000Z' },
      { id: 'futura-lejana', horaSalida: '2026-10-26T20:00:00.000Z' },
      { id: 'futura-cercana', horaSalida: '2026-10-26T16:00:00.000Z' },
      { id: 'sin-hora', horaSalida: null },
    ];

    expect(buscarProximaAsignacion(asignaciones, ahora)).toBe('futura-cercana');
    expect(buscarProximaAsignacion([asignaciones[0]!], ahora)).toBeNull();
  });

  it('formatea el tiempo restante y el tiempo transcurrido en minutos', () => {
    expect(
      formatearTiempoRelativo(new Date(ahora + 6 * 60 * 60_000 + 17 * 60_000).toISOString(), ahora),
    ).toBe('en 6 h 17 min');
    expect(formatearTiempoRelativo(new Date(ahora - 43 * 60_000).toISOString(), ahora)).toBe(
      'hace 43 min',
    );
    expect(formatearTiempoRelativo(null, ahora)).toBeNull();
  });

  it('expande el tiempo relativo para la etiqueta accesible', () => {
    const salida = new Date(ahora + 6 * 60 * 60_000 + 17 * 60_000).toISOString();
    expect(formatearTiempoRelativoAccesible(salida, ahora)).toBe('en 6 horas 17 minutos');
  });

  it('mapea cada turno a su icono', () => {
    expect(resolverIconoTurno('manana')).toBe('sunny');
    expect(resolverIconoTurno('tarde')).toBe('partly-sunny');
    expect(resolverIconoTurno('noche')).toBe('moon');
  });

  it('omite el nombre que solo repite el código de línea', () => {
    expect(resolverNombreLinea('120', 'Línea 120')).toBeNull();
    expect(resolverNombreLinea('120', 'Cercado')).toBe('Cercado');
  });
});

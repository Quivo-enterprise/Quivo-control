import { describe, expect, it } from 'vitest';
import { debeSolicitarPermisoActividad, estadoPermisoActividadDesde } from './permiso-actividad';

/**
 * QUI-P0: tests del módulo puro de decisión del permiso `ACTIVITY_RECOGNITION` (ver el
 * docblock de `permiso-actividad.ts` para el porqué de fail-open y de la ventana Android
 * 10+/API 29+). Mismo patrón que `permiso-ubicacion.test.ts`.
 */
describe('debeSolicitarPermisoActividad', () => {
  it('Android 10 (API 29, el piso exacto donde el permiso pasó a "dangerous"): sí corresponde pedirlo', () => {
    expect(debeSolicitarPermisoActividad('android', 29)).toBe(true);
  });

  it('Android 9 (API 28, un paso por debajo del piso): NO corresponde — se concede solo por manifest', () => {
    expect(debeSolicitarPermisoActividad('android', 28)).toBe(false);
  });

  it('Android 14 (API 34, muy por encima del piso): sí corresponde', () => {
    expect(debeSolicitarPermisoActividad('android', 34)).toBe(true);
  });

  it('iOS: nunca corresponde, sea cual sea el "sdkInt" — el equivalente lo gestiona el propio módulo nativo', () => {
    expect(debeSolicitarPermisoActividad('ios', 29)).toBe(false);
    expect(debeSolicitarPermisoActividad('ios', 34)).toBe(false);
  });
});

describe('estadoPermisoActividadDesde', () => {
  it('"granted" mapea a "concedido"', () => {
    expect(estadoPermisoActividadDesde('granted')).toBe('concedido');
  });

  it('"denied" mapea a "denegado"', () => {
    expect(estadoPermisoActividadDesde('denied')).toBe('denegado');
  });

  it('"never_ask_again" mapea a "denegado" — mismo tratamiento fail-open que "denied", no hay acción distinta que ofrecer', () => {
    expect(estadoPermisoActividadDesde('never_ask_again')).toBe('denegado');
  });

  it('cualquier valor no reconocido (defensivo, otra versión del módulo nativo) cae a "denegado", nunca a "concedido"', () => {
    expect(estadoPermisoActividadDesde('algo-inesperado')).toBe('denegado');
  });
});

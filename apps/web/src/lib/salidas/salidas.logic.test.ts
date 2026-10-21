import { CrearFrecuenciaReglaSchema } from '@quivo/shared';
import { describe, expect, it } from 'vitest';
import {
  estadoVisualFila,
  formatearCuenta,
  horaAMinutos,
  fechaCorta,
  hastaMinDeFormulario,
  mensajesReglaPorCampo,
  minutosAHora,
  offsetServidorMs,
  restanteMs,
  textoAlcance,
  textoFranja,
} from './salidas.logic';

describe('horaAMinutos / minutosAHora', () => {
  it('convierte ida y vuelta', () => {
    expect(horaAMinutos('08:30')).toBe(510);
    expect(horaAMinutos('0:05')).toBe(5);
    expect(minutosAHora(510)).toBe('08:30');
    expect(minutosAHora(1440)).toBe('24:00');
  });
  it('rechaza horas inválidas', () => {
    expect(horaAMinutos('24:00')).toBeNull();
    expect(horaAMinutos('12:60')).toBeNull();
    expect(horaAMinutos('abc')).toBeNull();
    expect(horaAMinutos('')).toBeNull();
  });
});

describe('fechaCorta', () => {
  it('formatea DD/MM sin tocar zona horaria', () => {
    expect(fechaCorta('2026-10-21')).toBe('21/10');
    expect(fechaCorta('raro')).toBe('raro');
  });
});

describe('hastaMinDeFormulario', () => {
  it('hasta fin del día vale 1440 aunque el input esté vacío', () => {
    expect(hastaMinDeFormulario('', true)).toBe(1440);
    expect(hastaMinDeFormulario('10:30', true)).toBe(1440);
  });
  it('sin checkbox usa la hora o null', () => {
    expect(hastaMinDeFormulario('10:30', false)).toBe(630);
    expect(hastaMinDeFormulario('', false)).toBeNull();
  });
  it('el schema acepta 1440 como fin de franja', () => {
    expect(
      CrearFrecuenciaReglaSchema.safeParse({ alcance: 'todos', minutos: 10, desdeMin: 1200, hastaMin: 1440 }).success,
    ).toBe(true);
  });
});

describe('mensajesReglaPorCampo', () => {
  const lim = { min: 1, max: 120 };
  const base = { alcance: 'todos', minutos: 10 } as const;
  it('rango invertido se mapea por path y valores, no por el texto', () => {
    const r = CrearFrecuenciaReglaSchema.safeParse({ ...base, desdeMin: 600, hastaMin: 480 });
    expect(r.success).toBe(false);
    if (!r.success) {
      const m = mensajesReglaPorCampo(r.error.issues, { alcance: 'todos', desdeMin: 600, hastaMin: 480 }, lim);
      expect(m.hastaMin).toContain('posterior');
    }
  });
  it('franja incompleta pide ambos extremos', () => {
    const r = CrearFrecuenciaReglaSchema.safeParse({ ...base, desdeMin: 600, hastaMin: null });
    if (r.success) throw new Error('debía fallar');
    const m = mensajesReglaPorCampo(r.error.issues, { alcance: 'todos', desdeMin: 600, hastaMin: null }, lim);
    expect(m.hastaMin).toContain('Completá');
  });
  it('alcance grupo sin grupo marca el campo grupoId', () => {
    const r = CrearFrecuenciaReglaSchema.safeParse({ ...base, alcance: 'grupo' });
    if (r.success) throw new Error('debía fallar');
    const m = mensajesReglaPorCampo(r.error.issues, { alcance: 'grupo', desdeMin: null, hastaMin: null }, lim);
    expect(m.grupoId).toBe('Elegí un grupo.');
  });
});

describe('cuenta regresiva con offset de servidor', () => {
  it('usa el reloj del servidor, no el del navegador', () => {
    const recibido = 1_000_000;
    // El servidor va 10 min adelantado respecto del navegador.
    const offset = offsetServidorMs(new Date(recibido + 600_000).toISOString(), recibido);
    expect(offset).toBe(600_000);
    const eta = new Date(recibido + 600_000 + 90_000).toISOString();
    expect(restanteMs(eta, offset, recibido)).toBe(90_000);
    expect(restanteMs(eta, offset, recibido + 30_000)).toBe(60_000);
  });
  it('formatea m:ss, h:mm:ss y demora con +', () => {
    expect(formatearCuenta(65_000)).toBe('1:05');
    expect(formatearCuenta(3_725_000)).toBe('1:02:05');
    expect(formatearCuenta(0)).toBe('0:00');
    expect(formatearCuenta(-12_000)).toBe('+0:12');
  });
});

describe('estadoVisualFila', () => {
  it('prioriza demorado sobre en turno', () => {
    expect(estadoVisualFila({ demorado: true, habilitado: true })).toBe('demorado');
    expect(estadoVisualFila({ demorado: false, habilitado: true })).toBe('en_turno');
    expect(estadoVisualFila({ demorado: false, habilitado: false })).toBe('esperando');
  });
});

describe('textos de regla', () => {
  it('franja', () => {
    expect(textoFranja(null, null)).toBe('Todo el día');
    expect(textoFranja(480, 630)).toBe('08:00–10:30');
  });
  it('alcance', () => {
    const grupos = [{ id: 'g1', nombre: 'Trufis A' }];
    expect(textoAlcance({ alcance: 'todos', grupoId: null, vehiculoId: null }, grupos, {})).toBe('Todos los trufis');
    expect(textoAlcance({ alcance: 'grupo', grupoId: 'g1', vehiculoId: null }, grupos, {})).toBe('Grupo Trufis A');
    expect(textoAlcance({ alcance: 'vehiculo', grupoId: null, vehiculoId: 'v1' }, grupos, { v1: '1234ABC' })).toBe(
      'Trufi 1234ABC',
    );
  });
});

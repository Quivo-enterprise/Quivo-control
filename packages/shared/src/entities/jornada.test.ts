import { describe, expect, it } from 'vitest';
import {
  EstadoJornadaSchema,
  JornadaVehiculoSchema,
  JornadasDelDiaSchema,
  JornadasQuerySchema,
} from './jornada.js';

const JORNADA = {
  sindicatoId: '2d9a5e3c-4b6f-4e0a-9c73-8f4b3a0d9e56',
  sindicatoNombre: 'Sindicato Test',
  vehiculoId: '0b7e3c1a-2f4d-4c8e-9a51-6d2f1e8b7c34',
  placa: '1234ABC',
  numeroInterno: null,
  conductorNombre: null,
  lineaId: '1c8f4d2b-3a5e-4d9f-8b62-7e3a2f9c8d45',
  lineaNombre: 'Línea 120',
  rutaSentido: 'ida',
  horaSalida: '2026-10-10T12:00:00.000Z',
  estado: 'sin_iniciar',
  inicioJornadaTs: null,
};

describe('EstadoJornadaSchema', () => {
  it('acepta los cuatro estados y rechaza otros', () => {
    for (const e of ['sin_iniciar', 'dia_iniciado', 'en_recorrido', 'finalizado']) {
      expect(EstadoJornadaSchema.safeParse(e).success).toBe(true);
    }
    expect(EstadoJornadaSchema.safeParse('pausado').success).toBe(false);
  });
});

describe('JornadaVehiculoSchema', () => {
  it('acepta una jornada válida', () => {
    expect(JornadaVehiculoSchema.safeParse(JORNADA).success).toBe(true);
  });

  it('no valida el formato de la placa (placas legacy) y horaSalida sigue siendo string', () => {
    const r = JornadaVehiculoSchema.parse({ ...JORNADA, placa: 'ABC123' });
    expect(r.placa).toBe('ABC123');
    expect(typeof r.horaSalida).toBe('string');
    expect(JornadaVehiculoSchema.safeParse({ ...JORNADA, placa: '' }).success).toBe(false);
  });

  it('acepta horaSalida nula e inicioJornadaTs con valor', () => {
    expect(
      JornadaVehiculoSchema.safeParse({
        ...JORNADA,
        horaSalida: null,
        estado: 'dia_iniciado',
        inicioJornadaTs: '2026-10-10T11:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('la respuesta no reusa validadores de entrada: sentido vacío o de 60 caracteres', () => {
    expect(JornadaVehiculoSchema.safeParse({ ...JORNADA, rutaSentido: '' }).success).toBe(true);
    expect(
      JornadaVehiculoSchema.safeParse({ ...JORNADA, rutaSentido: 'x'.repeat(60) }).success,
    ).toBe(true);
    expect(
      JornadasDelDiaSchema.safeParse({
        fecha: '2026-10-10',
        vehiculos: [{ ...JORNADA, rutaSentido: '' }],
      }).success,
    ).toBe(true);
  });

  it('exige sindicatoId uuid y sindicatoNombre', () => {
    expect(JornadaVehiculoSchema.safeParse({ ...JORNADA, sindicatoId: 'x' }).success).toBe(false);
    expect(
      JornadaVehiculoSchema.safeParse({ ...JORNADA, sindicatoNombre: undefined }).success,
    ).toBe(false);
  });

  it('rechaza vehiculoId no uuid', () => {
    expect(JornadaVehiculoSchema.safeParse({ ...JORNADA, vehiculoId: 'x' }).success).toBe(false);
  });
});

describe('JornadasDelDiaSchema / JornadasQuerySchema', () => {
  it('valida fecha YYYY-MM-DD y lista de vehículos', () => {
    expect(
      JornadasDelDiaSchema.safeParse({ fecha: '2026-10-10', vehiculos: [JORNADA] }).success,
    ).toBe(true);
    expect(JornadasDelDiaSchema.safeParse({ fecha: '10/10/2026', vehiculos: [] }).success).toBe(
      false,
    );
  });

  it('la query acepta fecha opcional', () => {
    expect(JornadasQuerySchema.safeParse({}).success).toBe(true);
    expect(JornadasQuerySchema.safeParse({ fecha: '2026-10-10' }).success).toBe(true);
    expect(JornadasQuerySchema.safeParse({ fecha: 'hoy' }).success).toBe(false);
  });

  it('la query rechaza fechas inexistentes en el calendario y acepta las reales', () => {
    expect(JornadasQuerySchema.safeParse({ fecha: '2026-02-31' }).success).toBe(false);
    expect(JornadasQuerySchema.safeParse({ fecha: '2026-02-28' }).success).toBe(true);
    expect(JornadasQuerySchema.safeParse({ fecha: '2028-02-29' }).success).toBe(true);
    expect(JornadasQuerySchema.safeParse({ fecha: '2026-02-29' }).success).toBe(false);
  });
});

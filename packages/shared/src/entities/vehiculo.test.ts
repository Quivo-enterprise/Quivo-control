import { describe, expect, it } from 'vitest';
import {
  CrearVehiculoSchema,
  ModeloVehiculoSchema,
  PlacaVehiculoSchema,
  normalizarPlacaVehiculo,
} from './vehiculo.js';

const vehiculoValido = {
  sindicatoId: 'aaaaaaaa-0000-4000-8000-000000000001',
  socioId: null,
  placa: '123 - abc',
  tipo: 'minibus',
  marca: 'Mercedes-Benz',
  modelo: 'OF-1721',
  color: 'blanco',
  colorSecundario: null,
  capacidad: 24,
};

describe('contrato de Vehículo', () => {
  it('normaliza espacios, guiones y mayúsculas de la placa', () => {
    expect(normalizarPlacaVehiculo(' 123 - abc ')).toBe('123ABC');
  });

  it('crea siempre en estado pendiente por defecto', () => {
    expect(CrearVehiculoSchema.parse(vehiculoValido).estado).toBe('pendiente');
  });

  it('rechaza símbolos no permitidos en la placa', () => {
    expect(CrearVehiculoSchema.safeParse({ ...vehiculoValido, placa: 'ABC🚐123' }).success).toBe(
      false,
    );
  });

  it.each(['123ABC', '1234ABC', '123 - abc', '1234 abc'])(
    'acepta la placa boliviana actual %s',
    (placa) => {
      expect(PlacaVehiculoSchema.safeParse(placa).success).toBe(true);
    },
  );

  it.each(['12ABC', '12345ABC', 'ABC123', '12A3ABC', '123AB1', '1234ABCD'])(
    'rechaza la estructura de placa no vigente %s',
    (placa) => {
      expect(PlacaVehiculoSchema.safeParse(placa).success).toBe(false);
    },
  );

  it('explica cuando se ingresó una placa anterior al reemplaque', () => {
    const parsed = PlacaVehiculoSchema.safeParse('ABC123');
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.message).toContain('formato anterior');
  });

  it('acepta modelos alfanuméricos usados en transporte', () => {
    expect(ModeloVehiculoSchema.parse('Coaster 4.2/GL')).toBe('Coaster 4.2/GL');
  });
});

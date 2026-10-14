import { describe, expect, it } from 'vitest';
import { ActualizarConductorSchema, ConductorSchema, CrearConductorSchema } from './conductor.js';

const ID = '11111111-1111-4111-8111-111111111111';

describe('telefono en conductor', () => {
  it('la lectura es tolerante: un valor guardado inválido no falla', () => {
    const row = {
      id: ID,
      sindicatoId: ID,
      nombre: 'Juan',
      documentoIdentidad: '1234567',
      licenciaConducir: '1234567',
      estado: 'activo',
      telefono: '44123456',
    };
    expect(ConductorSchema.parse(row).telefono).toBe('44123456');
    expect(ConductorSchema.parse({ ...row, telefono: null }).telefono).toBeNull();
  });

  it('actualizar: sin campo conserva, vacío/null limpian, inválido rechaza', () => {
    expect(ActualizarConductorSchema.parse({}).telefono).toBeUndefined();
    expect(ActualizarConductorSchema.parse({ telefono: '' }).telefono).toBeNull();
    expect(ActualizarConductorSchema.parse({ telefono: null }).telefono).toBeNull();
    expect(ActualizarConductorSchema.parse({ telefono: '7123 4567' }).telefono).toBe('+59171234567');
    expect(ActualizarConductorSchema.safeParse({ telefono: '44123456' }).success).toBe(false);
  });

  it('crear: telefono es opcional y se valida', () => {
    const base = {
      sindicatoId: ID,
      nombre: 'Juan Perez',
      documentoIdentidad: '1234567',
      licenciaConducir: '1234567',
    };
    expect(CrearConductorSchema.safeParse(base).success).toBe(true);
    expect(CrearConductorSchema.safeParse({ ...base, telefono: '123' }).success).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  DocumentoIdentidadBoliviaSchema,
  LicenciaConducirBoliviaSchema,
  NombrePersonaSchema,
} from './identidad-bolivia.js';

describe('identidad boliviana', () => {
  it.each([
    ['1234567', '1234567'],
    ['1234567-1a', '1234567-1A'],
    ['1234567 lp', '1234567 LP'],
    [' 1234567 - 1a   sc ', '1234567-1A SC'],
  ])('acepta y normaliza el CI %s', (input, expected) => {
    expect(DocumentoIdentidadBoliviaSchema.parse(input)).toBe(expected);
  });

  it.each(['DOC-123', '123', '1234567 XX', '123.456.7', 'ABC12345'])(
    'rechaza el CI inválido %s',
    (input) => {
      expect(DocumentoIdentidadBoliviaSchema.safeParse(input).success).toBe(false);
    },
  );

  it('normaliza nombres Unicode sin aceptar números', () => {
    expect(NombrePersonaSchema.parse('  María   José O’Connor  '.replace('’', "'"))).toBe(
      "María José O'Connor",
    );
    expect(NombrePersonaSchema.safeParse('Juan Pérez 2').success).toBe(false);
  });

  it('normaliza y valida una licencia', () => {
    expect(LicenciaConducirBoliviaSchema.parse(' lic-123 / b ')).toBe('LIC-123 / B');
    expect(LicenciaConducirBoliviaSchema.safeParse('@@@').success).toBe(false);
  });
});

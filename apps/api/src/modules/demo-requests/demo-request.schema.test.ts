import { describe, expect, it } from 'vitest';
import { CreateDemoRequestSchema } from './demo-request.schema.js';

describe('CreateDemoRequestSchema', () => {
  it('acepta los datos del formulario y conserva el honeypot opcional', () => {
    expect(
      CreateDemoRequestSchema.parse({
        name: '  Jairo  ',
        line: ' Sindicato del 120 ',
        city: ' Cochabamba ',
        lineCount: 2,
        vehicleCount: 40,
        website: '',
      }),
    ).toEqual({
      name: 'Jairo',
      line: 'Sindicato del 120',
      city: 'Cochabamba',
      lineCount: 2,
      vehicleCount: 40,
      website: '',
    });
  });

  it('rechaza cantidades no enteras o textos vacíos', () => {
    const result = CreateDemoRequestSchema.safeParse({
      name: '   ',
      line: 'Línea 1',
      city: 'Cochabamba',
      lineCount: 1.5,
    });

    expect(result.success).toBe(false);
  });
});

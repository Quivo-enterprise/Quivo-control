import { describe, expect, it } from 'vitest';
import { normalizarPlacaVehiculo } from '@quivo/shared';
import { vehicleLoginSchema } from './vehicle-login-schema';

type VehicleLoginResult = ReturnType<typeof vehicleLoginSchema.safeParse>;

/**
 * Devuelve los mensajes de error que le pertenecen a un solo campo (`placa` o `pin`).
 * Existe para que un test de PIN quede inmune a lo que pase con la placa (y viceversa):
 * mirar `result.success` a secas mezcla las dos validaciones en un solo booleano y deja
 * pasar arreglos que en realidad no se están probando.
 */
function erroresDe(result: VehicleLoginResult, campo: 'placa' | 'pin'): string[] {
  if (result.success) return [];
  return result.error.issues
    .filter((issue) => issue.path[0] === campo)
    .map((issue) => issue.message);
}

describe('vehicleLoginSchema — placa', () => {
  it.each(['1234ABC', '1234-ABC', '123 ABC', '123abc'])('acepta %s', (placa) => {
    const result = vehicleLoginSchema.safeParse({ placa, pin: '123456' });
    expect(erroresDe(result, 'placa')).toEqual([]);
  });

  it('acepta placas de 3 dígitos (formato boliviano válido, el regex viejo /^\\d{4}-[A-Za-z]{3}$/ lo rechazaba)', () => {
    const result = vehicleLoginSchema.safeParse({ placa: '123ABC', pin: '123456' });
    expect(erroresDe(result, 'placa')).toEqual([]);
  });

  it('rechaza el formato anterior al reemplaque y lo menciona en el mensaje', () => {
    const result = vehicleLoginSchema.safeParse({ placa: 'ABC123', pin: '123456' });
    const mensajes = erroresDe(result, 'placa');
    expect(mensajes.length).toBeGreaterThan(0);
    expect(mensajes.join(' ')).toMatch(/reemplaque/i);
  });

  it.each(['12ABC', '12345ABC', '', '1234AB', '1234ABC!'])('rechaza %s', (placa) => {
    const result = vehicleLoginSchema.safeParse({ placa, pin: '123456' });
    expect(erroresDe(result, 'placa').length).toBeGreaterThan(0);
  });
});

describe('vehicleLoginSchema — pin', () => {
  it.each(['123456', '123456789012'])('acepta %s', (pin) => {
    const result = vehicleLoginSchema.safeParse({ placa: '1234ABC', pin });
    expect(erroresDe(result, 'pin')).toEqual([]);
  });

  it.each(['1234', '12345'])(
    'rechaza %s (el schema viejo con min(4) los aceptaba y el backend devolvía 400)',
    (pin) => {
      const result = vehicleLoginSchema.safeParse({ placa: '1234ABC', pin });
      expect(erroresDe(result, 'pin').length).toBeGreaterThan(0);
    },
  );

  it.each(['1234567890123', '12345a', ''])('rechaza %s', (pin) => {
    const result = vehicleLoginSchema.safeParse({ placa: '1234ABC', pin });
    expect(erroresDe(result, 'pin').length).toBeGreaterThan(0);
  });
});

describe('normalizarPlacaVehiculo', () => {
  it.each(['1234-ABC', '1234 abc', ' 1234-abc '])(
    "normaliza %s a '1234ABC' (el código viejo hacía .toUpperCase().replace('-', ''), que solo quita el primer guion y no quita espacios)",
    (placa) => {
      expect(normalizarPlacaVehiculo(placa)).toBe('1234ABC');
    },
  );
});

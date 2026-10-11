import { describe, expect, it } from 'vitest';
import { CLAVE_SIN_SESION, claveIdentidad } from './identidad';

const A = { id: 'u1', rol: 'admin_sindicato', sindicatoId: 's1' };

describe('claveIdentidad', () => {
  it('sin usuario: clave estable de "sin sesión"', () => {
    expect(claveIdentidad(null)).toBe(CLAVE_SIN_SESION);
    expect(claveIdentidad(null)).toBe(claveIdentidad(null));
  });
  it('distingue id, rol y sindicato', () => {
    const base = claveIdentidad(A);
    expect(claveIdentidad({ ...A, id: 'u2' })).not.toBe(base);
    expect(claveIdentidad({ ...A, rol: 'admin_quivo' })).not.toBe(base);
    expect(claveIdentidad({ ...A, sindicatoId: null })).not.toBe(base);
    expect(base).not.toBe(CLAVE_SIN_SESION);
  });
  it('misma identidad (refresh de token) = misma clave: no remonta', () => {
    // El usuario no cambia al rotar el token; el token ni siquiera entra en la clave.
    expect(claveIdentidad({ ...A })).toBe(claveIdentidad(A));
  });
});

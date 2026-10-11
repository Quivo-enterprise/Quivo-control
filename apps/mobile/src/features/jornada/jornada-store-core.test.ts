import { describe, expect, it } from 'vitest';
import {
  JORNADA_STORAGE_KEY,
  crearDeclaracion,
  declaracionVigente,
  diaBolivia,
  guardarJornadaEn,
  msHastaMedianoche,
  subtituloJornada,
  leerJornadaEn,
  parsearDeclaracion,
  type AlmacenClaveValor,
} from './jornada-store-core';

const ID = { vehiculoId: 'veh-1', conductorId: 'con-1', sesionId: 'ses-1' };

function almacenEnMemoria(inicial: Record<string, string> = {}): AlmacenClaveValor {
  const datos = { ...inicial };
  return {
    getItem: async (k) => datos[k] ?? null,
    setItem: async (k, v) => {
      datos[k] = v;
    },
  };
}

const almacenRoto: AlmacenClaveValor = {
  getItem: async () => {
    throw new Error('boom');
  },
  setItem: async () => {
    throw new Error('boom');
  },
};

describe('diaBolivia', () => {
  it('usa el día de Bolivia (UTC-4), no el UTC', () => {
    expect(diaBolivia(new Date('2026-08-02T02:30:00Z'))).toBe('2026-08-01');
    expect(diaBolivia(new Date('2026-08-02T04:30:00Z'))).toBe('2026-08-02');
  });
});

describe('parsearDeclaracion', () => {
  it('rechaza null, JSON inválido y formas incompletas', () => {
    expect(parsearDeclaracion(null)).toBeNull();
    expect(parsearDeclaracion('{no json')).toBeNull();
    expect(parsearDeclaracion('"x"')).toBeNull();
    expect(parsearDeclaracion(JSON.stringify({ vehiculoId: 'a' }))).toBeNull();
    // Declaración vieja sin sesionId → no vigente.
    expect(
      parsearDeclaracion(
        JSON.stringify({ vehiculoId: 'a', conductorId: 'b', jornada: '2026-08-02', ts: 'x' }),
      ),
    ).toBeNull();
  });
});

describe('declaracionVigente', () => {
  const decl = crearDeclaracion(ID, new Date('2026-08-02T14:00:00Z'));

  it('coincide con mismo vehículo, conductor y día', () => {
    expect(declaracionVigente(decl, ID, '2026-08-02')).toBe(true);
  });

  it('día nuevo, otro conductor u otro vehículo → no iniciada', () => {
    expect(declaracionVigente(decl, ID, '2026-08-03')).toBe(false);
    expect(declaracionVigente(decl, { ...ID, conductorId: 'con-2' }, '2026-08-02')).toBe(false);
    expect(declaracionVigente(decl, { ...ID, vehiculoId: 'veh-2' }, '2026-08-02')).toBe(false);
    expect(declaracionVigente(decl, { ...ID, sesionId: 'ses-2' }, '2026-08-02')).toBe(false);
    expect(declaracionVigente(null, ID, '2026-08-02')).toBe(false);
  });
});

describe('leerJornadaEn / guardarJornadaEn', () => {
  const ahora = new Date('2026-08-02T14:00:00Z');

  it('ida y vuelta el mismo día', async () => {
    const almacen = almacenEnMemoria();
    expect(await guardarJornadaEn(almacen, crearDeclaracion(ID, ahora))).toBe(true);
    const leida = await leerJornadaEn(almacen, ID, new Date('2026-08-02T20:00:00Z'));
    expect(leida?.jornada).toBe('2026-08-02');
  });

  it('al día siguiente (Bolivia) vuelve a ser null', async () => {
    const almacen = almacenEnMemoria();
    await guardarJornadaEn(almacen, crearDeclaracion(ID, ahora));
    expect(await leerJornadaEn(almacen, ID, new Date('2026-08-03T04:00:00Z'))).toBeNull();
  });

  it('el valor guardado vive bajo una única clave namespaced', async () => {
    const almacen = almacenEnMemoria();
    await guardarJornadaEn(almacen, crearDeclaracion(ID, ahora));
    expect(await almacen.getItem(JORNADA_STORAGE_KEY)).not.toBeNull();
  });

  it('fallo de lectura → null; fallo de escritura → false, sin lanzar', async () => {
    expect(await leerJornadaEn(almacenRoto, ID, ahora)).toBeNull();
    expect(await guardarJornadaEn(almacenRoto, crearDeclaracion(ID, ahora))).toBe(false);
  });
});

describe('leerJornadaEn con otra sesión', () => {
  it('una sesión nueva el mismo día no hereda la declaración', async () => {
    const almacen = almacenEnMemoria();
    const ahora = new Date('2026-08-02T14:00:00Z');
    await guardarJornadaEn(almacen, crearDeclaracion(ID, ahora));
    expect(await leerJornadaEn(almacen, { ...ID, sesionId: 'ses-2' }, ahora)).toBeNull();
  });
});

describe('msHastaMedianoche', () => {
  it('a las 23:00 Bolivia (03:00Z) faltan 1 h', () => {
    expect(msHastaMedianoche(new Date('2026-08-03T03:00:00Z'))).toBe(3_600_000);
  });
  it('a las 00:00 Bolivia exactas faltan 24 h', () => {
    expect(msHastaMedianoche(new Date('2026-08-02T04:00:00Z'))).toBe(86_400_000);
  });
  it('un milisegundo antes de medianoche → 1 ms', () => {
    expect(msHastaMedianoche(new Date('2026-08-03T03:59:59.999Z'))).toBe(1);
  });
});

describe('subtituloJornada', () => {
  it('omite el conteo sin puntos y pluraliza', () => {
    expect(subtituloJornada('120', 0)).toBe('Línea 120');
    expect(subtituloJornada('120', 1)).toBe('Línea 120, 1 punto de control');
    expect(subtituloJornada('120', 7)).toBe('Línea 120, 7 puntos de control');
  });
});

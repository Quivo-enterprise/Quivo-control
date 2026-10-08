import { describe, expect, it } from 'vitest';
import {
  calcularFaltantes,
  derivarPares,
  filtrarParesPorPlacas,
  parsearPlacas,
  ejecutarConReautenticacion,
  fechaActualLaPaz,
  generarRangoFechas,
  normalizarBaseUrl,
  renovarSesion,
  verificarCobertura,
  type AsignacionApi,
} from './asignaciones-piloto.js';

function asig(
  vehiculoId: string,
  fecha: string,
  extra: Partial<AsignacionApi> = {},
): AsignacionApi {
  return {
    id: `${vehiculoId}-${fecha}`,
    vehiculoId,
    conductorId: `c-${vehiculoId}`,
    rutaId: `r-${vehiculoId}`,
    fecha: `${fecha}T00:00:00.000Z`,
    horario: 'manana',
    orden: 1,
    estado: 'vigente',
    ...extra,
  };
}

describe('fechaActualLaPaz', () => {
  it('a las 02:00Z todavía es el día anterior en La Paz (UTC-4)', () => {
    expect(fechaActualLaPaz(new Date('2026-10-07T02:00:00Z'))).toBe('2026-10-06');
  });
  it('a las 04:00Z ya es el día nuevo en La Paz', () => {
    expect(fechaActualLaPaz(new Date('2026-10-07T04:00:00Z'))).toBe('2026-10-07');
  });
  it('a las 03:59:59Z sigue siendo el día anterior', () => {
    expect(fechaActualLaPaz(new Date('2026-10-07T03:59:59Z'))).toBe('2026-10-06');
  });
  it('cruza fin de año', () => {
    expect(fechaActualLaPaz(new Date('2027-01-01T03:00:00Z'))).toBe('2026-12-31');
  });
});

describe('generarRangoFechas', () => {
  it('es inclusivo en ambos extremos', () => {
    expect(generarRangoFechas('2026-10-07', '2026-10-09')).toEqual([
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
    ]);
  });
  it('un solo día', () => {
    expect(generarRangoFechas('2026-10-07', '2026-10-07')).toEqual(['2026-10-07']);
  });
  it('cruza mes y año sin saltos', () => {
    expect(generarRangoFechas('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
  });
  it('2026-10-07..2026-11-30 son 55 días', () => {
    expect(generarRangoFechas('2026-10-07', '2026-11-30')).toHaveLength(55);
  });
  it('rechaza formato inválido, fechas imposibles y rango invertido', () => {
    expect(() => generarRangoFechas('07/10/2026', '2026-11-30')).toThrow();
    expect(() => generarRangoFechas('2026-02-30', '2026-03-05')).toThrow();
    expect(() => generarRangoFechas('2026-11-30', '2026-10-07')).toThrow();
  });
});

describe('derivarPares', () => {
  it('toma el conductor/ruta de la asignación más reciente con conductor, por vehículo', () => {
    const pares = derivarPares(
      [
        asig('v1', '2026-09-01', { conductorId: 'viejo', rutaId: 'rv' }),
        asig('v1', '2026-09-29', { conductorId: 'nuevo', rutaId: 'rn' }),
        asig('v1', '2026-09-30', { conductorId: null }),
        asig('v2', '2026-09-10'),
        asig('v2', '2026-09-20', { horario: 'tarde', conductorId: 'otro' }),
      ],
      'manana',
    );
    expect(pares).toEqual([
      { vehiculoId: 'v1', conductorId: 'nuevo', rutaId: 'rn', fechaReferencia: '2026-09-29' },
      { vehiculoId: 'v2', conductorId: 'c-v2', rutaId: 'r-v2', fechaReferencia: '2026-09-10' },
    ]);
  });
});

describe('calcularFaltantes', () => {
  const pares = derivarPares([asig('v1', '2026-09-29'), asig('v2', '2026-09-29')], 'manana');
  const fechas = generarRangoFechas('2026-10-07', '2026-10-10');

  it('sin existentes en el rango, faltan todos', () => {
    expect(calcularFaltantes(pares, [asig('v1', '2026-09-29')], fechas, 'manana')).toHaveLength(8);
  });
  it('omite lo que ya existe (cualquier estado) y es idempotente', () => {
    const existentes = [
      asig('v1', '2026-10-07'),
      asig('v1', '2026-10-08', { estado: 'vencida' }),
      asig('v2', '2026-10-10', { conductorId: null }),
    ];
    const f = calcularFaltantes(pares, existentes, fechas, 'manana');
    expect(f).toHaveLength(5);
    expect(f.map((x) => `${x.vehiculoId}@${x.fecha}`)).toEqual([
      'v1@2026-10-09',
      'v1@2026-10-10',
      'v2@2026-10-07',
      'v2@2026-10-08',
      'v2@2026-10-09',
    ]);
    const conLoCreado = [...existentes, ...f.map((x) => asig(x.vehiculoId, x.fecha))];
    expect(calcularFaltantes(pares, conLoCreado, fechas, 'manana')).toEqual([]);
  });
  it('una asignación en otro horario no cuenta como cubierta', () => {
    const f = calcularFaltantes(
      pares,
      [asig('v1', '2026-10-07', { horario: 'tarde' })],
      ['2026-10-07'],
      'manana',
    );
    expect(f.map((x) => x.vehiculoId)).toEqual(['v1', 'v2']);
  });
  it('usa el conductor y la ruta del par', () => {
    const [primero] = calcularFaltantes(pares, [], ['2026-10-07'], 'manana');
    expect(primero).toEqual({
      vehiculoId: 'v1',
      conductorId: 'c-v1',
      rutaId: 'r-v1',
      fecha: '2026-10-07',
    });
  });
});

describe('verificarCobertura', () => {
  const pares = derivarPares([asig('v1', '2026-09-29')], 'manana');
  const fechas = generarRangoFechas('2026-10-07', '2026-10-09');

  it('cobertura completa', () => {
    const r = verificarCobertura(
      pares,
      fechas.map((f) => asig('v1', f)),
      fechas,
      'manana',
      '2026-10-07',
    );
    expect(r[0]).toMatchObject({ sinCubrir: [], conductorDistinto: [], vigentes: 3 });
  });
  it('reporta huecos, vencidas de hoy en adelante y conductor distinto', () => {
    const r = verificarCobertura(
      pares,
      [
        asig('v1', '2026-10-07', { estado: 'vencida' }),
        asig('v1', '2026-10-09', { conductorId: 'otro' }),
      ],
      fechas,
      'manana',
      '2026-10-07',
    );
    expect(r[0]!.sinCubrir).toEqual(['2026-10-07', '2026-10-08']);
    expect(r[0]!.conductorDistinto).toEqual(['2026-10-09']);
  });
  it('fechas históricas con otro conductor no son falla', () => {
    const r = verificarCobertura(
      pares,
      [asig('v1', '2026-10-06', { conductorId: 'historico' }), asig('v1', '2026-10-07')],
      ['2026-10-06', '2026-10-07'],
      'manana',
      '2026-10-07',
    );
    expect(r[0]).toMatchObject({ sinCubrir: [], conductorDistinto: [] });
  });
  it('fechas pasadas vencidas no cuentan como hueco', () => {
    const r = verificarCobertura(
      pares,
      [asig('v1', '2026-10-07', { estado: 'vencida' })],
      ['2026-10-07'],
      'manana',
      '2026-10-08',
    );
    expect(r[0]!.sinCubrir).toEqual([]);
  });
});

describe('normalizarBaseUrl', () => {
  it('agrega /v1 una sola vez', () => {
    expect(normalizarBaseUrl('http://x:3000/')).toBe('http://x:3000/v1');
    expect(normalizarBaseUrl('http://x:3000/v1')).toBe('http://x:3000/v1');
  });
});

describe('ejecutarConReautenticacion / renovarSesion', () => {
  it('sin 401 no renueva', async () => {
    let renovaciones = 0;
    const r = await ejecutarConReautenticacion(
      async () => ({ status: 201 }),
      async () => {
        renovaciones++;
      },
    );
    expect(r.status).toBe(201);
    expect(renovaciones).toBe(0);
  });
  it('401 -> renueva -> reintenta una vez con el token nuevo', async () => {
    let token = 'viejo';
    const usados: string[] = [];
    const r = await ejecutarConReautenticacion(
      async () => {
        usados.push(token);
        return { status: token === 'nuevo' ? 200 : 401 };
      },
      async () => {
        token = 'nuevo';
      },
    );
    expect(r.status).toBe(200);
    expect(usados).toEqual(['viejo', 'nuevo']);
  });
  it('si sigue en 401 tras renovar, devuelve 401 sin más reintentos', async () => {
    let llamadas = 0;
    const r = await ejecutarConReautenticacion(
      async () => {
        llamadas++;
        return { status: 401 };
      },
      async () => {},
    );
    expect(r.status).toBe(401);
    expect(llamadas).toBe(2);
  });
  it('renovarSesion usa refresh y no re-loguea si funciona', async () => {
    const calls: string[] = [];
    await renovarSesion({
      refrescar: async () => {
        calls.push('refresh');
        return true;
      },
      loguear: async () => {
        calls.push('login');
      },
    });
    expect(calls).toEqual(['refresh']);
  });
  it('renovarSesion cae a re-login si refresh falla o lanza', async () => {
    const falla = async (): Promise<boolean> => {
      throw new Error('x');
    };
    for (const refrescar of [async () => false, falla]) {
      const calls: string[] = [];
      await renovarSesion({
        refrescar,
        loguear: async () => {
          calls.push('login');
        },
      });
      expect(calls).toEqual(['login']);
    }
  });
});

describe('filtro por placas', () => {
  const pares = derivarPares(
    [asig('v1', '2026-09-29'), asig('v2', '2026-09-29'), asig('v3', '2026-09-29')],
    'manana',
  );
  const placas = new Map([
    ['v1', '9001TST'],
    ['v2', '9004TST'],
    ['v3', '9002TST'],
  ]);
  it('parsea y normaliza la lista', () => {
    expect(parsearPlacas(' 9001tst, 9004-TST ,,9001TST')).toEqual(['9001TST', '9004TST']);
  });
  it('limita a las placas pedidas', () => {
    const f = filtrarParesPorPlacas(pares, placas, ['9001tst', '9004TST']);
    expect(f.map((p) => p.vehiculoId)).toEqual(['v1', 'v2']);
  });
  it('lanza si una placa no está', () => {
    expect(() => filtrarParesPorPlacas(pares, placas, ['9001TST', '9999ZZZ'])).toThrow(/9999ZZZ/);
  });
  it('el faltante respeta el filtro', () => {
    const f = filtrarParesPorPlacas(pares, placas, ['9001TST', '9004TST']);
    const fal = calcularFaltantes(f, [], generarRangoFechas('2026-10-07', '2026-10-08'), 'manana');
    expect(fal).toHaveLength(4);
    expect(new Set(fal.map((x) => x.vehiculoId))).toEqual(new Set(['v1', 'v2']));
  });
});

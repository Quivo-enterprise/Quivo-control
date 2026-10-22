import { describe, expect, it } from 'vitest';
import type { JornadaVehiculo } from '@quivo/shared';
import {
  agruparJornadas,
  formatearHace,
  fechaSiDifiereDeHoy,
  formatearHoraBolivia,
  contarAtrasados,
  debiaSalir,
  lineaTiempo,
  textoResumen,
} from './jornadas';

const L1 = '11111111-1111-4111-8111-111111111111';
const L2 = '22222222-2222-4222-8222-222222222222';

function veh(p: Partial<JornadaVehiculo> & { placa: string }): JornadaVehiculo {
  return {
    sindicatoId: '33333333-3333-4333-8333-333333333333',
    sindicatoNombre: 'Sindicato A',
    vehiculoId: `00000000-0000-4000-8000-${p.placa.replace(/\D/g, '').padStart(12, '0')}`,
    numeroInterno: null,
    conductorNombre: null,
    lineaId: L1,
    lineaNombre: 'L1',
    rutaSentido: 'ida',
    horaSalida: null,
    estado: 'sin_iniciar',
    inicioJornadaTs: null,
    ...p,
  };
}

describe('agruparJornadas', () => {
  it('entrada vacía: sin grupos y resumen en cero', () => {
    const r = agruparJornadas([], '');
    expect(r.grupos).toEqual([]);
    expect(r.resumen).toEqual({ total: 0, iniciaron: 0, sinIniciar: 0, enRecorrido: 0 });
  });

  it('agrupa en orden fijo y omite grupos vacíos', () => {
    const r = agruparJornadas(
      [
        veh({ placa: '100AAA', estado: 'finalizado' }),
        veh({ placa: '200BBB', estado: 'en_recorrido' }),
        veh({ placa: '300CCC', estado: 'sin_iniciar' }),
      ],
      '',
    );
    expect(r.grupos.map((g) => g.estado)).toEqual(['sin_iniciar', 'en_recorrido', 'finalizado']);
    expect(r.grupos[0]?.etiqueta).toBe('Sin iniciar');
  });

  it('filtra por línea y el resumen respeta el filtro', () => {
    const datos = [
      veh({ placa: '100AAA', lineaId: L1, estado: 'en_recorrido' }),
      veh({ placa: '200BBB', lineaId: L2, estado: 'sin_iniciar' }),
      veh({ placa: '300CCC', lineaId: L2, estado: 'dia_iniciado' }),
    ];
    expect(agruparJornadas(datos, L2).resumen).toEqual({
      total: 2,
      iniciaron: 1,
      sinIniciar: 1,
      enRecorrido: 0,
    });
    expect(agruparJornadas(datos, '').resumen.total).toBe(3);
    expect(agruparJornadas(datos, 'no-existe').grupos).toEqual([]);
  });

  it('cuenta iniciaron = todo lo que no es sin_iniciar', () => {
    const r = agruparJornadas(
      [
        veh({ placa: '100AAA', estado: 'dia_iniciado' }),
        veh({ placa: '200BBB', estado: 'en_recorrido' }),
        veh({ placa: '300CCC', estado: 'finalizado' }),
        veh({ placa: '400DDD', estado: 'sin_iniciar' }),
      ],
      '',
    );
    expect(r.resumen).toEqual({ total: 4, iniciaron: 3, sinIniciar: 1, enRecorrido: 1 });
  });

  it('sin_iniciar: por horaSalida asc, sin hora al final, desempate por placa', () => {
    const r = agruparJornadas(
      [
        veh({ placa: '900ZZZ', horaSalida: null }),
        veh({ placa: '300CCC', horaSalida: '2026-10-11T12:00:00.000Z' }),
        veh({ placa: '200BBB', horaSalida: '2026-10-11T11:00:00.000Z' }),
        veh({ placa: '100AAA', horaSalida: '2026-10-11T11:00:00.000Z' }),
      ],
      '',
    );
    expect(r.grupos[0]?.vehiculos.map((v) => v.placa)).toEqual([
      '100AAA',
      '200BBB',
      '300CCC',
      '900ZZZ',
    ]);
  });

  it('iniciados: por inicioJornadaTs asc; sin declaración al final de su grupo', () => {
    const r = agruparJornadas(
      [
        veh({ placa: '100AAA', estado: 'en_recorrido', inicioJornadaTs: null }),
        veh({ placa: '200BBB', estado: 'en_recorrido', inicioJornadaTs: '2026-10-11T10:30:00.000Z' }),
        veh({ placa: '300CCC', estado: 'en_recorrido', inicioJornadaTs: '2026-10-11T10:00:00.000Z' }),
      ],
      '',
    );
    expect(r.grupos[0]?.vehiculos.map((v) => v.placa)).toEqual(['300CCC', '200BBB', '100AAA']);
  });

  it('no muta el arreglo de entrada', () => {
    const datos = [veh({ placa: '200BBB' }), veh({ placa: '100AAA' })];
    agruparJornadas(datos, '');
    expect(datos.map((v) => v.placa)).toEqual(['200BBB', '100AAA']);
  });
});

describe('textoResumen', () => {
  it('formato con conteos', () => {
    expect(textoResumen({ total: 13, iniciaron: 8, sinIniciar: 5, enRecorrido: 2 })).toBe(
      '8 iniciaron · 5 sin iniciar · 2 en recorrido',
    );
  });
  it('vacío', () => {
    expect(textoResumen({ total: 0, iniciaron: 0, sinIniciar: 0, enRecorrido: 0 })).toBe(
      'Sin vehículos asignados',
    );
  });
});

describe('formatearHoraBolivia', () => {
  it('convierte UTC a America/La_Paz (UTC-4)', () => {
    expect(formatearHoraBolivia('2026-10-11T10:42:00.000Z')).toBe('06:42');
  });
  it('cruza la medianoche hacia el día anterior', () => {
    expect(formatearHoraBolivia('2026-10-11T02:05:00.000Z')).toBe('22:05');
  });
  it('null o ilegible → guion', () => {
    expect(formatearHoraBolivia(null)).toBe('—');
    expect(formatearHoraBolivia('basura')).toBe('—');
  });
});

describe('formatearHace', () => {
  const ahora = Date.parse('2026-10-11T12:00:00.000Z');
  it('menos de un minuto', () => {
    expect(formatearHace('2026-10-11T11:59:40.000Z', ahora)).toBe('hace instantes');
  });
  it('minutos', () => {
    expect(formatearHace('2026-10-11T11:15:00.000Z', ahora)).toBe('hace 45 min');
  });
  it('horas y minutos', () => {
    expect(formatearHace('2026-10-11T09:55:00.000Z', ahora)).toBe('hace 2 h 05 min');
  });
  it('instante futuro no da negativos', () => {
    expect(formatearHace('2026-10-11T12:05:00.000Z', ahora)).toBe('hace instantes');
  });
  it('null → guion', () => {
    expect(formatearHace(null, ahora)).toBe('—');
  });
});

describe('lineaTiempo', () => {
  const ahora = Date.parse('2026-10-11T12:00:00.000Z');
  const INI = '2026-10-11T10:42:00.000Z';
  it('sin_iniciar con hora de salida', () => {
    expect(
      lineaTiempo({ estado: 'sin_iniciar', horaSalida: INI, inicioJornadaTs: null }, ahora),
    ).toEqual({ texto: 'Sale 06:42', atenuado: false });
  });
  it('sin_iniciar sin hora de salida: nada', () => {
    expect(
      lineaTiempo({ estado: 'sin_iniciar', horaSalida: null, inicioJornadaTs: null }, ahora),
    ).toBeNull();
  });
  it('dia_iniciado: empezó + hace X', () => {
    expect(
      lineaTiempo({ estado: 'dia_iniciado', horaSalida: null, inicioJornadaTs: INI }, ahora),
    ).toEqual({ texto: 'Empezó 06:42 · hace 1 h 18 min', atenuado: false });
  });
  it('en_recorrido con declaración: empezó + hace X', () => {
    expect(
      lineaTiempo({ estado: 'en_recorrido', horaSalida: null, inicioJornadaTs: INI }, ahora)?.texto,
    ).toBe('Empezó 06:42 · hace 1 h 18 min');
  });
  it('finalizado: solo la hora de inicio, sin "hace"', () => {
    expect(
      lineaTiempo({ estado: 'finalizado', horaSalida: null, inicioJornadaTs: INI }, ahora),
    ).toEqual({ texto: 'Empezó 06:42', atenuado: false });
  });
  it('en_recorrido sin declarar: texto atenuado', () => {
    expect(
      lineaTiempo({ estado: 'en_recorrido', horaSalida: null, inicioJornadaTs: null }, ahora),
    ).toEqual({ texto: 'En recorrido sin declarar el día', atenuado: true });
  });
  it('finalizado / dia_iniciado sin timestamp: nada', () => {
    expect(
      lineaTiempo({ estado: 'finalizado', horaSalida: null, inicioJornadaTs: null }, ahora),
    ).toBeNull();
  });
});

describe('fechaSiDifiereDeHoy', () => {
  it('coincide con el día de Bolivia: null', () => {
    // 02:00 UTC del 11 = 22:00 del 10 en Bolivia.
    expect(fechaSiDifiereDeHoy('2026-10-10', Date.parse('2026-10-11T02:00:00.000Z'))).toBeNull();
    expect(fechaSiDifiereDeHoy('2026-10-11', Date.parse('2026-10-11T05:00:00.000Z'))).toBeNull();
  });
  it('distinta: devuelve la fecha', () => {
    expect(fechaSiDifiereDeHoy('2026-10-10', Date.parse('2026-10-11T05:00:00.000Z'))).toBe('2026-10-10');
  });
});

describe('debiaSalir / contarAtrasados', () => {
  const ahora = Date.parse('2026-10-11T12:00:00.000Z');
  it('sin_iniciar con la hora ya pasada: debía salir + hace X', () => {
    expect(debiaSalir({ estado: 'sin_iniciar', horaSalida: '2026-10-11T10:42:00.000Z' }, ahora)).toBe(
      'Debía salir 06:42 · hace 1 h 18 min',
    );
  });
  it('todavía no le toca, menos de 1 min, sin hora o ya iniciado: null', () => {
    expect(debiaSalir({ estado: 'sin_iniciar', horaSalida: '2026-10-11T12:30:00.000Z' }, ahora)).toBeNull();
    expect(debiaSalir({ estado: 'sin_iniciar', horaSalida: '2026-10-11T11:59:30.000Z' }, ahora)).toBeNull();
    expect(debiaSalir({ estado: 'sin_iniciar', horaSalida: null }, ahora)).toBeNull();
    expect(debiaSalir({ estado: 'en_recorrido', horaSalida: '2026-10-11T10:00:00.000Z' }, ahora)).toBeNull();
  });
  it('cuenta atrasados respetando la línea', () => {
    const vs = [
      veh({ placa: '111A', horaSalida: '2026-10-11T10:00:00.000Z', lineaId: L1 }),
      veh({ placa: '222B', horaSalida: '2026-10-11T10:00:00.000Z', lineaId: L2 }),
      veh({ placa: '333C', horaSalida: '2026-10-11T13:00:00.000Z', lineaId: L1 }),
    ];
    expect(contarAtrasados(vs, '', ahora)).toBe(2);
    expect(contarAtrasados(vs, L1, ahora)).toBe(1);
  });
});

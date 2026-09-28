import { describe, expect, it } from 'vitest';
import {
  contextoDeCuenta,
  CUENTAS_DEMO,
  fechaLocalDemo,
  fechaTurnoDemo,
  idParadaDemo,
  salidaProgramadaInicialDemo,
  turnoDesdeHoraLocal,
  uuidDemo,
} from './cuentas';
import { LINEAS_MOCK } from './datos/datos';

/** Corre `fn` con `TZ=America/La_Paz` (UTC-4) y restaura el valor original al terminar — mismo
 * patrón que el resto de este archivo, extraído para no repetirlo en cada test nuevo. */
function conTimezoneBolivia<T>(fn: () => T): T {
  const tzOriginal = process.env['TZ'];
  process.env['TZ'] = 'America/La_Paz';
  try {
    return fn();
  } finally {
    if (tzOriginal === undefined) delete process.env['TZ'];
    else process.env['TZ'] = tzOriginal;
  }
}

// FIX POST-REVISIÓN (hallazgo en teléfono real): 22:45 hora de Bolivia (UTC-4) el 27/09 ya es
// 02:45 UTC del 28/09 — el caso exacto que reprodujo el bug ("Hoja de ruta" mostraba 28/09).
const HORA_LOCAL_BOLIVIA_22_45_27_SEP = new Date('2026-09-28T02:45:00.000Z').getTime();

describe('fechaLocalDemo', () => {
  it('usa la fecha LOCAL, no la UTC — 22:45 en Bolivia (UTC-4) el 27/09 no es 28/09', () => {
    // Nota: el resultado depende de la zona horaria del proceso que corre el test (vitest/Node
    // toma la del sistema, igual que el teléfono) — en CI/dev normalmente configurado en UTC o
    // similar; para no depender de eso, se fija explícitamente `TZ` para esta prueba.
    const tzOriginal = process.env['TZ'];
    process.env['TZ'] = 'America/La_Paz';
    try {
      expect(fechaLocalDemo(HORA_LOCAL_BOLIVIA_22_45_27_SEP)).toBe('2026-09-27');
    } finally {
      if (tzOriginal === undefined) delete process.env['TZ'];
      else process.env['TZ'] = tzOriginal;
    }
  });
});

describe('turnoDesdeHoraLocal', () => {
  it('clasifica mañana/tarde/noche por hora LOCAL, consistente con HORARIO_TURNO_DEMO', () => {
    const tzOriginal = process.env['TZ'];
    process.env['TZ'] = 'America/La_Paz';
    try {
      const horaLocal = (hh: number, mm = 0) => new Date(`2026-09-27T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00.000-04:00`).getTime();
      expect(turnoDesdeHoraLocal(horaLocal(6))).toBe('manana');
      expect(turnoDesdeHoraLocal(horaLocal(13, 59))).toBe('manana');
      expect(turnoDesdeHoraLocal(horaLocal(14))).toBe('tarde');
      // 21:00 — hallazgo de revisión: con los rangos DESALINEADOS que tenía la primera versión
      // de este fix ("tarde" hasta las 22:00 acá, pero el rótulo de `hoja-de-ruta-screen.tsx`
      // decía "tarde 14:00-20:00"), a esta hora el turno elegido YA era 'tarde' pero el rótulo
      // mostraba una ventana vencida. Ahora ambos leen `LIMITES_TURNO_DEMO` — un solo número.
      expect(turnoDesdeHoraLocal(horaLocal(21))).toBe('tarde');
      expect(turnoDesdeHoraLocal(horaLocal(21, 59))).toBe('tarde');
      expect(turnoDesdeHoraLocal(horaLocal(22))).toBe('noche');
      expect(turnoDesdeHoraLocal(horaLocal(22, 45))).toBe('noche'); // caso reportado
      expect(turnoDesdeHoraLocal(horaLocal(23))).toBe('noche');
      expect(turnoDesdeHoraLocal(horaLocal(2))).toBe('noche');
      expect(turnoDesdeHoraLocal(horaLocal(5, 59))).toBe('noche');
    } finally {
      if (tzOriginal === undefined) delete process.env['TZ'];
      else process.env['TZ'] = tzOriginal;
    }
  });
});

describe('uuidDemo', () => {
  it('es determinístico: la misma semilla siempre produce el mismo id', () => {
    expect(uuidDemo('semilla-cualquiera')).toBe(uuidDemo('semilla-cualquiera'));
  });

  it('tiene forma de UUID v4 válida (la misma que exige z.string().uuid())', () => {
    const id = uuidDemo('cualquier-semilla-de-prueba-mas-larga-que-16-chars');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  // Hallazgo de revisión: la versión anterior truncaba la semilla a sus primeros 16 caracteres —
  // dos semillas que solo divergían DESPUÉS del char 16 colisionaban en el mismo id.
  it('semillas que solo difieren después del carácter 16 ya NO colisionan', () => {
    // Mismo prefijo de 16 chars ("punto-l120-parad"), diverge recién en "a-san-…" vs "a-uyustus".
    expect(uuidDemo('punto-l120-parada-san-sebastian')).not.toBe(
      uuidDemo('punto-l120-parada-uyustus'),
    );
  });

  it('sesionId distinto para dos conductores aunque el contador arranque en el mismo valor (simula un contador reseteado por reinicio/hot reload)', () => {
    const seedA = `sesion-1-${CUENTAS_DEMO[0]!.conductorId}`;
    const seedB = `sesion-1-${CUENTAS_DEMO[1]!.conductorId}`;
    expect(uuidDemo(seedA)).not.toBe(uuidDemo(seedB));
  });
});

describe('idParadaDemo — sin colisiones dentro de una línea', () => {
  it.each(['z12', 'l120'] as const)('cada parada/punto de control de %s tiene un id único', (lineaId) => {
    const ids = LINEAS_MOCK[lineaId].paradas.map((p) => idParadaDemo(lineaId, p.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('caso concreto reportado: parada-san-sebastian y parada-uyustus (L120) ya no colisionan', () => {
    expect(idParadaDemo('l120', 'parada-san-sebastian')).not.toBe(
      idParadaDemo('l120', 'parada-uyustus'),
    );
  });
});

describe('contextoDeCuenta — sesionId distinto por conductor', () => {
  it('produce sesionId distintos para todas las cuentas demo', () => {
    const sesiones = CUENTAS_DEMO.map((c) => contextoDeCuenta(c, Date.now()).sesionId);
    expect(new Set(sesiones).size).toBe(sesiones.length);
  });
});

describe('salidaProgramadaInicialDemo', () => {
  it('suma la frecuencia de la línea a `ahora` — mismo cálculo que crearEstadoInicial (./motor.ts)', () => {
    const ahora = Date.now();
    expect(salidaProgramadaInicialDemo('z12', ahora)).toBe(ahora + 8 * 60_000);
    expect(salidaProgramadaInicialDemo('l120', ahora)).toBe(ahora + 12 * 60_000);
  });
});

describe('fechaTurnoDemo', () => {
  it('turno noche en la madrugada (00:00–05:59) usa la fecha de AYER (el turno arrancó anoche)', () => {
    conTimezoneBolivia(() => {
      const madrugada = new Date('2026-09-28T02:00:00.000-04:00').getTime();
      expect(fechaTurnoDemo(madrugada, 'noche')).toBe('2026-09-27');
    });
  });

  it('turno noche entre las 22:00 y 23:59 usa la fecha de HOY (recién arrancó)', () => {
    conTimezoneBolivia(() => {
      const nocheTemprano = new Date('2026-09-27T22:30:00.000-04:00').getTime();
      expect(fechaTurnoDemo(nocheTemprano, 'noche')).toBe('2026-09-27');
    });
  });

  it('turno mañana/tarde siempre usa la fecha de HOY (nunca envuelven medianoche)', () => {
    conTimezoneBolivia(() => {
      const manana = new Date('2026-09-27T08:00:00.000-04:00').getTime();
      expect(fechaTurnoDemo(manana, 'manana')).toBe('2026-09-27');
    });
  });
});

describe('contextoDeCuenta — turno/fecha por hora de SALIDA programada, no por hora de login', () => {
  const cuentaZ12 = CUENTAS_DEMO.find((c) => c.trufiId === 'trufi-z12-3')!; // Z12: 8 min de frecuencia

  it('login 21:58 con salida a las 22:06 (Z12) muestra Turno noche, no tarde', () => {
    conTimezoneBolivia(() => {
      const login2158 = new Date('2026-09-27T21:58:00.000-04:00').getTime();
      const contexto = contextoDeCuenta(cuentaZ12, login2158);
      // Con la hora de LOGIN (21:58) esto daría 'tarde' (21 < 22) — el bug reportado. Con la hora
      // de SALIDA (22:06) da 'noche', coherente con lo que el motor va a mostrar apenas arranque.
      expect(contexto.asignacion.horario).toBe('noche');
    });
  });

  it('login 01:52 con salida a las 02:00 (Z12) muestra Turno noche con la fecha de AYER', () => {
    conTimezoneBolivia(() => {
      // Salida programada: 01:52 + 8 min = 02:00 del 28/09 — madrugada del turno noche que
      // arrancó a las 22:00 del 27/09, así que la fecha de la asignación es la del 27/09.
      const login0152 = new Date('2026-09-28T01:52:00.000-04:00').getTime();
      const contexto = contextoDeCuenta(cuentaZ12, login0152);
      expect(contexto.asignacion.horario).toBe('noche');
      expect(contexto.asignacion.fecha).toBe('2026-09-27');
    });
  });
});

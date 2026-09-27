import { describe, expect, it } from 'vitest';
import {
  elegirAleatorios,
  elegirTipoInfraccion,
  estadoInicial,
  fechaPlazoValida,
  infraccionActivaDe,
  infraccionesDe,
  PLAZO_MAX_DIAS,
  reducer,
  trufisSinInfraccionActiva,
} from './estado';
import { TRUFIS_MOCK } from './datos';
import { CATALOGO_INFRACCIONES } from './catalogo-infracciones';
import type { EstadoFlotaMock, InfraccionMock } from './tipos';

const AHORA = '2026-09-27T12:00:00.000Z';

function infraccionActiva(overrides: Partial<InfraccionMock> = {}): InfraccionMock {
  return {
    id: 'inf-1',
    trufiId: TRUFIS_MOCK[0]!.id,
    tipoId: CATALOGO_INFRACCIONES[0]!.id,
    severidad: 'leve',
    ocurridaEn: AHORA,
    estado: 'activa',
    ...overrides,
  };
}

describe('estadoInicial', () => {
  it('crea un EstadoTrufi para cada trufi mock, sin infracciones y sin pausa', () => {
    const estado = estadoInicial();
    expect(Object.keys(estado.trufis)).toHaveLength(TRUFIS_MOCK.length);
    expect(estado.infracciones).toEqual([]);
    expect(estado.pausado).toBe(false);
    for (const trufi of TRUFIS_MOCK) {
      const et = estado.trufis[trufi.id];
      expect(et).toBeDefined();
      expect(et!.siguienteParadaId).toBeNull();
      expect(typeof et!.lat).toBe('number');
      expect(typeof et!.lng).toBe('number');
    }
  });
});

describe('reducer — tick', () => {
  it('avanza el `avance` de cada trufi', () => {
    const inicial = estadoInicial();
    const siguiente = reducer(inicial, { type: 'tick' });
    for (const trufi of TRUFIS_MOCK) {
      expect(siguiente.trufis[trufi.id]!.avance).not.toBe(inicial.trufis[trufi.id]!.avance);
    }
  });

  it('con pausado=true, tick no cambia el estado (misma referencia)', () => {
    const pausado: EstadoFlotaMock = { ...estadoInicial(), pausado: true };
    const siguiente = reducer(pausado, { type: 'tick' });
    expect(siguiente).toBe(pausado);
  });
});

describe('reducer — toggle-pausa', () => {
  it('alterna pausado', () => {
    const inicial = estadoInicial();
    const pausado = reducer(inicial, { type: 'toggle-pausa' });
    expect(pausado.pausado).toBe(true);
    const reanudado = reducer(pausado, { type: 'toggle-pausa' });
    expect(reanudado.pausado).toBe(false);
  });
});

describe('reducer — simular-infracciones', () => {
  it('agrega las infracciones recibidas', () => {
    const inicial = estadoInicial();
    const inf = infraccionActiva();
    const siguiente = reducer(inicial, { type: 'simular-infracciones', infracciones: [inf] });
    expect(siguiente.infracciones).toEqual([inf]);
  });

  it('no agrega una infracción para un trufi que YA tiene una activa (defensa del reducer)', () => {
    const conUna = reducer(estadoInicial(), {
      type: 'simular-infracciones',
      infracciones: [infraccionActiva({ id: 'inf-1' })],
    });
    const siguiente = reducer(conUna, {
      type: 'simular-infracciones',
      infracciones: [infraccionActiva({ id: 'inf-2' })],
    });
    expect(siguiente.infracciones).toHaveLength(1);
    expect(siguiente.infracciones[0]!.id).toBe('inf-1');
  });
});

describe('reducer — limpiar-infracciones', () => {
  it('sin trufiIds, vacía TODA la lista de infracciones', () => {
    const conInfraccion = reducer(estadoInicial(), {
      type: 'simular-infracciones',
      infracciones: [infraccionActiva()],
    });
    const limpio = reducer(conInfraccion, { type: 'limpiar-infracciones' });
    expect(limpio.infracciones).toEqual([]);
  });

  it('con trufiIds, borra solo las infracciones de esos trufis y deja el resto intacto', () => {
    const trufiA = TRUFIS_MOCK[0]!.id;
    const trufiB = TRUFIS_MOCK[1]!.id;
    const conDos = reducer(estadoInicial(), {
      type: 'simular-infracciones',
      infracciones: [
        infraccionActiva({ id: 'inf-a', trufiId: trufiA }),
        infraccionActiva({ id: 'inf-b', trufiId: trufiB }),
      ],
    });
    const limpio = reducer(conDos, { type: 'limpiar-infracciones', trufiIds: [trufiA] });
    expect(limpio.infracciones).toHaveLength(1);
    expect(limpio.infracciones[0]!.id).toBe('inf-b');
  });

  it('con trufiIds que no tienen ninguna infracción, no cambia el estado (misma referencia)', () => {
    const trufiA = TRUFIS_MOCK[0]!.id;
    const trufiB = TRUFIS_MOCK[1]!.id;
    const conUna = reducer(estadoInicial(), {
      type: 'simular-infracciones',
      infracciones: [infraccionActiva({ id: 'inf-a', trufiId: trufiA })],
    });
    const siguiente = reducer(conUna, { type: 'limpiar-infracciones', trufiIds: [trufiB] });
    expect(siguiente).toBe(conUna);
  });

  it('sin infracciones previas, no cambia el estado (misma referencia)', () => {
    const inicial = estadoInicial();
    const siguiente = reducer(inicial, { type: 'limpiar-infracciones' });
    expect(siguiente).toBe(inicial);
  });
});

describe('reducer — asignar-parada', () => {
  it('fija siguienteParadaId del trufi indicado', () => {
    const trufiId = TRUFIS_MOCK[0]!.id;
    const siguiente = reducer(estadoInicial(), {
      type: 'asignar-parada',
      trufiId,
      paradaId: 'villa-armonia',
    });
    expect(siguiente.trufis[trufiId]!.siguienteParadaId).toBe('villa-armonia');
  });

  it('con un trufiId inexistente, no cambia el estado', () => {
    const inicial = estadoInicial();
    const siguiente = reducer(inicial, {
      type: 'asignar-parada',
      trufiId: 'no-existe',
      paradaId: 'x',
    });
    expect(siguiente).toBe(inicial);
  });
});

describe('reducer — aplicar-accion', () => {
  it('modo "ahora": marca la infracción como sancionada sin venceEl', () => {
    const accionId = CATALOGO_INFRACCIONES[0]!.acciones[0]!.id;
    const conInfraccion = reducer(estadoInicial(), {
      type: 'simular-infracciones',
      infracciones: [infraccionActiva()],
    });
    const siguiente = reducer(conInfraccion, {
      type: 'aplicar-accion',
      infraccionId: 'inf-1',
      accionId,
      modo: 'ahora',
      aplicadaEn: AHORA,
    });
    const infr = siguiente.infracciones[0]!;
    expect(infr.estado).toBe('sancionada');
    expect(infr.accionAplicada).toEqual({ accionId, modo: 'ahora', aplicadaEn: AHORA });
  });

  it('modo "plazo" con venceEl dentro de [hoy, hoy+30d]: aplica y guarda venceEl', () => {
    const accionId = CATALOGO_INFRACCIONES[0]!.acciones[0]!.id;
    const conInfraccion = reducer(estadoInicial(), {
      type: 'simular-infracciones',
      infracciones: [infraccionActiva()],
    });
    const siguiente = reducer(conInfraccion, {
      type: 'aplicar-accion',
      infraccionId: 'inf-1',
      accionId,
      modo: 'plazo',
      aplicadaEn: AHORA,
      venceEl: '2026-10-10',
    });
    const infr = siguiente.infracciones[0]!;
    expect(infr.estado).toBe('sancionada');
    expect(infr.accionAplicada).toEqual({
      accionId,
      modo: 'plazo',
      aplicadaEn: AHORA,
      venceEl: '2026-10-10',
    });
  });

  it('modo "plazo" con venceEl fuera de rango (>30 días): IGNORA la acción', () => {
    const accionId = CATALOGO_INFRACCIONES[0]!.acciones[0]!.id;
    const conInfraccion = reducer(estadoInicial(), {
      type: 'simular-infracciones',
      infracciones: [infraccionActiva()],
    });
    const siguiente = reducer(conInfraccion, {
      type: 'aplicar-accion',
      infraccionId: 'inf-1',
      accionId,
      modo: 'plazo',
      aplicadaEn: AHORA,
      venceEl: '2027-01-01',
    });
    expect(siguiente.infracciones[0]!.estado).toBe('activa');
    expect(siguiente.infracciones[0]!.accionAplicada).toBeUndefined();
  });

  it('modo "plazo" sin venceEl: ignora la acción', () => {
    const accionId = CATALOGO_INFRACCIONES[0]!.acciones[0]!.id;
    const conInfraccion = reducer(estadoInicial(), {
      type: 'simular-infracciones',
      infracciones: [infraccionActiva()],
    });
    const siguiente = reducer(conInfraccion, {
      type: 'aplicar-accion',
      infraccionId: 'inf-1',
      accionId,
      modo: 'plazo',
      aplicadaEn: AHORA,
    });
    expect(siguiente.infracciones[0]!.estado).toBe('activa');
  });

  it('sobre una infracción ya sancionada, no hace nada (idempotente)', () => {
    const accionId = CATALOGO_INFRACCIONES[0]!.acciones[0]!.id;
    const sancionada = reducer(
      reducer(estadoInicial(), {
        type: 'simular-infracciones',
        infracciones: [infraccionActiva()],
      }),
      { type: 'aplicar-accion', infraccionId: 'inf-1', accionId, modo: 'ahora', aplicadaEn: AHORA },
    );
    const siguiente = reducer(sancionada, {
      type: 'aplicar-accion',
      infraccionId: 'inf-1',
      accionId: CATALOGO_INFRACCIONES[0]!.acciones[1]!.id,
      modo: 'ahora',
      aplicadaEn: AHORA,
    });
    expect(siguiente).toBe(sancionada);
  });

  it('con un infraccionId inexistente, no cambia el estado', () => {
    const inicial = estadoInicial();
    const siguiente = reducer(inicial, {
      type: 'aplicar-accion',
      infraccionId: 'no-existe',
      accionId: 'x',
      modo: 'ahora',
      aplicadaEn: AHORA,
    });
    expect(siguiente).toBe(inicial);
  });
});

describe('fechaPlazoValida', () => {
  it('exporta PLAZO_MAX_DIAS = 30', () => {
    expect(PLAZO_MAX_DIAS).toBe(30);
  });

  it('hoy mismo es válido', () => {
    expect(fechaPlazoValida('2026-09-27', AHORA)).toBe(true);
  });

  it('hoy + 30 días es válido (límite inclusive)', () => {
    expect(fechaPlazoValida('2026-10-27', AHORA)).toBe(true);
  });

  it('hoy + 31 días NO es válido', () => {
    expect(fechaPlazoValida('2026-10-28', AHORA)).toBe(false);
  });

  it('una fecha pasada NO es válida', () => {
    expect(fechaPlazoValida('2026-09-26', AHORA)).toBe(false);
  });

  it('una fecha ilegible NO es válida', () => {
    expect(fechaPlazoValida('no-es-una-fecha', AHORA)).toBe(false);
  });
});

describe('fechaPlazoValida — usa el día calendario LOCAL de `now`, no UTC', () => {
  // `process.env.TZ` no es confiable en todos los runners de vitest, así que en vez de forzar
  // un huso horario del proceso, se construye `now` con el constructor de `Date` de
  // año/mes/día/hora (que SIEMPRE interpreta esos componentes en el huso LOCAL del runtime) y
  // se lo pasa como ISO. El roundtrip `Date -> toISOString() -> new Date(...)` conserva el
  // mismo instante absoluto, así que `fechaPlazoValida` tiene que leer de vuelta el MISMO día
  // calendario local (7 de octubre) para que estos casos pasen — si comparara con getters UTC
  // en vez de locales (el bug original), una hora tardía como las 21:00 en un huso negativo
  // (Bolivia, UTC-4) correría "hoy" un día hacia adelante y estos límites se romperían.
  const ahoraLocal = new Date(2026, 9, 7, 21, 0).toISOString();

  it('el mismo día calendario local (hoy) es válido', () => {
    expect(fechaPlazoValida('2026-10-07', ahoraLocal)).toBe(true);
  });

  it('local + 30 días es válido (límite inclusive)', () => {
    expect(fechaPlazoValida('2026-11-06', ahoraLocal)).toBe(true);
  });

  it('local + 31 días NO es válido', () => {
    expect(fechaPlazoValida('2026-11-07', ahoraLocal)).toBe(false);
  });

  it('el día calendario anterior al local NO es válido', () => {
    expect(fechaPlazoValida('2026-10-06', ahoraLocal)).toBe(false);
  });
});

describe('infraccionActivaDe / infraccionesDe', () => {
  it('infraccionActivaDe encuentra la infracción activa de un trufi, y no una sancionada', () => {
    const trufiId = TRUFIS_MOCK[0]!.id;
    const estado: EstadoFlotaMock = {
      ...estadoInicial(),
      infracciones: [
        infraccionActiva({ id: 'a', trufiId, estado: 'sancionada' }),
        infraccionActiva({ id: 'b', trufiId, estado: 'activa' }),
      ],
    };
    expect(infraccionActivaDe(estado, trufiId)!.id).toBe('b');
    expect(infraccionesDe(estado, trufiId)).toHaveLength(2);
  });

  it('sin infracciones para el trufi, devuelve undefined / []', () => {
    const estado = estadoInicial();
    expect(infraccionActivaDe(estado, 'x')).toBeUndefined();
    expect(infraccionesDe(estado, 'x')).toEqual([]);
  });
});

describe('trufisSinInfraccionActiva', () => {
  it('excluye los trufis con infracción activa', () => {
    const ids = TRUFIS_MOCK.map((t) => t.id);
    const estado = reducer(estadoInicial(), {
      type: 'simular-infracciones',
      infracciones: [infraccionActiva({ trufiId: ids[0] })],
    });
    const libres = trufisSinInfraccionActiva(estado, ids);
    expect(libres).not.toContain(ids[0]);
    expect(libres).toHaveLength(ids.length - 1);
  });
});

describe('elegirAleatorios', () => {
  it('si hay menos items que los pedidos, devuelve todos', () => {
    expect(elegirAleatorios(['a', 'b'], 5)).toEqual(['a', 'b']);
  });

  it('con un rng determinístico, elige de forma reproducible', () => {
    const rng = () => 0; // siempre "primero disponible"
    const resultado = elegirAleatorios(['a', 'b', 'c', 'd'], 2, rng);
    expect(resultado).toHaveLength(2);
    expect(resultado[0]).toBe('a');
  });

  it('nunca repite elementos', () => {
    const resultado = elegirAleatorios(['a', 'b', 'c', 'd', 'e'], 3, Math.random);
    expect(new Set(resultado).size).toBe(3);
  });
});

describe('elegirTipoInfraccion', () => {
  it('con una severidad concreta, siempre devuelve un tipo de esa severidad', () => {
    for (const severidad of ['leve', 'media', 'grave'] as const) {
      const tipo = elegirTipoInfraccion(severidad, Math.random);
      expect(tipo.severidad).toBe(severidad);
    }
  });

  it("con 'aleatoria', devuelve un tipo del catálogo completo", () => {
    const tipo = elegirTipoInfraccion('aleatoria', () => 0.999);
    expect(CATALOGO_INFRACCIONES).toContainEqual(tipo);
  });
});

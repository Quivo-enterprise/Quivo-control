import { describe, expect, it } from 'vitest';
import { TRUFIS_MOCK } from '../datos';
import { CATALOGO_INFRACCIONES } from '../catalogo-infracciones';
import type { EstadoFlotaMock, InfraccionMock } from '../tipos';
import {
  elegirAleatorios,
  elegirTipoInfraccion,
  fechaPlazoValida,
  infraccionActivaDe,
  infraccionesDe,
  PLAZO_MAX_DIAS,
  sembrarSanciones,
  trufisSinInfraccionActiva,
} from './flota';
import { estadoInicial, reducer } from './index';

/**
 * `estado/flota.test.ts` — restaura la cobertura de infracciones que tenía el viejo
 * `estado.test.ts` (borrado al partir el reducer en slices, ver `docs/plan-mock-guion-delegado.md`
 * ítem 17). Portado desde `git show HEAD:apps/web/src/lib/mock-flota/estado.test.ts` (rama
 * `mock/sandbox`, commit `fa9c3a2`), adaptado a la firma actual del reducer (`tick` ahora
 * necesita `now`, `estadoInicial` recibe `Date`).
 */

const AHORA = new Date('2026-09-27T12:00:00-04:00');
const AHORA_ISO = AHORA.toISOString();

function infraccionActiva(overrides: Partial<InfraccionMock> = {}): InfraccionMock {
  return {
    id: 'inf-1',
    trufiId: TRUFIS_MOCK[0]!.id,
    tipoId: CATALOGO_INFRACCIONES[0]!.id,
    severidad: 'leve',
    ocurridaEn: AHORA_ISO,
    estado: 'activa',
    ...overrides,
  };
}

describe('reducer — toggle-pausa', () => {
  it('alterna pausado', () => {
    const inicial = estadoInicial(AHORA);
    const pausado = reducer(inicial, { type: 'toggle-pausa' });
    expect(pausado.pausado).toBe(true);
    const reanudado = reducer(pausado, { type: 'toggle-pausa' });
    expect(reanudado.pausado).toBe(false);
  });

  it('con pausado=true, tick no cambia el estado (misma referencia)', () => {
    const pausado: EstadoFlotaMock = { ...estadoInicial(AHORA), pausado: true };
    const siguiente = reducer(pausado, { type: 'tick', now: AHORA_ISO });
    expect(siguiente).toBe(pausado);
  });
});

describe('reducer — simular-infracciones (dedupe)', () => {
  it('agrega las infracciones recibidas', () => {
    const inicial = estadoInicial(AHORA);
    const inf = infraccionActiva();
    const siguiente = reducer(inicial, { type: 'simular-infracciones', infracciones: [inf] });
    expect(siguiente.infracciones).toContainEqual(inf);
  });

  it('no agrega una infracción para un trufi que YA tiene una activa (defensa del reducer)', () => {
    const conUna = reducer(estadoInicial(AHORA), {
      type: 'simular-infracciones',
      infracciones: [infraccionActiva({ id: 'inf-1' })],
    });
    const antes = conUna.infracciones.length;
    const siguiente = reducer(conUna, {
      type: 'simular-infracciones',
      infracciones: [infraccionActiva({ id: 'inf-2' })],
    });
    expect(siguiente.infracciones).toHaveLength(antes);
    expect(siguiente.infracciones.some((i) => i.id === 'inf-2')).toBe(false);
  });
});

describe('reducer — limpiar-infracciones', () => {
  it('sin trufiIds, vacía TODA la lista de infracciones', () => {
    const conInfraccion = reducer(estadoInicial(AHORA), {
      type: 'simular-infracciones',
      infracciones: [infraccionActiva({ trufiId: 'trufi-z12-4' })],
    });
    const limpio = reducer(conInfraccion, { type: 'limpiar-infracciones' });
    expect(limpio.infracciones).toEqual([]);
  });

  it('con trufiIds, borra solo las infracciones de esos trufis y deja el resto intacto', () => {
    const trufiA = 'trufi-z12-4';
    const trufiB = 'trufi-z12-5';
    const conDos = reducer(estadoInicial(AHORA), {
      type: 'simular-infracciones',
      infracciones: [
        infraccionActiva({ id: 'inf-a', trufiId: trufiA }),
        infraccionActiva({ id: 'inf-b', trufiId: trufiB }),
      ],
    });
    const limpio = reducer(conDos, { type: 'limpiar-infracciones', trufiIds: [trufiA] });
    expect(limpio.infracciones.some((i) => i.id === 'inf-a')).toBe(false);
    expect(limpio.infracciones.some((i) => i.id === 'inf-b')).toBe(true);
  });

  it('con trufiIds que no tienen ninguna infracción, no cambia el estado (misma referencia)', () => {
    const trufiA = 'trufi-z12-4';
    const trufiB = 'trufi-z12-5';
    const conUna = reducer(estadoInicial(AHORA), {
      type: 'simular-infracciones',
      infracciones: [infraccionActiva({ id: 'inf-a', trufiId: trufiA })],
    });
    const siguiente = reducer(conUna, { type: 'limpiar-infracciones', trufiIds: [trufiB] });
    expect(siguiente).toBe(conUna);
  });

  it('sin infracciones previas, no cambia el estado (misma referencia)', () => {
    // `estadoInicial` siembra 2 sanciones (`sembrarSanciones`) — para probar el caso "sin
    // infracciones" hay que partir de un estado sin ellas, no de `estadoInicial` directo.
    const inicial: EstadoFlotaMock = { ...estadoInicial(AHORA), infracciones: [] };
    const siguiente = reducer(inicial, { type: 'limpiar-infracciones' });
    expect(siguiente).toBe(inicial);
  });
});

describe('reducer — asignar-parada', () => {
  it('fija siguienteParadaId del trufi indicado', () => {
    const trufiId = TRUFIS_MOCK[0]!.id;
    const siguiente = reducer(estadoInicial(AHORA), {
      type: 'asignar-parada',
      trufiId,
      paradaId: 'villa-armonia',
    });
    expect(siguiente.trufis[trufiId]!.siguienteParadaId).toBe('villa-armonia');
  });

  it('con un trufiId inexistente, no cambia el estado', () => {
    const inicial = estadoInicial(AHORA);
    const siguiente = reducer(inicial, { type: 'asignar-parada', trufiId: 'no-existe', paradaId: 'x' });
    expect(siguiente).toBe(inicial);
  });
});

describe('reducer — aplicar-accion (plazo)', () => {
  it('modo "ahora": marca la infracción como sancionada sin venceEl', () => {
    const accionId = CATALOGO_INFRACCIONES[0]!.acciones[0]!.id;
    const conInfraccion = reducer(estadoInicial(AHORA), {
      type: 'simular-infracciones',
      infracciones: [infraccionActiva()],
    });
    const siguiente = reducer(conInfraccion, {
      type: 'aplicar-accion',
      infraccionId: 'inf-1',
      accionId,
      modo: 'ahora',
      aplicadaEn: AHORA_ISO,
    });
    const infr = siguiente.infracciones.find((i) => i.id === 'inf-1')!;
    expect(infr.estado).toBe('sancionada');
    expect(infr.accionAplicada).toEqual({ accionId, modo: 'ahora', aplicadaEn: AHORA_ISO });
  });

  it('modo "plazo" con venceEl dentro de [hoy, hoy+30d]: aplica y guarda venceEl', () => {
    const accionId = CATALOGO_INFRACCIONES[0]!.acciones[0]!.id;
    const conInfraccion = reducer(estadoInicial(AHORA), {
      type: 'simular-infracciones',
      infracciones: [infraccionActiva()],
    });
    const siguiente = reducer(conInfraccion, {
      type: 'aplicar-accion',
      infraccionId: 'inf-1',
      accionId,
      modo: 'plazo',
      aplicadaEn: AHORA_ISO,
      venceEl: '2026-10-10',
    });
    const infr = siguiente.infracciones.find((i) => i.id === 'inf-1')!;
    expect(infr.estado).toBe('sancionada');
    expect(infr.accionAplicada).toEqual({ accionId, modo: 'plazo', aplicadaEn: AHORA_ISO, venceEl: '2026-10-10' });
  });

  it('modo "plazo" con venceEl fuera de rango (>30 días): IGNORA la acción', () => {
    const accionId = CATALOGO_INFRACCIONES[0]!.acciones[0]!.id;
    const conInfraccion = reducer(estadoInicial(AHORA), {
      type: 'simular-infracciones',
      infracciones: [infraccionActiva()],
    });
    const siguiente = reducer(conInfraccion, {
      type: 'aplicar-accion',
      infraccionId: 'inf-1',
      accionId,
      modo: 'plazo',
      aplicadaEn: AHORA_ISO,
      venceEl: '2027-01-01',
    });
    const infr = siguiente.infracciones.find((i) => i.id === 'inf-1')!;
    expect(infr.estado).toBe('activa');
    expect(infr.accionAplicada).toBeUndefined();
  });

  it('modo "plazo" sin venceEl: ignora la acción', () => {
    const accionId = CATALOGO_INFRACCIONES[0]!.acciones[0]!.id;
    const conInfraccion = reducer(estadoInicial(AHORA), {
      type: 'simular-infracciones',
      infracciones: [infraccionActiva()],
    });
    const siguiente = reducer(conInfraccion, {
      type: 'aplicar-accion',
      infraccionId: 'inf-1',
      accionId,
      modo: 'plazo',
      aplicadaEn: AHORA_ISO,
    });
    expect(siguiente.infracciones.find((i) => i.id === 'inf-1')!.estado).toBe('activa');
  });

  it('sobre una infracción ya sancionada, no hace nada (idempotente)', () => {
    const accionId = CATALOGO_INFRACCIONES[0]!.acciones[0]!.id;
    const sancionada = reducer(
      reducer(estadoInicial(AHORA), { type: 'simular-infracciones', infracciones: [infraccionActiva()] }),
      { type: 'aplicar-accion', infraccionId: 'inf-1', accionId, modo: 'ahora', aplicadaEn: AHORA_ISO },
    );
    const siguiente = reducer(sancionada, {
      type: 'aplicar-accion',
      infraccionId: 'inf-1',
      accionId: CATALOGO_INFRACCIONES[0]!.acciones[1]!.id,
      modo: 'ahora',
      aplicadaEn: AHORA_ISO,
    });
    expect(siguiente).toBe(sancionada);
  });

  it('con un infraccionId inexistente, no cambia el estado', () => {
    const inicial = estadoInicial(AHORA);
    const siguiente = reducer(inicial, {
      type: 'aplicar-accion',
      infraccionId: 'no-existe',
      accionId: 'x',
      modo: 'ahora',
      aplicadaEn: AHORA_ISO,
    });
    expect(siguiente).toBe(inicial);
  });
});

describe('fechaPlazoValida', () => {
  it('exporta PLAZO_MAX_DIAS = 30', () => {
    expect(PLAZO_MAX_DIAS).toBe(30);
  });

  it('hoy mismo es válido', () => {
    expect(fechaPlazoValida('2026-09-27', AHORA_ISO)).toBe(true);
  });

  it('hoy + 30 días es válido (límite inclusive)', () => {
    expect(fechaPlazoValida('2026-10-27', AHORA_ISO)).toBe(true);
  });

  it('hoy + 31 días NO es válido', () => {
    expect(fechaPlazoValida('2026-10-28', AHORA_ISO)).toBe(false);
  });

  it('una fecha pasada NO es válida', () => {
    expect(fechaPlazoValida('2026-09-26', AHORA_ISO)).toBe(false);
  });

  it('una fecha ilegible NO es válida', () => {
    expect(fechaPlazoValida('no-es-una-fecha', AHORA_ISO)).toBe(false);
  });
});

describe('fechaPlazoValida — usa el día calendario LOCAL de `now`, no UTC', () => {
  // Construye `now` con año/mes/día/hora (SIEMPRE interpretado en el huso LOCAL del runtime) y
  // lo pasa como ISO — el roundtrip conserva el instante, pero si `fechaPlazoValida` leyera de
  // vuelta con getters UTC (el bug original), una hora tardía en un huso negativo (Bolivia,
  // UTC-4) correría "hoy" un día para adelante y estos límites se romperían.
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
      ...estadoInicial(AHORA),
      infracciones: [
        infraccionActiva({ id: 'a', trufiId, estado: 'sancionada' }),
        infraccionActiva({ id: 'b', trufiId, estado: 'activa' }),
      ],
    };
    expect(infraccionActivaDe(estado, trufiId)!.id).toBe('b');
    expect(infraccionesDe(estado, trufiId)).toHaveLength(2);
  });

  it('sin infracciones para el trufi, devuelve undefined / []', () => {
    const estado = estadoInicial(AHORA);
    expect(infraccionActivaDe(estado, 'x')).toBeUndefined();
    expect(infraccionesDe(estado, 'x')).toEqual([]);
  });
});

describe('trufisSinInfraccionActiva', () => {
  it('excluye los trufis con infracción activa', () => {
    const ids = TRUFIS_MOCK.map((t) => t.id);
    const estado = reducer(estadoInicial(AHORA), {
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

// ================================================================================================
// Ítem 10 del guion delegado — `sembrarSanciones` nunca siembra en el futuro respecto de `now`.
// ================================================================================================

describe('sembrarSanciones — nunca en el futuro (ítem 10)', () => {
  it('con `now` a media mañana, ninguna sanción sembrada ocurre después de `now`', () => {
    const now = new Date('2026-09-27T07:15:00-04:00');
    const sanciones = sembrarSanciones(now);
    expect(sanciones).toHaveLength(2);
    for (const s of sanciones) {
      expect(Date.parse(s.ocurridaEn)).toBeLessThanOrEqual(now.getTime());
      expect(Date.parse(s.accionAplicada!.aplicadaEn)).toBeLessThanOrEqual(now.getTime());
    }
  });

  it('con `now` antes de las 05:00, no revienta y no siembra nada en el futuro', () => {
    const now = new Date('2026-09-27T04:10:00-04:00');
    const sanciones = sembrarSanciones(now);
    for (const s of sanciones) {
      expect(Date.parse(s.ocurridaEn)).toBeLessThanOrEqual(now.getTime());
    }
  });

  it('es determinístico para el mismo `now`', () => {
    const now = new Date('2026-09-27T12:00:00-04:00');
    expect(sembrarSanciones(now)).toEqual(sembrarSanciones(new Date(now)));
  });
});

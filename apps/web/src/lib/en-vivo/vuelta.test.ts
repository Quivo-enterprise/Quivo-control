import { describe, expect, it } from 'vitest';
import type { PosicionEnVivo, Variante, VueltaPosicion } from '@quivo/shared';
import {
  aplicarDesignacion,
  esSugerido,
  esperaMinDeVariante,
  esperaMolinos,
  estadoAcuse,
  motivoBloqueo,
  opcionSeleccionada,
  textoHudMolinos,
  aplicarDesignacionesPendientes,
  variantesDeEspera,
} from './vuelta';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const vuelta = (extra: Partial<VueltaPosicion> = {}): VueltaPosicion => ({
  numero: 3,
  varianteId: null,
  varianteNombre: null,
  designadaEn: null,
  acuseEn: null,
  enEspera: false,
  esperaDesdeTs: null,
  molinosProxima: false,
  ...extra,
});
const variante = (extra: Partial<Variante> = {}): Variante => ({
  id: id(1),
  rutaId: id(9),
  nombre: 'Vía Molinos',
  estado: 'activo',
  puntoEsperaId: id(50),
  geometria: null,
  ...extra,
});

const AHORA = Date.parse('2026-10-14T18:00:00.000Z');
const hace = (min: number) => new Date(AHORA - min * 60_000).toISOString();

describe('variantesDeEspera / esperaMinDeVariante', () => {
  it('solo activas con punto de espera', () => {
    const lista = [
      variante({ id: id(1) }),
      variante({ id: id(2), puntoEsperaId: null }),
      variante({ id: id(3), estado: 'inactivo' }),
      variante({ id: id(4), puntoEsperaId: undefined }),
    ];
    expect(variantesDeEspera(lista).map((v) => v.id)).toEqual([id(1)]);
    expect(variantesDeEspera(undefined)).toEqual([]);
  });
  it('minutos del punto de espera; 30 si no se conocen', () => {
    const vs = [variante()];
    expect(esperaMinDeVariante(id(1), vs, [{ id: id(50), esperaMin: 45 }])).toBe(45);
    expect(esperaMinDeVariante(id(1), vs, [{ id: id(50), esperaMin: null }])).toBeNull();
    expect(esperaMinDeVariante(id(1), vs, undefined)).toBeNull();
    expect(esperaMinDeVariante(null, vs, [{ id: id(50), esperaMin: 45 }])).toBeNull();
  });
});

describe('esSugerido', () => {
  const linea = { proximoSugeridoEn: hace(1) };
  it('toca enviar: sin Molinos hoy, vuelta sin designar y el próximo sugerido ya pasó', () => {
    expect(esSugerido({ molinosHoy: false, vuelta: vuelta() }, linea, AHORA)).toBe(true);
  });
  it('no si ya fue hoy, si todavía no toca, o sin vuelta/línea', () => {
    expect(esSugerido({ molinosHoy: true, vuelta: vuelta() }, linea, AHORA)).toBe(false);
    expect(esSugerido({ molinosHoy: false, vuelta: vuelta() }, { proximoSugeridoEn: hace(-5) }, AHORA)).toBe(false);
    expect(esSugerido({ molinosHoy: false, vuelta: null }, linea, AHORA)).toBe(false);
    expect(esSugerido({ molinosHoy: false, vuelta: vuelta() }, undefined, AHORA)).toBe(false);
  });
  it('no si ya está designada o en espera', () => {
    expect(esSugerido({ molinosHoy: false, vuelta: vuelta({ varianteId: id(1) }) }, linea, AHORA)).toBe(false);
    expect(esSugerido({ molinosHoy: false, vuelta: vuelta({ enEspera: true }) }, linea, AHORA)).toBe(false);
  });
  it('no si ya está programada para la próxima vuelta', () => {
    expect(esSugerido({ molinosHoy: false, vuelta: vuelta({ molinosProxima: true }) }, linea, AHORA)).toBe(false);
  });
  it('la hora exacta del próximo sugerido cuenta (<=)', () => {
    expect(esSugerido({ molinosHoy: false, vuelta: vuelta() }, { proximoSugeridoEn: hace(0) }, AHORA)).toBe(true);
  });
});

describe('estadoAcuse', () => {
  it('sin designación', () => {
    expect(estadoAcuse(null).tipo).toBe('sin_designacion');
    expect(estadoAcuse(vuelta()).tipo).toBe('sin_designacion');
  });
  it('esperando que el chofer lo vea', () => {
    const e = estadoAcuse(vuelta({ varianteId: id(1), designadaEn: hace(2) }));
    expect(e.tipo).toBe('esperando');
    expect(e.tipo === 'esperando' && e.texto).toMatch(/^Avisado \d{2}:\d{2} · esperando que el chofer lo vea…$/);
  });
  it('visto con hora', () => {
    const e = estadoAcuse(vuelta({ varianteId: id(1), designadaEn: hace(2), acuseEn: hace(1) }));
    expect(e.tipo).toBe('visto');
    expect(e.tipo === 'visto' && e.texto).toMatch(/^Avisado \d{2}:\d{2} · visto ✓ \d{2}:\d{2}$/);
  });
  it('un acuse anterior a la designación vigente no cuenta', () => {
    const e = estadoAcuse(vuelta({ varianteId: id(1), designadaEn: hace(1), acuseEn: hace(5) }));
    expect(e.tipo).toBe('esperando');
  });
});

describe('esperaMolinos', () => {
  it('"en Molinos hace 12 min (faltan 18)"', () => {
    const e = esperaMolinos(hace(12), 30, AHORA)!;
    expect(e.texto).toBe('en Molinos hace 12 min (faltan 18)');
    expect(e.faltanMin).toBe(18);
    expect(e.cumplida).toBe(false);
  });
  it('salida libre (null): "en Molinos hace N min", sin faltan ni cumplida', () => {
    const e = esperaMolinos(hace(35), null, AHORA)!;
    expect(e.texto).toBe('en Molinos hace 35 min');
    expect(e.cumplida).toBe(false);
  });
  it('cumplida cuando pasó el mínimo; nunca faltan negativos', () => {
    const e = esperaMolinos(hace(35), 30, AHORA)!;
    expect(e.faltanMin).toBe(0);
    expect(e.cumplida).toBe(true);
    expect(e.texto).toBe('en Molinos hace 35 min (espera cumplida)');
  });
  it('minutos hacia abajo y reloj adelantado no da negativos', () => {
    expect(esperaMolinos(new Date(AHORA - 59_000).toISOString(), 30, AHORA)!.transcurridoMin).toBe(0);
    expect(esperaMolinos(new Date(AHORA + 60_000).toISOString(), 30, AHORA)!.transcurridoMin).toBe(0);
  });
  it('sin llegada o fecha inválida: null', () => {
    expect(esperaMolinos(null, 30, AHORA)).toBeNull();
    expect(esperaMolinos('x', 30, AHORA)).toBeNull();
  });
});

describe('motivoBloqueo / opcionSeleccionada', () => {
  it('sin vuelta: todavía no pasó por la terminal', () => {
    expect(motivoBloqueo(null)).toBe('Todavía no pasó por la terminal.');
  });
  it('en espera: cerrada', () => {
    expect(motivoBloqueo(vuelta({ enEspera: true }))).toMatch(/Ya llegó a Molinos/);
  });
  it('libre: null', () => {
    expect(motivoBloqueo(vuelta())).toBeNull();
  });
  it('ya llegó hoy y la vuelta actual no está designada: bloqueada', () => {
    expect(motivoBloqueo(vuelta(), true)).toBe('Ya fue a Molinos hoy.');
  });
  it('ya llegó hoy pero la vuelta actual está designada: no bloquea por eso', () => {
    expect(motivoBloqueo(vuelta({ varianteId: id(1) }), true)).toBeNull();
  });
  it('en espera gana sobre "ya fue hoy"', () => {
    expect(motivoBloqueo(vuelta({ enEspera: true }), true)).toMatch(/Ya llegó a Molinos/);
  });
  it('opción: directo o la variante', () => {
    expect(opcionSeleccionada(vuelta())).toBe('directo');
    expect(opcionSeleccionada(null)).toBe('directo');
    expect(opcionSeleccionada(vuelta({ varianteId: id(1) }))).toBe(id(1));
  });
});

describe('aplicarDesignacion (optimista)', () => {
  const p = { vuelta: vuelta({ varianteId: null }) } as PosicionEnVivo;
  it('designa limpiando el acuse', () => {
    const r = aplicarDesignacion(
      { vuelta: vuelta({ varianteId: id(1), designadaEn: hace(9), acuseEn: hace(8) }) } as PosicionEnVivo,
      id(2),
      'Vía Molinos',
      hace(0),
    );
    expect(r.vuelta).toMatchObject({ varianteId: id(2), varianteNombre: 'Vía Molinos', designadaEn: hace(0), acuseEn: null });
  });
  it('cancelar deja todo en null', () => {
    const r = aplicarDesignacion(
      { vuelta: vuelta({ varianteId: id(1), varianteNombre: 'x', designadaEn: hace(9) }) } as PosicionEnVivo,
      null,
      null,
      hace(0),
    );
    expect(r.vuelta).toMatchObject({ varianteId: null, varianteNombre: null, designadaEn: null, acuseEn: null });
  });
  it('diferida: marca molinosProxima y no toca la designación de la vuelta actual', () => {
    const r = aplicarDesignacion(p, id(2), 'Vía Molinos', hace(0), true);
    expect(r.vuelta).toMatchObject({ varianteId: null, designadaEn: null, molinosProxima: true });
  });
  it('designar o cancelar limpia molinosProxima', () => {
    const conProxima = { vuelta: vuelta({ molinosProxima: true }) } as PosicionEnVivo;
    expect(aplicarDesignacion(conProxima, null, null, hace(0)).vuelta?.molinosProxima).toBe(false);
  });
  it('sin vuelta no inventa una', () => {
    expect(aplicarDesignacion({ vuelta: null } as PosicionEnVivo, id(2), 'x', hace(0))).toEqual({ vuelta: null });
    expect(aplicarDesignacion(p, id(2), 'x', hace(0)).vuelta?.varianteId).toBe(id(2));
  });
});

describe('textoHudMolinos', () => {
  const l = (extra = {}) => ({
    lineaId: id(1),
    lineaNombre: 'Línea 16',
    enEspera: 2,
    esperaDesdeTs: hace(10),
    ultimoEnvioTs: hace(4),
    flotaActiva: 40,
    sinMolinosHoy: 30,
    intervaloObjetivoMs: 900_000,
    proximoSugeridoEn: new Date(AHORA + 3 * 60_000).toISOString(),
    ...extra,
  });
  it('en espera, último envío y próximo sugerido', () => {
    expect(textoHudMolinos(l(), AHORA)).toBe('2 en espera · último envío hace 4 min · próximo sugerido en 3 min');
  });
  it('sin envíos hoy y ya toca', () => {
    expect(textoHudMolinos(l({ enEspera: 0, ultimoEnvioTs: null, proximoSugeridoEn: hace(1) }), AHORA)).toBe(
      '0 en espera · sin envíos hoy · ya toca enviar',
    );
  });
  it('faltan segundos: redondea hacia arriba, mínimo 1 min', () => {
    expect(textoHudMolinos(l({ proximoSugeridoEn: new Date(AHORA + 20_000).toISOString() }), AHORA)).toMatch(/en 1 min$/);
  });
  it('timestamps inválidos: el texto no contiene NaN', () => {
    const t = textoHudMolinos(l({ ultimoEnvioTs: 'basura', proximoSugeridoEn: 'basura' }), AHORA);
    expect(t).not.toContain('NaN');
    expect(t).toBe('2 en espera · sin envíos hoy');
  });
  it('envío de hace menos de 1 min', () => {
    expect(textoHudMolinos(l({ ultimoEnvioTs: hace(0) }), AHORA)).toContain('último envío hace instantes');
  });
});
describe('aplicarDesignacionesPendientes', () => {
  it('una pendiente con proxima marca molinosProxima', () => {
    const pos = { id: 'a', vuelta: vuelta() } as PosicionEnVivo;
    const r = aplicarDesignacionesPendientes(
      [pos],
      new Map([['a', { varianteId: id(2), varianteNombre: 'x', ahoraIso: hace(0), proxima: true }]]),
    );
    expect(r[0]!.vuelta).toMatchObject({ varianteId: null, molinosProxima: true });
  });
  it('designación en vuelo no cambia la posición (misma referencia); cancelar en vuelo sí aplica', () => {
    const base = { id: 'a', vuelta: vuelta({ varianteId: id(1), designadaEn: hace(9) }) } as PosicionEnVivo;
    const enVuelo = { varianteId: id(2), varianteNombre: 'x', ahoraIso: hace(0), enVuelo: true };
    expect(aplicarDesignacionesPendientes([base], new Map([['a', enVuelo]]))[0]).toBe(base);
    const cancel = { varianteId: null, varianteNombre: null, ahoraIso: hace(0), enVuelo: false };
    expect(aplicarDesignacionesPendientes([base], new Map([['a', cancel]]))[0]!.vuelta).toMatchObject({ varianteId: null, designadaEn: null });
  });
  const pos = (idp: string, varianteId: string | null) =>
    ({ id: idp, vuelta: { numero: 1, varianteId, varianteNombre: null, designadaEn: null, acuseEn: null, enEspera: false } }) as unknown as PosicionEnVivo;
  const pendiente = { varianteId: id(7), varianteNombre: 'Vía Molinos', ahoraIso: hace(0) };

  it('sin pendientes devuelve el mismo array', () => {
    const lista = [pos('a', null)];
    expect(aplicarDesignacionesPendientes(lista, new Map())).toBe(lista);
  });
  it('pisa el valor del poll solo en la sesión pendiente', () => {
    const lista = [pos('a', null), pos('b', null)];
    const r = aplicarDesignacionesPendientes(lista, new Map([['a', pendiente]]));
    expect(r[0]!.vuelta?.varianteId).toBe(id(7));
    expect(r[0]!.vuelta?.designadaEn).toBe(pendiente.ahoraIso);
    expect(r[1]).toBe(lista[1]);
  });
  it('una pendiente de una sesión que ya no está se ignora', () => {
    expect(aplicarDesignacionesPendientes([pos('a', null)], new Map([['z', pendiente]]))[0]!.vuelta?.varianteId).toBeNull();
  });
});

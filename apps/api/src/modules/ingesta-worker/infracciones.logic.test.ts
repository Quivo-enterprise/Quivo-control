import { describe, expect, it } from 'vitest';
import {
  VENTANA_RECORRIDO_TOLERANCIA_MS,
  construirRecorridos,
  dedupeKeyDesvio,
  descartarFuturos,
  recorridoCerradoEn,
  recorridoDeInstante,
  recorridoIniciadoEn,
  dedupeKeyPcOmitido,
  resolverGravedadInfraccion,
  seleccionarPcOmitidos,
  type PuntoControlCandidato,
  type ReglaCandidata,
} from './infracciones.logic.js';

function regla(parcial: Partial<ReglaCandidata> & { id: string }): ReglaCandidata {
  return {
    tipo: 'desvio_ruta',
    gravedad: 'gravisima',
    estado: 'activo',
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...parcial,
  };
}

describe('resolverGravedadInfraccion', () => {
  it('sin regla: defaults desvío → grave, PC omitido → leve, sin reglaId', () => {
    expect(resolverGravedadInfraccion('desvio_ruta', [])).toEqual({ gravedad: 'grave', reglaId: null });
    expect(resolverGravedadInfraccion('pc_omitido', [])).toEqual({ gravedad: 'leve', reglaId: null });
  });

  it('usa gravedad y id de la regla activa con el tipo reservado EXACTO', () => {
    const r = regla({ id: 'r1', tipo: 'pc_omitido', gravedad: 'grave' });
    expect(resolverGravedadInfraccion('pc_omitido', [r])).toEqual({ gravedad: 'grave', reglaId: 'r1' });
  });

  it('ignora reglas inactivas, de otro tipo o con tipo no exacto (mayúsculas/espacios)', () => {
    const reglas = [
      regla({ id: 'inactiva', estado: 'inactivo' }),
      regla({ id: 'otro', tipo: 'pc_omitido' }),
      regla({ id: 'mayus', tipo: 'Desvio_Ruta' }),
      regla({ id: 'espacio', tipo: 'desvio_ruta ' }),
    ];
    expect(resolverGravedadInfraccion('desvio_ruta', reglas)).toEqual({ gravedad: 'grave', reglaId: null });
  });

  it('con varias reglas elige la de updatedAt más reciente', () => {
    const reglas = [
      regla({ id: 'vieja', gravedad: 'leve', updatedAt: new Date('2026-01-01T00:00:00.000Z') }),
      regla({ id: 'nueva', gravedad: 'gravisima', updatedAt: new Date('2026-09-01T00:00:00.000Z') }),
      regla({ id: 'media', gravedad: 'grave', updatedAt: new Date('2026-05-01T00:00:00.000Z') }),
    ];
    expect(resolverGravedadInfraccion('desvio_ruta', reglas)).toEqual({ gravedad: 'gravisima', reglaId: 'nueva' });
  });

  it('una regla con gravedad fuera de dominio se ignora (cae al default)', () => {
    expect(resolverGravedadInfraccion('desvio_ruta', [regla({ id: 'x', gravedad: 'extrema' })])).toEqual({
      gravedad: 'grave',
      reglaId: null,
    });
  });
});

describe('seleccionarPcOmitidos', () => {
  const pc = (id: string, orden: number, extra: Partial<PuntoControlCandidato> = {}): PuntoControlCandidato => ({
    id,
    orden,
    obligatorio: true,
    estado: 'activo',
    lat: -17.78,
    lng: -63.18,
    ...extra,
  });
  const pcs = [pc('pc3', 3), pc('pc1', 1), pc('pc2', 2), pc('pc4', 4)];

  it('en vivo: los de orden menor al cumplido que no tienen cumplimiento, en orden ascendente', () => {
    const omitidos = seleccionarPcOmitidos(pcs, new Set(), 3, 'pc3');
    expect(omitidos.map((p) => p.id)).toEqual(['pc1', 'pc2']);
  });

  it('excluye los que ya tienen cumplimiento en la ventana', () => {
    const omitidos = seleccionarPcOmitidos(pcs, new Set(['pc1']), 3, 'pc3');
    expect(omitidos.map((p) => p.id)).toEqual(['pc2']);
  });

  it('excluye opcionales e inactivos', () => {
    const lista = [pc('a', 1, { obligatorio: false }), pc('b', 2, { estado: 'inactivo' }), pc('c', 3)];
    expect(seleccionarPcOmitidos(lista, new Set(), 10).map((p) => p.id)).toEqual(['c']);
  });

  it('nunca incluye el PC recién cumplido ni los de orden posterior', () => {
    const omitidos = seleccionarPcOmitidos(pcs, new Set(), 2, 'pc2');
    expect(omitidos.map((p) => p.id)).toEqual(['pc1']);
  });

  it('al fin_recorrido (límite infinito) devuelve todos los obligatorios sin cumplir', () => {
    const omitidos = seleccionarPcOmitidos(pcs, new Set(['pc2', 'pc3']), Number.POSITIVE_INFINITY);
    expect(omitidos.map((p) => p.id)).toEqual(['pc1', 'pc4']);
  });

  it('si el PC cumplido es el de orden 1 no hay omitidos', () => {
    expect(seleccionarPcOmitidos(pcs, new Set(), 1, 'pc1')).toEqual([]);
  });
});

describe('dedupe keys', () => {
  it('son estables y usan el instante ISO', () => {
    const ts = new Date('2026-10-12T15:00:00.000Z');
    expect(dedupeKeyDesvio('s1', ts)).toBe('desvio:s1:2026-10-12T15:00:00.000Z');
    expect(dedupeKeyPcOmitido('s1', 'pc1', ts)).toBe('pc_omitido:s1:pc1:2026-10-12T15:00:00.000Z');
  });
});

describe('recorridos (ventanas de PC omitido y gating de desvío)', () => {
  const T0 = Date.parse('2026-10-12T15:00:00.000Z');
  const t = (seg: number) => new Date(T0 + seg * 1000);
  const ini = (seg: number) => ({ tipo: 'inicio_recorrido' as const, ts: t(seg) });
  const fin = (seg: number) => ({ tipo: 'fin_recorrido' as const, ts: t(seg) });
  const TOL = VENTANA_RECORRIDO_TOLERANCIA_MS / 1000;

  it('la tolerancia es de 2 minutos', () => {
    expect(VENTANA_RECORRIDO_TOLERANCIA_MS).toBe(120_000);
  });

  it('construye recorridos [inicio - tolerancia, fin); orden de llegada irrelevante', () => {
    const rs = construirRecorridos([fin(1000), ini(500)]);
    expect(rs).toHaveLength(1);
    expect(rs[0]).toEqual({ inicioTs: t(500), desde: t(500 - TOL), finTs: t(1000), hasta: t(1000) });
  });

  it('un fin huérfano se ignora; un inicio con otro abierto lo cierra implícitamente', () => {
    expect(construirRecorridos([fin(10)])).toEqual([]);
    const rs = construirRecorridos([ini(1000), ini(3000)]);
    expect(rs[0]).toMatchObject({ inicioTs: t(1000), finTs: null, hasta: t(3000) });
    expect(rs[1]).toMatchObject({ inicioTs: t(3000), finTs: null, hasta: null });
  });

  it('la tolerancia inferior nunca retrocede más allá del cierre del recorrido anterior', () => {
    const rs = construirRecorridos([ini(0), fin(1000), ini(1060)]);
    expect(rs[1]!.desde).toEqual(t(1000)); // 1060 - 120 = 940 < fin anterior (1000)
  });

  it('un instante pertenece al recorrido que lo contiene; antes del inicio dentro de la tolerancia también', () => {
    const rs = construirRecorridos([ini(1000), fin(2000)]);
    expect(recorridoDeInstante(rs, t(1500))?.inicioTs).toEqual(t(1000));
    expect(recorridoDeInstante(rs, t(1000 - TOL))?.inicioTs).toEqual(t(1000));
    expect(recorridoDeInstante(rs, t(1000 - TOL - 1))).toBeNull();
    expect(recorridoDeInstante(rs, t(2000))).toBeNull(); // el fin es exclusivo
    expect(recorridoDeInstante(rs, t(2500))).toBeNull();
  });

  it('con dos recorridos, un instante del segundo NO se asigna al primero (ventana superior)', () => {
    const rs = construirRecorridos([ini(0), fin(1000), ini(3000), fin(4000)]);
    expect(recorridoDeInstante(rs, t(900))?.inicioTs).toEqual(t(0));
    expect(recorridoDeInstante(rs, t(2000))).toBeNull(); // traslado en vacío
    expect(recorridoDeInstante(rs, t(3500))?.inicioTs).toEqual(t(3000));
  });

  it('búsqueda por inicio y por fin', () => {
    const rs = construirRecorridos([ini(0), fin(1000)]);
    expect(recorridoIniciadoEn(rs, t(0))?.finTs).toEqual(t(1000));
    expect(recorridoCerradoEn(rs, t(1000))?.inicioTs).toEqual(t(0));
    expect(recorridoCerradoEn(rs, t(999))).toBeNull();
  });
});

describe('descartarFuturos', () => {
  it('descarta lo posterior a ahora + tolerancia y conserva lo anterior', () => {
    const ahora = Date.parse('2026-10-12T15:00:00.000Z');
    const items = [
      { ts: new Date(ahora - 3_600_000) },
      { ts: new Date(ahora + 300_000) }, // justo en el límite: se conserva
      { ts: new Date(ahora + 300_001) },
      { ts: new Date(ahora + 86_400_000) },
    ];
    expect(descartarFuturos(items, ahora, 300_000)).toEqual(items.slice(0, 2));
  });
});

import { describe, expect, it } from 'vitest';
import { TRUFIS_MOCK } from '../datos';
import { infraccionDeNovedad } from './novedades';
import { estadoInicial, reducer } from './index';

/** Ítem 12 del guion delegado: `NovedadMock.infraccionId` se vincula SOLO cuando la infracción
 * se crea de verdad. */

const AHORA = new Date('2026-09-27T12:00:00-04:00');
const AHORA_ISO = AHORA.toISOString();

describe('infraccionId — simular-desvio', () => {
  it('vincula la novedad con la infracción "Desvío de ruta" recién creada', () => {
    const estado = estadoInicial(AHORA);
    const trufi = TRUFIS_MOCK.find((t) => estado.trufis[t.id]!.fase === 'en_ruta')!;
    const siguiente = reducer(estado, {
      type: 'simular-desvio',
      trufiId: trufi.id,
      now: AHORA_ISO,
      novedadId: 'nov-desvio-1',
      infraccionId: 'inf-desvio-1',
    });
    const novedad = siguiente.novedades.find((n) => n.id === 'nov-desvio-1')!;
    expect(novedad.infraccionId).toBe('inf-desvio-1');
    expect(infraccionDeNovedad(siguiente, 'nov-desvio-1')?.id).toBe('inf-desvio-1');
  });

  it('si el trufi YA tenía una infracción activa, la novedad queda SIN infraccionId (la infracción se descarta por dedupe)', () => {
    let estado = estadoInicial(AHORA);
    const trufi = TRUFIS_MOCK.find((t) => estado.trufis[t.id]!.fase === 'en_ruta')!;
    estado = reducer(estado, {
      type: 'simular-infracciones',
      infracciones: [
        {
          id: 'inf-previa',
          trufiId: trufi.id,
          tipoId: 'exceso-de-velocidad',
          severidad: 'grave',
          ocurridaEn: AHORA_ISO,
          estado: 'activa',
        },
      ],
    });
    const siguiente = reducer(estado, {
      type: 'simular-desvio',
      trufiId: trufi.id,
      now: AHORA_ISO,
      novedadId: 'nov-desvio-2',
      infraccionId: 'inf-desvio-2',
    });
    const novedad = siguiente.novedades.find((n) => n.id === 'nov-desvio-2')!;
    expect(novedad.infraccionId).toBeUndefined();
    expect(siguiente.infracciones.some((i) => i.id === 'inf-desvio-2')).toBe(false);
    expect(infraccionDeNovedad(siguiente, 'nov-desvio-2')).toBeUndefined();
  });
});

describe('infraccionId — crear-infraccion-desde-novedad', () => {
  it('vincula la novedad con la infracción creada a partir de ella', () => {
    let estado = estadoInicial(AHORA);
    const trufi = TRUFIS_MOCK.find((t) => estado.trufis[t.id]!.fase === 'en_ruta')!;
    estado = reducer(estado, {
      type: 'simular-reporte-conductor',
      trufiId: trufi.id,
      subtipo: 'falla_mecanica',
      now: AHORA_ISO,
      novedadId: 'nov-reporte-1',
    });
    const siguiente = reducer(estado, {
      type: 'crear-infraccion-desde-novedad',
      novedadId: 'nov-reporte-1',
      tipoId: 'retraso-de-frecuencia',
      infraccionId: 'inf-desde-novedad-1',
      now: AHORA_ISO,
    });
    const novedad = siguiente.novedades.find((n) => n.id === 'nov-reporte-1')!;
    expect(novedad.infraccionId).toBe('inf-desde-novedad-1');
    expect(infraccionDeNovedad(siguiente, 'nov-reporte-1')?.tipoId).toBe('retraso-de-frecuencia');
  });

  it('no-opea si el trufi de la novedad ya tiene una infracción activa', () => {
    let estado = estadoInicial(AHORA);
    const trufi = TRUFIS_MOCK.find((t) => estado.trufis[t.id]!.fase === 'en_ruta')!;
    estado = reducer(estado, {
      type: 'simular-reporte-conductor',
      trufiId: trufi.id,
      subtipo: 'falla_mecanica',
      now: AHORA_ISO,
      novedadId: 'nov-reporte-2',
    });
    estado = reducer(estado, {
      type: 'simular-infracciones',
      infracciones: [
        {
          id: 'inf-previa-2',
          trufiId: trufi.id,
          tipoId: 'exceso-de-velocidad',
          severidad: 'grave',
          ocurridaEn: AHORA_ISO,
          estado: 'activa',
        },
      ],
    });
    const siguiente = reducer(estado, {
      type: 'crear-infraccion-desde-novedad',
      novedadId: 'nov-reporte-2',
      tipoId: 'retraso-de-frecuencia',
      infraccionId: 'inf-no-debe-crearse',
      now: AHORA_ISO,
    });
    expect(siguiente.infracciones.some((i) => i.id === 'inf-no-debe-crearse')).toBe(false);
    expect(siguiente.novedades.find((n) => n.id === 'nov-reporte-2')!.infraccionId).toBeUndefined();
  });
});

describe('novedades sembradas de desvío no tienen infraccionId', () => {
  it('ninguna novedad sembrada trae infraccionId', () => {
    const estado = estadoInicial(AHORA);
    for (const n of estado.novedades) {
      expect(n.infraccionId).toBeUndefined();
    }
  });
});

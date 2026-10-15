import { describe, expect, it } from 'vitest';
import {
  ANCHO_MAX_DP,
  ANCHO_MIN_DP,
  BORDE_CASING_DP,
  COLOR_CASING_DESIGNACION,
  COLOR_CASING_LINEA,
  COLOR_DESIGNACION,
  COLOR_ESPERA,
  COLOR_LINEA,
  COLOR_CASING_TRAMO_CALCULADO,
  COLOR_TRAMO_CALCULADO,
  GROSOR_DESIGNACION_ESPERA_DP,
  anchoLineaDp,
  cuantizarZoom,
  debeResaltarRutaCalculada,
  estiloDesignacion,
  estiloRuta,
  estiloTramoCalculado,
  estiloTramo,
  zoomParaEncuadre,
} from './estilo-ruta';

const LAT = -17.4;

describe('cuantizarZoom', () => {
  it('redondea a pasos de 0.25', () => {
    expect(cuantizarZoom(18)).toBe(18);
    expect(cuantizarZoom(18.1)).toBe(18);
    expect(cuantizarZoom(18.13)).toBe(18.25);
    expect(cuantizarZoom(17.9)).toBe(18);
  });
  it('zooms dentro del mismo paso dan el mismo valor', () => {
    expect(cuantizarZoom(16.6)).toBe(cuantizarZoom(16.55));
  });
});

describe('anchoLineaDp (7 m de calzada, lat -17.4)', () => {
  it('zoom 14 y 16: clamp mínimo (8 dp)', () => {
    expect(anchoLineaDp(14, LAT)).toBe(ANCHO_MIN_DP);
    expect(anchoLineaDp(16, LAT)).toBe(ANCHO_MIN_DP);
  });
  it('zoom 18: ~12.3 dp', () => {
    expect(anchoLineaDp(18, LAT)).toBeCloseTo(12.28, 1);
  });
  it('zoom 20: clamp máximo (24 dp)', () => {
    expect(anchoLineaDp(20, LAT)).toBe(ANCHO_MAX_DP);
  });
  it('crece con el zoom (17 -> 18)', () => {
    expect(anchoLineaDp(18, LAT)).toBeGreaterThan(anchoLineaDp(17, LAT));
  });
  it('a mayor latitud, la misma calzada ocupa más dp', () => {
    expect(anchoLineaDp(18, -60)).toBeGreaterThan(anchoLineaDp(18, 0));
  });
});

describe('estiloRuta', () => {
  it('en espera: oscura (#1E1B4B), fina y sin borde', () => {
    expect(estiloRuta(false, 18, LAT)).toEqual({
      color: '#1E1B4B',
      grosor: 4.5,
      colorCasing: null,
      grosorCasing: 0,
    });
    expect(COLOR_ESPERA).toBe('#1E1B4B');
  });

  it('en seguimiento: azul primario con borde más oscuro y más ancho', () => {
    const e = estiloRuta(true, 18, LAT);
    expect(e.color).toBe('#3226B4');
    expect(COLOR_LINEA).toBe('#3226B4');
    expect(e.colorCasing).toBe(COLOR_CASING_LINEA);
    expect(e.grosor).toBeCloseTo(anchoLineaDp(18, LAT), 5);
    expect(e.grosorCasing).toBeCloseTo(e.grosor + 2 * BORDE_CASING_DP, 5);
  });

  it('el color de la designación se distingue del de la base', () => {
    expect(COLOR_DESIGNACION).not.toBe(COLOR_LINEA);
    expect(COLOR_DESIGNACION).toBe('#FD9E15');
    expect(COLOR_CASING_DESIGNACION).toBe('#C96800');
    expect(COLOR_CASING_LINEA).toBe('#1E176C');
  });
});

describe('estiloTramo', () => {
  it('con tracking: ancho por zoom, color y casing propios', () => {
    const e = estiloTramo(COLOR_DESIGNACION, COLOR_CASING_DESIGNACION, 18, LAT, true);
    expect(e.color).toBe(COLOR_DESIGNACION);
    expect(e.colorCasing).toBe(COLOR_CASING_DESIGNACION);
    expect(e.grosor).toBeCloseTo(anchoLineaDp(18, LAT), 5);
    expect(e.grosorCasing).toBeCloseTo(e.grosor + 2 * BORDE_CASING_DP, 5);
  });
  it('sin tracking: 4.5 dp fijo, sin casing, conserva el color', () => {
    expect(estiloTramo(COLOR_DESIGNACION, COLOR_CASING_DESIGNACION, 18, LAT, false)).toEqual({
      color: COLOR_DESIGNACION,
      grosor: 4.5,
      colorCasing: null,
      grosorCasing: 0,
    });
  });
});

describe('estiloDesignacion', () => {
  it('con tracking: igual que estiloTramo de la designación', () => {
    expect(estiloDesignacion(18, LAT, true)).toEqual(
      estiloTramo(COLOR_DESIGNACION, COLOR_CASING_DESIGNACION, 18, LAT, true),
    );
  });
  it('sin tracking: más ancho que la base en espera y con borde', () => {
    const e = estiloDesignacion(18, LAT, false);
    expect(e.grosor).toBe(GROSOR_DESIGNACION_ESPERA_DP);
    expect(e.grosor).toBeGreaterThan(estiloRuta(false, 18, LAT).grosor);
    expect(e.colorCasing).toBe(COLOR_CASING_DESIGNACION);
    expect(e.grosorCasing).toBeCloseTo(e.grosor + 2 * BORDE_CASING_DP, 5);
  });
});

describe('estiloTramoCalculado (OSRM)', () => {
  it('banda blanca bajo trazo oscuro, más fino que la base y con borde', () => {
    const e = estiloTramoCalculado(18, LAT);
    expect(e.color).toBe(COLOR_TRAMO_CALCULADO);
    expect(e.colorCasing).toBe(COLOR_CASING_TRAMO_CALCULADO);
    expect(e.grosor).toBeCloseTo(anchoLineaDp(18, LAT) * 0.7, 5);
    expect(e.grosor).toBeLessThan(estiloRuta(true, 18, LAT).grosor);
    expect(e.grosorCasing).toBeCloseTo(e.grosor + 2 * BORDE_CASING_DP, 5);
  });
  it('a zoom bajo hereda el piso de la base (70 % de 8 dp)', () => {
    expect(estiloTramoCalculado(12, LAT).grosor).toBeCloseTo(ANCHO_MIN_DP * 0.7, 5);
  });
  it('no usa el color de la base ni el de la designación', () => {
    expect(COLOR_TRAMO_CALCULADO).not.toBe(COLOR_LINEA);
    expect(COLOR_TRAMO_CALCULADO).not.toBe(COLOR_DESIGNACION);
  });
});

describe('zoomParaEncuadre', () => {
  const pad = { top: 80, right: 20, bottom: 180, left: 20 };
  it('una ruta de ~2 km cabe a un zoom razonable (14-16)', () => {
    const z = zoomParaEncuadre(
      [
        { latitude: -17.38, longitude: -66.2 },
        { latitude: -17.4, longitude: -66.18 },
      ],
      400,
      800,
      pad,
    );
    expect(z).not.toBeNull();
    expect(z as number).toBeGreaterThan(13);
    expect(z as number).toBeLessThan(17);
  });
  it('sin coords o sin área útil -> null', () => {
    expect(zoomParaEncuadre([], 400, 800, pad)).toBeNull();
    expect(zoomParaEncuadre([{ latitude: 0, longitude: 0 }], 30, 800, pad)).toBeNull();
  });
});

describe('debeResaltarRutaCalculada (tramo OSRM)', () => {
  const tramo: [number, number][] = [
    [-58.4, -34.6],
    [-58.41, -34.61],
  ];

  it('solo con tracking y al menos 2 puntos', () => {
    expect(debeResaltarRutaCalculada(true, tramo)).toBe(true);
  });

  it('en espera no se resalta aunque exista el tramo', () => {
    expect(debeResaltarRutaCalculada(false, tramo)).toBe(false);
  });

  it('sin tramo calculado (null) o con menos de 2 puntos no se resalta', () => {
    expect(debeResaltarRutaCalculada(true, null)).toBe(false);
    expect(debeResaltarRutaCalculada(true, [])).toBe(false);
    expect(debeResaltarRutaCalculada(true, [[-58.4, -34.6]])).toBe(false);
  });
});

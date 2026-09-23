import { describe, expect, it } from 'vitest';
import {
  construirMensajesEstadoMapa,
  esHandshakeMapaListo,
  type EstadoMapaProtocolo,
} from './route-map-protocol';

describe('construirMensajesEstadoMapa', () => {
  const estadoBase: EstadoMapaProtocolo = {
    tracking: false,
    proximoPuntoControlId: null,
    posicionActual: null,
    rutaCalculada: null,
  };

  it('manda tracking y proximoPuntoControl siempre, en ese orden, al principio', () => {
    const mensajes = construirMensajesEstadoMapa(estadoBase);
    expect(JSON.parse(mensajes[0]!)).toEqual({ type: 'tracking', active: false });
    expect(JSON.parse(mensajes[1]!)).toEqual({ type: 'proximoPuntoControl', id: null });
  });

  it('omite el mensaje de position cuando no hay posición conocida (no manda position: null)', () => {
    const mensajes = construirMensajesEstadoMapa(estadoBase);
    const tipos = mensajes.map((m) => (JSON.parse(m) as { type: string }).type);
    expect(tipos).not.toContain('position');
    expect(tipos).toEqual(['tracking', 'proximoPuntoControl', 'ruta-calculada']);
  });

  it('incluye el mensaje position con lat/lng cuando sí hay una posición conocida', () => {
    const mensajes = construirMensajesEstadoMapa({
      ...estadoBase,
      posicionActual: { lat: -17.38, lng: -66.15 },
    });
    const mensajePosicion = mensajes.find((m) => (JSON.parse(m) as { type: string }).type === 'position');
    expect(mensajePosicion).toBeDefined();
    expect(JSON.parse(mensajePosicion!)).toEqual({ type: 'position', lat: -17.38, lng: -66.15 });
  });

  it('manda ruta-calculada siempre al final, incluso cuando es null (todavía no hay ruta de OSRM)', () => {
    const mensajes = construirMensajesEstadoMapa(estadoBase);
    const ultimo = JSON.parse(mensajes[mensajes.length - 1]!) as { type: string; coordinates: unknown };
    expect(ultimo.type).toBe('ruta-calculada');
    expect(ultimo.coordinates).toBeNull();
  });

  it('propaga las coordenadas de la ruta calculada tal cual, sin transformarlas', () => {
    const coords: [number, number][] = [
      [-17.38, -66.15],
      [-17.37, -66.14],
    ];
    const mensajes = construirMensajesEstadoMapa({ ...estadoBase, rutaCalculada: coords });
    const mensajeRuta = mensajes.find((m) => (JSON.parse(m) as { type: string }).type === 'ruta-calculada');
    expect(JSON.parse(mensajeRuta!)).toEqual({ type: 'ruta-calculada', coordinates: coords });
  });

  it('propaga proximoPuntoControlId cuando no es null', () => {
    const mensajes = construirMensajesEstadoMapa({
      ...estadoBase,
      proximoPuntoControlId: 'p0000000-0000-4000-8000-000000000002',
    });
    const mensajePunto = JSON.parse(mensajes[1]!) as { type: string; id: string };
    expect(mensajePunto.id).toBe('p0000000-0000-4000-8000-000000000002');
  });

  it('refleja tracking activo', () => {
    const mensajes = construirMensajesEstadoMapa({ ...estadoBase, tracking: true });
    expect(JSON.parse(mensajes[0]!)).toEqual({ type: 'tracking', active: true });
  });
});

describe('esHandshakeMapaListo', () => {
  it('reconoce el mensaje mapa-listo que emite el HTML', () => {
    expect(esHandshakeMapaListo(JSON.stringify({ type: 'mapa-listo' }))).toBe(true);
  });

  it('ignora otros tipos de mensaje conocidos del protocolo (no son el handshake)', () => {
    expect(esHandshakeMapaListo(JSON.stringify({ type: 'tracking', active: true }))).toBe(false);
    expect(esHandshakeMapaListo(JSON.stringify({ type: 'position', lat: 1, lng: 2 }))).toBe(false);
  });

  it('no tira con JSON inválido — devuelve false', () => {
    expect(esHandshakeMapaListo('esto no es JSON')).toBe(false);
  });

  it('no tira con valores que no son string', () => {
    expect(esHandshakeMapaListo(undefined)).toBe(false);
    expect(esHandshakeMapaListo(null)).toBe(false);
    expect(esHandshakeMapaListo(42)).toBe(false);
    expect(esHandshakeMapaListo({ type: 'mapa-listo' })).toBe(false);
  });

  it('no tira con JSON válido que no es un objeto (array, string, número)', () => {
    expect(esHandshakeMapaListo(JSON.stringify(['mapa-listo']))).toBe(false);
    expect(esHandshakeMapaListo(JSON.stringify('mapa-listo'))).toBe(false);
    expect(esHandshakeMapaListo(JSON.stringify(42))).toBe(false);
    expect(esHandshakeMapaListo(JSON.stringify(null))).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  construirMensajeFotosVehiculos,
  construirMensajeOtrosVehiculos,
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

  // Demo-only (`docs/plan-apk-demo-conductor.md`, paso B) — `otrosVehiculos` es `undefined` en la
  // app real, así que el mensaje `otros-vehiculos` no debe aparecer sin que el caller lo pida
  // explícitamente (a diferencia de `position`, que se omite por falta de dato, acá se omite por
  // falta de la FEATURE, nunca por un array vacío).
  it('no manda otros-vehiculos cuando otrosVehiculos es undefined (app real)', () => {
    const mensajes = construirMensajesEstadoMapa(estadoBase);
    const tipos = mensajes.map((m) => (JSON.parse(m) as { type: string }).type);
    expect(tipos).not.toContain('otros-vehiculos');
  });

  it('manda otros-vehiculos AL FINAL (y fotos-vehiculos justo antes) cuando viene un array vacío (demo, sin compañeros en ruta)', () => {
    const mensajes = construirMensajesEstadoMapa({ ...estadoBase, otrosVehiculos: [] });
    const ultimo = JSON.parse(mensajes[mensajes.length - 1]!) as { type: string; vehiculos: unknown[] };
    const penultimo = JSON.parse(mensajes[mensajes.length - 2]!) as { type: string; fotos: unknown };
    expect(ultimo).toEqual({ type: 'otros-vehiculos', vehiculos: [] });
    expect(penultimo).toEqual({ type: 'fotos-vehiculos', fotos: {} });
  });

  // FIX POST-REVISIÓN (hallazgo de revisión — "la foto de ~3 KB viaja de nuevo cada segundo"):
  // la foto de cada vehículo ya NO viaja dentro de 'otros-vehiculos' (ese mensaje ahora es
  // liviano: solo id/lat/lng/color) — viaja UNA vez en 'fotos-vehiculos', como un diccionario
  // id -> data URI. `construirMensajesEstadoMapa` sigue mandando ambos (fotos primero) cuando hay
  // que reenviar el estado COMPLETO (handshake/carga); el reenvío recurrente de posición en cada
  // tick usa `construirMensajeOtrosVehiculos` solo — ver esos dos describes más abajo.
  it('separa fotos (fotos-vehiculos) de posición (otros-vehiculos, sin fotoDataUri)', () => {
    const vehiculos = [
      { id: 'trufi-z12-1', lat: -17.38, lng: -66.15, fotoDataUri: 'data:image/jpeg;base64,abc', color: '#2563eb' },
      { id: 'trufi-z12-2', lat: -17.37, lng: -66.14, fotoDataUri: 'data:image/jpeg;base64,def', color: '#2563eb' },
    ];
    const mensajes = construirMensajesEstadoMapa({ ...estadoBase, otrosVehiculos: vehiculos });

    const mensajeFotos = mensajes.find((m) => (JSON.parse(m) as { type: string }).type === 'fotos-vehiculos');
    expect(JSON.parse(mensajeFotos!)).toEqual({
      type: 'fotos-vehiculos',
      fotos: { 'trufi-z12-1': 'data:image/jpeg;base64,abc', 'trufi-z12-2': 'data:image/jpeg;base64,def' },
    });

    const mensajeVehiculos = mensajes.find((m) => (JSON.parse(m) as { type: string }).type === 'otros-vehiculos');
    expect(JSON.parse(mensajeVehiculos!)).toEqual({
      type: 'otros-vehiculos',
      vehiculos: [
        { id: 'trufi-z12-1', lat: -17.38, lng: -66.15, color: '#2563eb' },
        { id: 'trufi-z12-2', lat: -17.37, lng: -66.14, color: '#2563eb' },
      ],
    });
    // `fotoDataUri` NO debe aparecer en el mensaje liviano.
    expect(mensajeVehiculos).not.toContain('fotoDataUri');
  });
});

describe('construirMensajeFotosVehiculos', () => {
  it('arma un diccionario id -> fotoDataUri', () => {
    const vehiculos = [
      { id: 'a', lat: 0, lng: 0, fotoDataUri: 'data:x', color: '#000' },
      { id: 'b', lat: 0, lng: 0, fotoDataUri: 'data:y', color: '#000' },
    ];
    expect(JSON.parse(construirMensajeFotosVehiculos(vehiculos))).toEqual({
      type: 'fotos-vehiculos',
      fotos: { a: 'data:x', b: 'data:y' },
    });
  });

  it('un array vacío produce un diccionario vacío (no `undefined`)', () => {
    expect(JSON.parse(construirMensajeFotosVehiculos([]))).toEqual({ type: 'fotos-vehiculos', fotos: {} });
  });
});

describe('construirMensajeOtrosVehiculos', () => {
  it('nunca incluye fotoDataUri, solo id/lat/lng/color', () => {
    const vehiculos = [{ id: 'a', lat: -17.1, lng: -66.1, fotoDataUri: 'data:pesado', color: '#2563eb' }];
    const mensaje = JSON.parse(construirMensajeOtrosVehiculos(vehiculos));
    expect(mensaje).toEqual({ type: 'otros-vehiculos', vehiculos: [{ id: 'a', lat: -17.1, lng: -66.1, color: '#2563eb' }] });
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

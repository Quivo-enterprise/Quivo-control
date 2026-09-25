import { describe, expect, it } from 'vitest';
import { RADIO_CONFIRMACION_M } from '@quivo/shared';
import { claveCumplimiento, type DeteccionPuntoControl, type EstadoPuntoControl } from '../../gps/geofence';
import {
  decidirAnuncio,
  evaluarAnuncioDeHeartbeat,
  evaluarAnunciosDeFixes,
  UMBRAL_ANUNCIO_PROXIMIDAD_MS,
  type EstadoAnuncioVisita,
} from './decidir-anuncio';

const FRESCO: EstadoAnuncioVisita = { anunciado: false, desdeMs: undefined };

describe('decidirAnuncio — tabla de verdad (función pura, sin I/O)', () => {
  it('proximidad: fix activa con distanciaM <= radioConfirmacionM', () => {
    const { motivo, estado } = decidirAnuncio(
      FRESCO,
      { tipo: 'fix', visita: 'activa', distanciaM: 35, radioConfirmacionM: RADIO_CONFIRMACION_M },
      1_000,
    );
    expect(motivo).toBe('proximidad');
    expect(estado).toEqual({ anunciado: true, desdeMs: 1_000 });
  });

  it('NO proximidad: fix activa con distanciaM > radioConfirmacionM (y sin vencer el timeout)', () => {
    const { motivo, estado } = decidirAnuncio(
      FRESCO,
      { tipo: 'fix', visita: 'activa', distanciaM: 100, radioConfirmacionM: RADIO_CONFIRMACION_M },
      1_000,
    );
    expect(motivo).toBeNull();
    expect(estado).toEqual({ anunciado: false, desdeMs: 1_000 });
  });

  it('fallback-tiempo a 90 s: fix activa, lejos del radio, pero ya pasó UMBRAL_ANUNCIO_PROXIMIDAD_MS desde la entrada', () => {
    const estadoEntrada: EstadoAnuncioVisita = { anunciado: false, desdeMs: 0 };
    const { motivo, estado } = decidirAnuncio(
      estadoEntrada,
      { tipo: 'fix', visita: 'activa', distanciaM: 100, radioConfirmacionM: RADIO_CONFIRMACION_M },
      UMBRAL_ANUNCIO_PROXIMIDAD_MS,
    );
    expect(motivo).toBe('fallback-tiempo');
    expect(estado.anunciado).toBe(true);
  });

  it('fallback-tiempo NO dispara un instante antes del umbral (89.9 s)', () => {
    const estadoEntrada: EstadoAnuncioVisita = { anunciado: false, desdeMs: 0 };
    const { motivo } = decidirAnuncio(
      estadoEntrada,
      { tipo: 'fix', visita: 'activa', distanciaM: 100, radioConfirmacionM: RADIO_CONFIRMACION_M },
      UMBRAL_ANUNCIO_PROXIMIDAD_MS - 100,
    );
    expect(motivo).toBeNull();
  });

  it('fallback-tiempo también dispara sobre un HEARTBEAT (sin fix nuevo)', () => {
    const estadoEntrada: EstadoAnuncioVisita = { anunciado: false, desdeMs: 0 };
    const { motivo } = decidirAnuncio(estadoEntrada, { tipo: 'heartbeat' }, UMBRAL_ANUNCIO_PROXIMIDAD_MS + 1);
    expect(motivo).toBe('fallback-tiempo');
  });

  it('un HEARTBEAT nunca decide "proximidad" (no trae distancia real)', () => {
    const { motivo } = decidirAnuncio(FRESCO, { tipo: 'heartbeat' }, 1_000);
    expect(motivo).toBeNull();
  });

  it('fallback-salida: fix "saliendo" (re-armado real) sin haber anunciado nunca', () => {
    const { motivo, estado } = decidirAnuncio(
      FRESCO,
      { tipo: 'fix', visita: 'saliendo', distanciaM: 999, radioConfirmacionM: RADIO_CONFIRMACION_M },
      1_000,
    );
    expect(motivo).toBe('fallback-salida');
    expect(estado.anunciado).toBe(true);
  });

  it('ya anunciado: `motivo: null` sin importar la entrada, y el estado no cambia', () => {
    const yaAnunciado: EstadoAnuncioVisita = { anunciado: true, desdeMs: 500 };
    const resultadoFix = decidirAnuncio(
      yaAnunciado,
      { tipo: 'fix', visita: 'activa', distanciaM: 1, radioConfirmacionM: RADIO_CONFIRMACION_M },
      99_999,
    );
    const resultadoSaliendo = decidirAnuncio(
      yaAnunciado,
      { tipo: 'fix', visita: 'saliendo', distanciaM: 999, radioConfirmacionM: RADIO_CONFIRMACION_M },
      99_999,
    );
    const resultadoHeartbeat = decidirAnuncio(yaAnunciado, { tipo: 'heartbeat' }, 99_999);

    expect(resultadoFix).toEqual({ motivo: null, estado: yaAnunciado });
    expect(resultadoSaliendo).toEqual({ motivo: null, estado: yaAnunciado });
    expect(resultadoHeartbeat).toEqual({ motivo: null, estado: yaAnunciado });
  });

  it('nueva pasada: un estadoAnuncio fresco ({anunciado:false, desdeMs:undefined}) vuelve a poder decidir', () => {
    // El caller (evaluarAnunciosDeFixes, vía geofence.ts) resetea el estado en cada ENTRADA —
    // acá solo se verifica que un estado fresco se comporta como "nunca anunciado", sin
    // arrastrar nada de una visita/pasada anterior.
    const { motivo } = decidirAnuncio(
      FRESCO,
      { tipo: 'fix', visita: 'activa', distanciaM: 10, radioConfirmacionM: RADIO_CONFIRMACION_M },
      50_000,
    );
    expect(motivo).toBe('proximidad');
  });

  it('desdeMs ausente se trata como "recién entrando ahora" (nunca revienta, nunca dispara el fallback de inmediato)', () => {
    const { motivo, estado } = decidirAnuncio(
      { anunciado: false, desdeMs: undefined },
      { tipo: 'fix', visita: 'activa', distanciaM: 999, radioConfirmacionM: RADIO_CONFIRMACION_M },
      5_000,
    );
    expect(motivo).toBeNull();
    expect(estado.desdeMs).toBe(5_000);
  });
});

function estadoVisitaActiva(overrides: Partial<EstadoPuntoControl> = {}): EstadoPuntoControl {
  return {
    dentro: true,
    ultimoEmitidoMs: -Infinity,
    pasadas: 0,
    confirmado: false,
    puntoControlId: 'pc-1',
    radioToleranciaM: 150,
    anuncioHecho: false,
    anuncioDesdeMs: 0,
    ...overrides,
  };
}

function deteccionCruda(distanciaM: number, puntoControlId = 'pc-1'): DeteccionPuntoControl {
  return { puntoControlId, distanciaM, cumplido: distanciaM <= 150, radioToleranciaM: 150 };
}

describe('evaluarAnunciosDeFixes — orquestador (único punto de llamada, fixes)', () => {
  it('visita recién ENTRANDO (no en estadosAntes) con distancia <= radio: decide "proximidad" de inmediato', () => {
    const sesionId = 'sesion-1';
    const clave = claveCumplimiento(sesionId, 'pc-1');
    const estadosAntes = new Map<string, EstadoPuntoControl>();
    const transicionesEstado = new Map<string, EstadoPuntoControl>([
      [clave, estadoVisitaActiva({ pasadas: 0 })],
    ]);

    const { anuncios, transiciones } = evaluarAnunciosDeFixes(
      estadosAntes,
      transicionesEstado,
      [deteccionCruda(20)],
      [],
      sesionId,
      1_000,
    );

    expect(anuncios).toEqual([
      { motivo: 'proximidad', puntoControlId: 'pc-1', pasada: 1, distanciaM: 20, radioToleranciaM: 150 },
    ]);
    expect(transiciones.get(clave)?.anuncioHecho).toBe(true);
  });

  it('visita ya anunciada (anuncioHecho: true) — no vuelve a decidir nada', () => {
    const sesionId = 'sesion-1';
    const clave = claveCumplimiento(sesionId, 'pc-1');
    const estadosAntes = new Map<string, EstadoPuntoControl>([[clave, estadoVisitaActiva({ anuncioHecho: true })]]);
    const transicionesEstado = new Map<string, EstadoPuntoControl>([
      [clave, estadoVisitaActiva({ anuncioHecho: true })],
    ]);

    const { anuncios, transiciones } = evaluarAnunciosDeFixes(
      estadosAntes,
      transicionesEstado,
      [deteccionCruda(5)],
      [],
      sesionId,
      1_000,
    );

    expect(anuncios).toEqual([]);
    expect(transiciones.size).toBe(0);
  });

  it('fallback-salida: puntosRearmados incluye el punto y la visita estaba activa antes — decide sin importar la distancia actual', () => {
    const sesionId = 'sesion-1';
    const clave = claveCumplimiento(sesionId, 'pc-1');
    const estadosAntes = new Map<string, EstadoPuntoControl>([[clave, estadoVisitaActiva()]]);
    const transicionesEstado = new Map<string, EstadoPuntoControl>([
      [clave, estadoVisitaActiva({ dentro: false, confirmado: true, pasadas: 1 })],
    ]);

    const { anuncios } = evaluarAnunciosDeFixes(
      estadosAntes,
      transicionesEstado,
      [deteccionCruda(999)],
      ['pc-1'],
      sesionId,
      1_000,
    );

    expect(anuncios).toEqual([
      { motivo: 'fallback-salida', puntoControlId: 'pc-1', pasada: 1, distanciaM: 999, radioToleranciaM: 150 },
    ]);
  });

  it('sin visita relevante (ni activa ni saliendo): no decide nada', () => {
    const sesionId = 'sesion-1';
    const clave = claveCumplimiento(sesionId, 'pc-1');
    const transicionesEstado = new Map<string, EstadoPuntoControl>([
      [clave, { dentro: false, ultimoEmitidoMs: -Infinity, pasadas: 0 }],
    ]);

    const { anuncios } = evaluarAnunciosDeFixes(
      new Map(),
      transicionesEstado,
      [deteccionCruda(500)],
      [],
      sesionId,
      1_000,
    );

    expect(anuncios).toEqual([]);
  });

  it('fix sin transición este tick (descartado por A3): se ignora sin reventar', () => {
    const { anuncios, transiciones } = evaluarAnunciosDeFixes(
      new Map(),
      new Map(),
      [deteccionCruda(20)],
      [],
      'sesion-1',
      1_000,
    );
    expect(anuncios).toEqual([]);
    expect(transiciones.size).toBe(0);
  });
});

describe('evaluarAnuncioDeHeartbeat — orquestador (único punto de llamada, heartbeats)', () => {
  it('visita activa sin anunciar, vencido el umbral: fallback-tiempo', () => {
    const clave = claveCumplimiento('sesion-1', 'pc-1');
    const estados = new Map<string, EstadoPuntoControl>([
      [clave, estadoVisitaActiva({ anuncioDesdeMs: 0, minDistanciaM: 90 })],
    ]);

    const { anuncios, transiciones } = evaluarAnuncioDeHeartbeat(estados, UMBRAL_ANUNCIO_PROXIMIDAD_MS + 1);

    expect(anuncios).toEqual([
      { motivo: 'fallback-tiempo', puntoControlId: 'pc-1', pasada: 1, distanciaM: 90, radioToleranciaM: 150 },
    ]);
    expect(transiciones.get(clave)?.anuncioHecho).toBe(true);
  });

  it('vehículo detenido dentro del radio de detección — un heartbeat ANTES del umbral NO decide nada todavía', () => {
    const clave = claveCumplimiento('sesion-1', 'pc-1');
    const estados = new Map<string, EstadoPuntoControl>([[clave, estadoVisitaActiva({ anuncioDesdeMs: 0 })]]);

    const { anuncios } = evaluarAnuncioDeHeartbeat(estados, UMBRAL_ANUNCIO_PROXIMIDAD_MS - 100);
    expect(anuncios).toEqual([]);
  });

  it('visita ya anunciada: no decide de nuevo', () => {
    const clave = claveCumplimiento('sesion-1', 'pc-1');
    const estados = new Map<string, EstadoPuntoControl>([
      [clave, estadoVisitaActiva({ anuncioHecho: true, anuncioDesdeMs: 0 })],
    ]);

    const { anuncios } = evaluarAnuncioDeHeartbeat(estados, UMBRAL_ANUNCIO_PROXIMIDAD_MS + 1);
    expect(anuncios).toEqual([]);
  });

  it('visita no activa (dentro: false): ignorada', () => {
    const clave = claveCumplimiento('sesion-1', 'pc-1');
    const estados = new Map<string, EstadoPuntoControl>([
      [clave, estadoVisitaActiva({ dentro: false, anuncioDesdeMs: 0 })],
    ]);

    const { anuncios } = evaluarAnuncioDeHeartbeat(estados, UMBRAL_ANUNCIO_PROXIMIDAD_MS + 1);
    expect(anuncios).toEqual([]);
  });

  it('nunca decide "proximidad" (un heartbeat no trae fix nuevo)', () => {
    const clave = claveCumplimiento('sesion-1', 'pc-1');
    const estados = new Map<string, EstadoPuntoControl>([
      [clave, estadoVisitaActiva({ anuncioDesdeMs: 0, minDistanciaM: 5 })],
    ]);

    const { anuncios } = evaluarAnuncioDeHeartbeat(estados, UMBRAL_ANUNCIO_PROXIMIDAD_MS - 100);
    expect(anuncios).toEqual([]); // ni siquiera con minDistanciaM=5: solo decide por TIEMPO
  });
});

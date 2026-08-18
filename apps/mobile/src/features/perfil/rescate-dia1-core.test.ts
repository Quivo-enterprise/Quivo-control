import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Location } from 'react-native-background-geolocation';
import { TOLERANCIA_TS_FIX_PASADO_MS, uuidV7Schema } from '@quivo/shared';
import {
  construirEventoRescatado,
  derivarEventIdRescate,
  filtrarPuntosRescatables,
  type Sha256Hex,
} from './rescate-dia1-core';

/**
 * SHA-256 de `node:crypto` para los tests — `rescate-dia1.ts` (impuro) usa `expo-crypto` en
 * el dispositivo, pero es el MISMO algoritmo estándar, así que el digest de bytes (y por lo
 * tanto el `eventId` derivado) es idéntico sin importar quién lo calcule. Ver el comentario de
 * `Sha256Hex` en `rescate-dia1-core.ts`.
 */
const sha256HexNode: Sha256Hex = async (input) =>
  createHash('sha256').update(input).digest('hex');

function ubicacion(
  uuid: string,
  timestamp: Location['timestamp'],
  lat = -17.78,
  lng = -63.18,
): Location {
  return {
    timestamp,
    recorded_at: timestamp,
    age: 0,
    odometer: 0,
    odometer_error: 0,
    is_moving: true,
    uuid,
    coords: { latitude: lat, longitude: lng, accuracy: 5, speed: 0 },
    battery: { level: 0.8, is_charging: false },
    activity: { type: 'in_vehicle', confidence: 90 },
  };
}

describe('derivarEventIdRescate', () => {
  it('mismo uuid + mismo timestamp produce siempre el mismo eventId (H1.a)', async () => {
    const location = ubicacion('loc-uuid-abc', '2026-08-14T12:00:00.000Z');
    const id1 = await derivarEventIdRescate(location, sha256HexNode);
    const id2 = await derivarEventIdRescate(location, sha256HexNode);
    expect(id1).toBe(id2);
  });

  it('el eventId derivado pasa uuidV7Schema (versión 7 y variante RFC)', async () => {
    const location = ubicacion('loc-uuid-abc', '2026-08-14T12:00:00.000Z');
    const eventId = await derivarEventIdRescate(location, sha256HexNode);
    expect(() => uuidV7Schema.parse(eventId)).not.toThrow();
  });

  it('produce un eventId distinto para un location.uuid distinto', async () => {
    const id1 = await derivarEventIdRescate(
      ubicacion('loc-uuid-a', '2026-08-14T12:00:00.000Z'),
      sha256HexNode,
    );
    const id2 = await derivarEventIdRescate(
      ubicacion('loc-uuid-b', '2026-08-14T12:00:00.000Z'),
      sha256HexNode,
    );
    expect(id1).not.toBe(id2);
  });
});

describe('construirEventoRescatado', () => {
  it('arma el evento gps_point con el eventId determinístico y el tsFix del punto', async () => {
    const location = ubicacion('loc-uuid-1', '2026-08-14T12:00:00.000Z');
    const evento = await construirEventoRescatado(location, 'sesion-1', sha256HexNode);
    expect(evento).not.toBeNull();
    expect(evento?.tipo).toBe('gps_point');
    expect(evento?.payload).toMatchObject({
      sesionId: 'sesion-1',
      lat: -17.78,
      lng: -63.18,
      tsFix: '2026-08-14T12:00:00.000Z',
    });
    expect(() => uuidV7Schema.parse(evento!.eventId)).not.toThrow();
  });

  it('un re-run sobre el MISMO punto produce el mismo eventId (sin duplicar evidencia)', async () => {
    const location = ubicacion('loc-uuid-1', '2026-08-14T12:00:00.000Z');
    const primero = await construirEventoRescatado(location, 'sesion-1', sha256HexNode);
    const segundo = await construirEventoRescatado(location, 'sesion-1', sha256HexNode);
    expect(primero?.eventId).toBe(segundo?.eventId);
  });

  it('devuelve null (defensa redundante) si el timestamp es ilegible, en vez de encolar con una fecha inventada', async () => {
    // Nota: en el flujo real (`rescatarPuntosDia1`) este caso ya lo intercepta
    // `filtrarPuntosRescatables` ANTES de llegar acá (ver `timestampIlegible` más abajo) —
    // este test cubre `construirEventoRescatado` en aislado, como defensa redundante.
    const location = ubicacion('loc-uuid-2', 'no-es-una-fecha');
    const evento = await construirEventoRescatado(location, 'sesion-1', sha256HexNode);
    expect(evento).toBeNull();
  });

  it('B4: el eventId es estable entre sesionId distintos — un re-run ocurre por definición en otra sesión (otro turno, re-login)', async () => {
    // Ancla la propiedad de la que depende H1.a: `derivarEventIdRescate` NO debe mirar
    // `sesionId` para nada. Sin este test, una refactorización que metiera `sesionId` en el
    // digest rompería la idempotencia de un re-run sin que ningún otro test lo note (los de
    // arriba siempre usan la misma `sesionId`).
    const location = ubicacion('loc-uuid-3', '2026-08-14T12:00:00.000Z');
    const primero = await construirEventoRescatado(location, 'sesion-A', sha256HexNode);
    const segundo = await construirEventoRescatado(location, 'sesion-B', sha256HexNode);
    expect(primero?.eventId).toBe(segundo?.eventId);
  });

  it('B4: accuracy/speed ausentes en location.coords caen a null en el payload (no undefined)', async () => {
    const base = ubicacion('loc-uuid-4', '2026-08-14T12:00:00.000Z');
    const location: Location = {
      ...base,
      coords: { ...base.coords, accuracy: undefined as unknown as number, speed: undefined },
    };
    const evento = await construirEventoRescatado(location, 'sesion-1', sha256HexNode);
    expect(evento?.payload.accuracy).toBeNull();
    expect(evento?.payload.speed).toBeNull();
  });

  it('M3: marca el payload con origen: "rescate" para que use-gps-operativo.ts pueda excluirlo de su ventana de medición', async () => {
    const location = ubicacion('loc-uuid-5', '2026-08-14T12:00:00.000Z');
    const evento = await construirEventoRescatado(location, 'sesion-1', sha256HexNode);
    expect(evento?.payload.origen).toBe('rescate');
  });
});

describe('filtrarPuntosRescatables', () => {
  const ahora = new Date('2026-08-14T12:00:00.000Z');

  it('un punto reciente y legible va a rescatables', () => {
    const punto = ubicacion('a', '2026-08-14T10:00:00.000Z');
    const resultado = filtrarPuntosRescatables([punto], ahora);
    expect(resultado).toEqual({
      rescatables: [punto],
      omitidosPorAntiguedad: [],
      timestampIlegible: [],
    });
  });

  it('M2: ya NO hay corte superior — un punto posterior a `ahora` sigue siendo rescatable', () => {
    // Decisión tomada (M2): el corte superior de H1.b se eliminó por completo porque su
    // premisa ("los puntos posteriores ya los encoló el camino normal") es falsa en varios
    // escenarios reales (paquete del día vencido, sesión cerrada, app en foreground sin
    // `iniciar()`) y en esos casos dejaba el punto INALCANZABLE para siempre.
    const puntoFuturo = ubicacion('b', '2026-08-15T00:00:00.000Z');
    const resultado = filtrarPuntosRescatables([puntoFuturo], ahora);
    expect(resultado.rescatables).toEqual([puntoFuturo]);
  });

  it('C1/M4: un punto más viejo que TOLERANCIA_TS_FIX_PASADO_MS va a omitidosPorAntiguedad, no se pierde en silencio', () => {
    const msViejo = ahora.getTime() - TOLERANCIA_TS_FIX_PASADO_MS - 1;
    const punto = ubicacion('c', new Date(msViejo).toISOString());
    const resultado = filtrarPuntosRescatables([punto], ahora);
    expect(resultado.omitidosPorAntiguedad).toEqual([punto]);
    expect(resultado.rescatables).toHaveLength(0);
  });

  it('un punto exactamente en el borde de la tolerancia (no estrictamente más viejo) sigue siendo rescatable', () => {
    const msBorde = ahora.getTime() - TOLERANCIA_TS_FIX_PASADO_MS;
    const punto = ubicacion('d', new Date(msBorde).toISOString());
    const resultado = filtrarPuntosRescatables([punto], ahora);
    expect(resultado.rescatables).toEqual([punto]);
    expect(resultado.omitidosPorAntiguedad).toHaveLength(0);
  });

  it('A3: un timestamp ilegible (NaN) va a timestampIlegible, no se confunde con "viejo" ni pasa como rescatable', () => {
    // Antes de este fix, `new Date('basura').getTime()` es NaN y `NaN < corteMs` es
    // `false` — el punto se colaba como rescatable. Ahora se detecta explícitamente primero.
    const punto = ubicacion('e', 'no-es-una-fecha');
    const resultado = filtrarPuntosRescatables([punto], ahora);
    expect(resultado.timestampIlegible).toEqual([punto]);
    expect(resultado.rescatables).toHaveLength(0);
    expect(resultado.omitidosPorAntiguedad).toHaveLength(0);
  });

  it('separa correctamente una mezcla de los tres casos en la misma llamada', () => {
    const rescatable = ubicacion('f', '2026-08-14T11:00:00.000Z');
    const viejo = ubicacion('g', new Date(ahora.getTime() - TOLERANCIA_TS_FIX_PASADO_MS - 1).toISOString());
    const ilegible = ubicacion('h', 'basura');
    const resultado = filtrarPuntosRescatables([rescatable, viejo, ilegible], ahora);
    expect(resultado.rescatables).toEqual([rescatable]);
    expect(resultado.omitidosPorAntiguedad).toEqual([viejo]);
    expect(resultado.timestampIlegible).toEqual([ilegible]);
  });
});

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Location } from 'react-native-background-geolocation';
import { uuidV7Schema } from '@quivo/shared';
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

  it('devuelve null (H6) si el timestamp es ilegible, en vez de encolar con una fecha inventada', async () => {
    const location = ubicacion('loc-uuid-2', 'no-es-una-fecha');
    const evento = await construirEventoRescatado(location, 'sesion-1', sha256HexNode);
    expect(evento).toBeNull();
  });
});

describe('filtrarPuntosRescatables', () => {
  const antes = () => ubicacion('a', '2026-08-14T10:00:00.000Z');
  const despues = () => ubicacion('b', '2026-08-14T14:00:00.000Z');

  it('sin corte (null) no filtra nada — las otras defensas hacen su trabajo solas', () => {
    const resultado = filtrarPuntosRescatables([antes(), despues()], null);
    expect(resultado).toHaveLength(2);
  });

  it('solo deja pasar los puntos ANTERIORES al corte (H1.b)', () => {
    const corte = new Date('2026-08-14T12:00:00.000Z');
    const puntoAntes = antes();
    const puntoDespues = despues();
    const resultado = filtrarPuntosRescatables([puntoAntes, puntoDespues], corte);
    expect(resultado).toEqual([puntoAntes]);
  });

  it('excluye un punto exactamente en el corte (estrictamente ANTERIOR, no <=)', () => {
    const corte = new Date('2026-08-14T12:00:00.000Z');
    const puntoEnElCorte = ubicacion('c', '2026-08-14T12:00:00.000Z');
    const resultado = filtrarPuntosRescatables([puntoEnElCorte], corte);
    expect(resultado).toHaveLength(0);
  });
});

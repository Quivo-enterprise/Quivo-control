import { describe, expect, it } from 'vitest';
import type { Location } from 'react-native-background-geolocation';
import type { PuntoControlPaquete } from '@quivo/shared';
import { claveCumplimiento } from './geofence';
import {
  clavesCumplimientoDesdePayloads,
  construirEventosDeUbicacion,
  type ContextoUbicacion,
} from './location-task';

function ubicacion(
  lat: number,
  lng: number,
  timestamp: Location['timestamp'] = '2026-08-14T12:00:00.000Z',
): Location {
  return {
    timestamp,
    // Transistorsoft v5: `recorded_at`/`odometer_error` son campos nuevos y obligatorios del
    // tipo `Location` (antes no existían). El código de producción no los usa — sólo se
    // agregan acá para satisfacer el tipo del mock.
    recorded_at: timestamp,
    age: 0,
    odometer: 0,
    odometer_error: 0,
    is_moving: true,
    uuid: 'loc-uuid-1',
    coords: { latitude: lat, longitude: lng, accuracy: 5, speed: 0 },
    battery: { level: 0.8, is_charging: false },
    activity: { type: 'in_vehicle', confidence: 90 },
  };
}

function puntoControl(
  id: string,
  coord: [number, number],
  radioToleranciaM = 30,
): PuntoControlPaquete {
  return {
    id,
    orden: 0,
    coord: { type: 'Point', coordinates: coord },
    radioToleranciaM,
    obligatorio: true,
  };
}

function contexto(
  puntosControl: PuntoControlPaquete[] = [],
  sesionId = 'sesion-1',
): ContextoUbicacion {
  return { deviceId: 'android:device-1', sesionId, puntosControl };
}

describe('construirEventosDeUbicacion', () => {
  it('siempre construye el evento gps_point con el payload de la ubicación (evidencia RF-67..73)', () => {
    const { eventos, deteccion } = construirEventosDeUbicacion(
      ubicacion(-17.78, -63.18),
      contexto(),
      new Set(),
    );
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toEqual({
      tipo: 'gps_point',
      payload: {
        sesionId: 'sesion-1',
        lat: -17.78,
        lng: -63.18,
        accuracy: 5,
        speed: 0,
        tsFix: '2026-08-14T12:00:00.000Z',
      },
    });
    expect(deteccion).toBeNull();
  });

  it('propaga el timestamp del FIX GPS al payload, no el momento de encolado', () => {
    // Camino headless: el SDK entrega la ubicación bufferada mucho después del fix real, y
    // `encolarEvento` sella el sobre con `new Date()` — sin `tsFix`, un tramo entero de
    // manejo aterrizaría en `gps_points` con timestamps casi idénticos.
    const { eventos } = construirEventosDeUbicacion(
      ubicacion(-17.78, -63.18, '2026-08-14T11:42:07.500Z'),
      contexto(),
      new Set(),
    );
    expect(eventos[0]?.payload['tsFix']).toBe('2026-08-14T11:42:07.500Z');
  });

  it('normaliza un timestamp numérico (epoch ms, Transistorsoft v5) a ISO-8601 en tsFix', () => {
    // v4 tipaba `Location.timestamp` como `string`; v5 lo ensanchó a `string | number` (epoch
    // ms en el caso numérico). Sin normalizar, `tsFix` pasaba el número tal cual y perdía el
    // `.datetime()` de Zod en `resolverTsFix` (`@quivo/shared`), que caía en silencio al `ts`
    // de encolado — la deformación del recorrido que `tsFix` existe para evitar.
    const epochMs = Date.parse('2026-08-14T11:42:07.500Z');
    const { eventos } = construirEventosDeUbicacion(
      ubicacion(-17.78, -63.18, epochMs),
      contexto(),
      new Set(),
    );
    expect(eventos[0]?.payload['tsFix']).toBe('2026-08-14T11:42:07.500Z');
  });

  it('cae a tsFix undefined (nunca "Invalid Date") ante un timestamp ilegible', () => {
    const { eventos } = construirEventosDeUbicacion(
      ubicacion(-17.78, -63.18, 'no-es-una-fecha'),
      contexto(),
      new Set(),
    );
    expect(eventos[0]?.payload['tsFix']).toBeUndefined();
  });

  it('agrega cumplimiento_punto_control cuando el punto cae dentro del radio de un punto de control nuevo', () => {
    const pc = puntoControl('pc-1', [-63.18, -17.78], 30);
    const detectados = new Set<string>();
    const { eventos, deteccion } = construirEventosDeUbicacion(
      ubicacion(-17.78, -63.18),
      contexto([pc]),
      detectados,
    );
    expect(eventos).toHaveLength(2);
    expect(eventos[1]?.tipo).toBe('cumplimiento_punto_control');
    expect(eventos[1]?.payload).toMatchObject({ sesionId: 'sesion-1', puntoControlId: 'pc-1' });
    expect(deteccion?.puntoControlId).toBe('pc-1');
    // El Set se muta in-place con la clave SCOPEADA POR SESIÓN: el caller (hook o headless
    // task) lo reutiliza tick a tick, y en headless también entre sesiones distintas.
    expect(detectados.has(claveCumplimiento('sesion-1', 'pc-1'))).toBe(true);
    expect(detectados.has('pc-1')).toBe(false);
  });

  it('propaga el timestamp del FIX GPS al payload de cumplimiento_punto_control (evidencia RF-64..66)', () => {
    // Misma `location` que produce el `gps_point`, así que el fix ya disponible se replica
    // tal cual — sin esto la hora de paso por el punto de control (el hecho que sustenta una
    // sanción) quedaría corrida al momento del encolado bajo el camino headless.
    const pc = puntoControl('pc-1', [-63.18, -17.78], 30);
    const { eventos } = construirEventosDeUbicacion(
      ubicacion(-17.78, -63.18, '2026-08-14T11:42:07.500Z'),
      contexto([pc]),
      new Set(),
    );
    expect(eventos[1]?.payload['tsFix']).toBe('2026-08-14T11:42:07.500Z');
  });

  it('no repite cumplimiento_punto_control si el punto de control ya estaba detectado', () => {
    const pc = puntoControl('pc-1', [-63.18, -17.78], 30);
    const detectados = new Set<string>([claveCumplimiento('sesion-1', 'pc-1')]);
    const { eventos, deteccion } = construirEventosDeUbicacion(
      ubicacion(-17.78, -63.18),
      contexto([pc]),
      detectados,
    );
    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.tipo).toBe('gps_point');
    expect(deteccion).toBeNull();
  });

  it('emite el cumplimiento de una sesión NUEVA aunque el punto de control ya se haya registrado en la anterior', () => {
    // El Set del headless task vive todo el contexto JS y nadie lo resetea al cambiar de
    // sesión: ruta A terminada con pc-1 registrado, y ahora arranca la ruta B (o el turno del
    // día siguiente sobre la misma ruta recurrente) con el mismo contexto vivo.
    const pc = puntoControl('pc-1', [-63.18, -17.78], 30);
    const detectados = new Set<string>([claveCumplimiento('sesion-1', 'pc-1')]);
    const { eventos, deteccion } = construirEventosDeUbicacion(
      ubicacion(-17.78, -63.18),
      contexto([pc], 'sesion-2'),
      detectados,
    );
    expect(eventos).toHaveLength(2);
    expect(eventos[1]?.tipo).toBe('cumplimiento_punto_control');
    expect(eventos[1]?.payload).toMatchObject({ sesionId: 'sesion-2', puntoControlId: 'pc-1' });
    expect(deteccion?.puntoControlId).toBe('pc-1');
    expect(detectados.has(claveCumplimiento('sesion-2', 'pc-1'))).toBe(true);
  });

  it('no evalúa puntos de control cuando el paquete del día no trae ninguno', () => {
    const { eventos, deteccion } = construirEventosDeUbicacion(
      ubicacion(-17.78, -63.18),
      contexto([]),
      new Set(),
    );
    expect(eventos).toHaveLength(1);
    expect(deteccion).toBeNull();
  });
});

describe('clavesCumplimientoDesdePayloads', () => {
  it('reconstruye las claves de los cumplimientos que siguen en el outbox', () => {
    const claves = clavesCumplimientoDesdePayloads([
      { sesionId: 'sesion-1', puntoControlId: 'pc-1', lat: -17.78, lng: -63.18 },
      { sesionId: 'sesion-1', puntoControlId: 'pc-2', lat: -17.78, lng: -63.18 },
      { sesionId: 'sesion-2', puntoControlId: 'pc-1', lat: -17.78, lng: -63.18 },
    ]);
    expect([...claves].sort()).toEqual([
      claveCumplimiento('sesion-1', 'pc-1'),
      claveCumplimiento('sesion-1', 'pc-2'),
      claveCumplimiento('sesion-2', 'pc-1'),
    ]);
  });

  it('ignora payloads sin sesionId o sin puntoControlId en vez de fabricar claves basura', () => {
    const claves = clavesCumplimientoDesdePayloads([
      { sesionId: 'sesion-1' },
      { puntoControlId: 'pc-1' },
      { sesionId: 1, puntoControlId: 'pc-1' },
      {},
    ]);
    expect(claves.size).toBe(0);
  });

  it('una clave sembrada suprime la re-emisión del mismo cumplimiento tras reiniciarse el contexto headless', () => {
    const pc = puntoControl('pc-1', [-63.18, -17.78], 30);
    const sembradas = clavesCumplimientoDesdePayloads([
      { sesionId: 'sesion-1', puntoControlId: 'pc-1' },
    ]);
    const { eventos } = construirEventosDeUbicacion(
      ubicacion(-17.78, -63.18),
      contexto([pc]),
      sembradas,
    );
    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.tipo).toBe('gps_point');
  });
});

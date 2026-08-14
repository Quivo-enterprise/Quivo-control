import { describe, expect, it } from 'vitest';
import type { Location } from 'react-native-background-geolocation';
import type { PuntoControlPaquete } from '@quivo/shared';
import { construirEventosDeUbicacion, type ContextoUbicacion } from './location-task';

function ubicacion(lat: number, lng: number): Location {
  return {
    timestamp: '2026-08-14T12:00:00.000Z',
    age: 0,
    odometer: 0,
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

function contexto(puntosControl: PuntoControlPaquete[] = []): ContextoUbicacion {
  return { deviceId: 'android:device-1', sesionId: 'sesion-1', puntosControl };
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
      payload: { sesionId: 'sesion-1', lat: -17.78, lng: -63.18, accuracy: 5, speed: 0 },
    });
    expect(deteccion).toBeNull();
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
    // El Set se muta in-place: el caller (hook o headless task) lo reutiliza tick a tick.
    expect(detectados.has('pc-1')).toBe(true);
  });

  it('no repite cumplimiento_punto_control si el punto de control ya estaba detectado', () => {
    const pc = puntoControl('pc-1', [-63.18, -17.78], 30);
    const detectados = new Set<string>(['pc-1']);
    const { eventos, deteccion } = construirEventosDeUbicacion(
      ubicacion(-17.78, -63.18),
      contexto([pc]),
      detectados,
    );
    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.tipo).toBe('gps_point');
    expect(deteccion).toBeNull();
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

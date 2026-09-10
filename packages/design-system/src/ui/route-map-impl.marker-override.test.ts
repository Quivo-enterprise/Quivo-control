import { describe, expect, it } from 'vitest';
import type { MapPoint } from '../types.js';
import { markersWithVehicleOverride, resolvePointId } from './route-map-impl.js';
import { encolarNuevosPuntos, estadoInicialAnimacion } from './vehicle-marker-animation.js';

// ENTREGA 14 — con TODOS los vehículos dibujados a la vez (Entrega 13), `markerId` deja de
// ser una constante única (`ID_MARCADOR_VEHICULO`) y pasa a `vehiculo:${sesionId}`
// (`idMarcadorVehiculo` en `apps/web/app/(dashboard)/en-vivo/map-builders.ts`). Estos tests
// verifican lo que el plan pide explícitamente: que la animación pise EXACTAMENTE el marker
// cuyo id matchea `animatedVehicle.markerId` entre los N que trae `vehiculos`, y que los
// demás N-1 markers queden intactos — no que "el único marker del mapa" se mueva, que era la
// asunción implícita de la versión anterior (un solo vehículo, sin id explícito).

function vehiculo(sesionId: string, lat: number, lng: number): MapPoint {
  return {
    id: `vehiculo:${sesionId}`,
    lat,
    lng,
    pinType: 'pulse',
    estadoFrescura: 'reportando',
    placa: `PLC-${sesionId}`,
  };
}

describe('resolvePointId', () => {
  it('usa el id explícito cuando el marker lo trae (caso de los vehículos)', () => {
    expect(resolvePointId({ id: 'vehiculo:s1', lat: 1, lng: 2 }, 0)).toBe('vehiculo:s1');
  });

  it('cae a un id sintético lat:lng:index cuando no hay id explícito', () => {
    expect(resolvePointId({ lat: -17.39, lng: -66.15 }, 3)).toBe('-17.39:-66.15:3');
  });
});

describe('markersWithVehicleOverride — animación por id con varios vehículos', () => {
  it('sin animación en curso (anim.current null) devuelve los markers sin tocar', () => {
    const markers = [vehiculo('s1', -17.39, -66.15), vehiculo('s2', -17.40, -66.16)];
    const resultado = markersWithVehicleOverride(markers, estadoInicialAnimacion(), 'vehiculo:s1');
    expect(resultado).toBe(markers); // misma referencia: no hay `anim.current` que aplicar
  });

  it('sin markerId (ninguna sesión con detalle abierto) devuelve los markers sin tocar', () => {
    const markers = [vehiculo('s1', -17.39, -66.15)];
    let anim = estadoInicialAnimacion();
    anim = encolarNuevosPuntos(anim, [{ ts: 't1', lat: -17.5, lng: -66.2 }], 5_000);
    const resultado = markersWithVehicleOverride(markers, anim, undefined);
    expect(resultado).toBe(markers);
  });

  it('con N vehículos, pisa SOLO el marker cuyo id matchea markerId — los demás quedan intactos', () => {
    const s1 = vehiculo('s1', -17.39, -66.15);
    const s2 = vehiculo('s2', -17.40, -66.16);
    const s3 = vehiculo('s3', -17.41, -66.17);
    const markers = [s1, s2, s3];

    let anim = estadoInicialAnimacion();
    // Primer punto de la sesión seguida (s2): salto directo, sin animar (ver
    // `encolarNuevosPuntos` — "primera vez").
    anim = encolarNuevosPuntos(anim, [{ ts: 't1', lat: -20, lng: -70 }], 5_000);

    const resultado = markersWithVehicleOverride(markers, anim, 'vehiculo:s2');

    // s1 y s3 no cambiaron ni de posición ni de referencia — la animación de s2 no les pega.
    expect(resultado[0]).toBe(s1);
    expect(resultado[2]).toBe(s3);
    // s2 sí se movió a la posición visual actual de la animación.
    expect(resultado[1]).not.toBe(s2);
    expect(resultado[1]).toMatchObject({ id: 'vehiculo:s2', lat: -20, lng: -70 });
    // El resto de las propiedades de s2 (placa, estadoFrescura, pinType) se preservan.
    expect(resultado[1]).toMatchObject({ pinType: 'pulse', estadoFrescura: 'reportando', placa: 'PLC-s2' });
  });

  it('markerId que no matchea ningún vehículo de la lista actual no rompe nada (sesión filtrada por línea)', () => {
    const markers = [vehiculo('s1', -17.39, -66.15)];
    let anim = estadoInicialAnimacion();
    anim = encolarNuevosPuntos(anim, [{ ts: 't1', lat: -20, lng: -70 }], 5_000);

    // La sesión con detalle abierto (`s2`) quedó afuera de `markers` porque el filtro de
    // línea la sacó — sigue pudiendo tener animación en curso, pero no hay nada que pisar.
    const resultado = markersWithVehicleOverride(markers, anim, 'vehiculo:s2');
    expect(resultado).toEqual(markers);
    expect(resultado[0]).toEqual(markers[0]);
  });
});

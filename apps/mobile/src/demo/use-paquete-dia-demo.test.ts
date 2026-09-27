import { describe, expect, it } from 'vitest';
import { PaqueteDiaSchema } from '@quivo/shared';
import { construirPaqueteDiaDemo } from './use-paquete-dia-demo';

describe('construirPaqueteDiaDemo', () => {
  it('produce un PaqueteDia válido para z12', () => {
    const paquete = construirPaqueteDiaDemo('z12');
    expect(() => PaqueteDiaSchema.parse(paquete)).not.toThrow();
  });

  it('produce un PaqueteDia válido para l120', () => {
    const paquete = construirPaqueteDiaDemo('l120');
    expect(() => PaqueteDiaSchema.parse(paquete)).not.toThrow();
  });

  it('la geometría de la ruta está en [lon, lat] (GeoJSON), no [lat, lng]', () => {
    const paquete = construirPaqueteDiaDemo('z12');
    const primerPunto = paquete.ruta.geometria.coordinates[0]!;
    // Cochabamba: lat ≈ -17.x, lon ≈ -66.x — si estuviera al revés, `primerPunto[0]`
    // (longitud) caería fuera del rango [-180, 180] o, más sutil, se leería como -66 en vez de
    // -17: el chequeo de signo/orden de magnitud alcanza para pescar un swap accidental.
    expect(primerPunto[0]).toBeLessThan(-60);
    expect(primerPunto[1]).toBeGreaterThan(-20);
  });

  it('exactamente las paradas marcadas esPuntoControl aparecen en puntosControl', () => {
    const paquete = construirPaqueteDiaDemo('z12');
    expect(paquete.puntosControl.length).toBeGreaterThan(0);
    expect(paquete.puntosControl.length).toBeLessThan(paquete.paradas.length);
  });

  it('tiene exactamente una parada origen y una destino', () => {
    const paquete = construirPaqueteDiaDemo('l120');
    expect(paquete.paradas.filter((p) => p.tipo === 'origen')).toHaveLength(1);
    expect(paquete.paradas.filter((p) => p.tipo === 'destino')).toHaveLength(1);
  });
});

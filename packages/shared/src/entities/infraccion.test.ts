import { describe, expect, it } from 'vitest';
import {
  ActualizarInfraccionSchema,
  DESVIO_MAX_ACCURACY_M,
  DESVIO_MIN_DURACION_MS,
  DESVIO_MIN_PUNTOS,
  DESVIO_REGRESO_M,
  DESVIO_UMBRAL_M,
  GRAVEDAD_DEFAULT_POR_TIPO,
  REGLA_TIPOS_RESERVADOS_INFRACCION,
  SancionarInfraccionSchema,
  TIPOS_INFRACCION_SOLO_ALERTA,
  TipoInfraccionSchema,
} from './infraccion.js';
import { PosicionEnVivoSchema } from './en-vivo.js';

describe('infraccion', () => {
  it('constantes de la máquina de desvío', () => {
    expect(DESVIO_UMBRAL_M).toBe(100);
    expect(DESVIO_REGRESO_M).toBe(60);
    expect(DESVIO_MIN_PUNTOS).toBe(3);
    expect(DESVIO_MIN_DURACION_MS).toBe(45_000);
    expect(DESVIO_MAX_ACCURACY_M).toBe(30);
    expect(DESVIO_REGRESO_M).toBeLessThan(DESVIO_UMBRAL_M);
  });

  it('tipos de regla reservados y gravedad por defecto', () => {
    expect([...REGLA_TIPOS_RESERVADOS_INFRACCION]).toEqual([
      'desvio_ruta',
      'pc_omitido',
      'molinos_omitido',
      'espera_corta',
    ]);
    expect(GRAVEDAD_DEFAULT_POR_TIPO).toEqual({
      desvio_ruta: 'grave',
      pc_omitido: 'leve',
      molinos_omitido: 'grave',
      espera_corta: 'leve',
    });
    // Los tipos reservados cubren exactamente los tipos de infracción.
    expect([...REGLA_TIPOS_RESERVADOS_INFRACCION].sort()).toEqual([...TipoInfraccionSchema.options].sort());
    // Solo `espera_corta` es solo alerta (la API responde 409 al sancionar); `pc_omitido` se sanciona.
    expect([...TIPOS_INFRACCION_SOLO_ALERTA]).toEqual(['espera_corta']);
  });

  it('ActualizarInfraccion: acción acotada y nota <= 500', () => {
    expect(ActualizarInfraccionSchema.safeParse({ accion: 'atender' }).success).toBe(true);
    expect(ActualizarInfraccionSchema.safeParse({ accion: 'descartar', nota: 'x'.repeat(500) }).success).toBe(true);
    expect(ActualizarInfraccionSchema.safeParse({ accion: 'descartar', nota: 'x'.repeat(501) }).success).toBe(false);
    expect(ActualizarInfraccionSchema.safeParse({ accion: 'sancionar' }).success).toBe(false);
  });

  it('SancionarInfraccion no acepta (descarta) sindicatoId', () => {
    const r = SancionarInfraccionSchema.parse({
      reglaId: '00000000-0000-4000-8000-000000000001',
      sujetoTipo: 'conductor',
      sujetoId: 'c1',
      motivo: 'm',
      fechaHecho: '2026-10-12',
      sindicatoId: '00000000-0000-4000-8000-000000000002',
    });
    expect('sindicatoId' in r).toBe(false);
  });

  it('PosicionEnVivo: los campos nuevos son opcionales (respuestas viejas siguen parseando)', () => {
    const base = {
      id: '00000000-0000-4000-8000-000000000001',
      deviceId: 'd',
      activa: true,
      vehiculoPlaca: 'ABC123',
      conductorNombre: 'X',
      lineaId: '00000000-0000-4000-8000-000000000002',
      lineaNombre: 'L',
      rutaSentido: 'ida',
      lat: null,
      lng: null,
      accuracy: null,
      speed: null,
      totalPuntos: 0,
    };
    const frescura = PosicionEnVivoSchema.safeParse(base);
    // Falla solo por los campos de frescura (no por los nuevos): ninguno de los nuevos es requerido.
    if (!frescura.success) {
      const campos = frescura.error.issues.map((i) => i.path[0]);
      expect(campos).not.toContain('infraccionNivel');
      expect(campos).not.toContain('infraccionesAbiertas');
      expect(campos).not.toContain('vehiculoId');
      expect(campos).not.toContain('conductorId');
      expect(campos).not.toContain('infraccionesAtendidas');
      expect(campos).not.toContain('vuelta');
      expect(campos).not.toContain('molinosHoy');
    }
  });
});

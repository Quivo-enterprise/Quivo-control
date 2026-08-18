import { describe, expect, it } from 'vitest';
import type { PaqueteDia } from '@quivo/shared';
import { interpretarFilaPaqueteDia, type FilaPaqueteDia } from './paquete-dia-local';

function paquete(asignacionId: string, venceAt: string): PaqueteDia {
  return {
    asignacion: { id: asignacionId, fecha: '2026-08-18', horario: 'manana', venceAt },
    ruta: {
      id: 'a5c0f2c0-0000-4000-8000-000000000001',
      sentido: 'ida',
      geometria: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
    },
    linea: {
      id: 'a5c0f2c0-0000-4000-8000-000000000002',
      codigo: 'Z12',
      nombre: 'Zona 12',
      color: '#000000',
    },
    paradas: [],
    puntosControl: [],
  };
}

function fila(overrides: Partial<FilaPaqueteDia> = {}): FilaPaqueteDia {
  const asignacionId = overrides.asignacion_id ?? 'a5c0f2c0-0000-4000-8000-00000000000a';
  const venceAt = '2099-01-01T00:00:00.000Z';
  return {
    asignacion_id: asignacionId,
    payload: JSON.stringify(paquete(asignacionId, venceAt)),
    vence_at: venceAt,
    descargado_en: '2026-08-18T06:00:00.000Z',
    ...overrides,
  };
}

describe('interpretarFilaPaqueteDia (Hallazgo 1 CRÍTICO — piloto día 1)', () => {
  it('devuelve null cuando no hay fila', () => {
    expect(interpretarFilaPaqueteDia(null, 'cualquier-id')).toBeNull();
  });

  it('devuelve el paquete cuando la fila pertenece a la asignación esperada', () => {
    const asignacionId = 'a5c0f2c0-0000-4000-8000-00000000000b';
    const resultado = interpretarFilaPaqueteDia(fila({ asignacion_id: asignacionId }), asignacionId);
    expect(resultado).not.toBeNull();
    expect(resultado?.paquete.asignacion.id).toBe(asignacionId);
    expect(resultado?.vencido).toBe(false);
  });

  it('devuelve null cuando la fila local es de OTRA asignación (relevo de turno / teléfono reusado)', () => {
    // Este es el escenario del hallazgo: el teléfono guardó la asignación de un turno
    // anterior (aún no vencida por `venceAt`) y la sesión activa ahora es de OTRO conductor
    // u otro turno. Servir esta fila corrompería el geofence y los `cumplimiento_punto_control`
    // contra puntos de control que no corresponden a la asignación real del día.
    const filaDeOtroTurno = fila({ asignacion_id: 'a5c0f2c0-0000-4000-8000-00000000000c' });
    const asignacionSesionActiva = 'a5c0f2c0-0000-4000-8000-00000000000d';
    expect(interpretarFilaPaqueteDia(filaDeOtroTurno, asignacionSesionActiva)).toBeNull();
  });

  it('el mismatch de asignación se detecta ANTES que el chequeo de vencimiento (una fila de otra asignación no vencida igual se rechaza)', () => {
    const asignacionId = 'a5c0f2c0-0000-4000-8000-00000000000e';
    const filaNoVencidaDeOtraAsignacion = fila({
      asignacion_id: asignacionId,
      vence_at: '2099-01-01T00:00:00.000Z',
      payload: JSON.stringify(paquete(asignacionId, '2099-01-01T00:00:00.000Z')),
    });
    const resultado = interpretarFilaPaqueteDia(
      filaNoVencidaDeOtraAsignacion,
      'a5c0f2c0-0000-4000-8000-00000000000f',
    );
    expect(resultado).toBeNull();
  });

  it('marca vencido cuando el venceAt de la asignación (correcta) ya pasó', () => {
    const asignacionId = 'a5c0f2c0-0000-4000-8000-000000000010';
    const venceAt = '2020-01-01T00:00:00.000Z';
    const resultado = interpretarFilaPaqueteDia(
      fila({ asignacion_id: asignacionId, vence_at: venceAt, payload: JSON.stringify(paquete(asignacionId, venceAt)) }),
      asignacionId,
    );
    expect(resultado?.vencido).toBe(true);
  });

  it('devuelve null con un payload corrupto (no rompe el tick, cae al camino ya soportado)', () => {
    const asignacionId = 'a5c0f2c0-0000-4000-8000-000000000011';
    const resultado = interpretarFilaPaqueteDia(
      fila({ asignacion_id: asignacionId, payload: '{not-json' }),
      asignacionId,
    );
    expect(resultado).toBeNull();
  });

  it('devuelve null cuando el payload no matchea el schema', () => {
    const asignacionId = 'a5c0f2c0-0000-4000-8000-000000000012';
    const resultado = interpretarFilaPaqueteDia(
      fila({ asignacion_id: asignacionId, payload: JSON.stringify({ foo: 'bar' }) }),
      asignacionId,
    );
    expect(resultado).toBeNull();
  });
});

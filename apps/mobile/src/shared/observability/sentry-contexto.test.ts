import { beforeEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({ setTags: vi.fn(), setContext: vi.fn() }));
vi.mock('@sentry/react-native', () => sentry);

import {
  bucketAtraso,
  edadMasViejoMin,
  etiquetarSesionSentry,
  reportarSaludOutbox,
} from './sentry-contexto';

beforeEach(() => vi.clearAllMocks());

describe('etiquetarSesionSentry', () => {
  it('pone placa, sesionId y vehiculoId', () => {
    etiquetarSesionSentry({ sesionId: 's1', vehiculo: { id: 'v1', placa: 'ABC123' } });
    expect(sentry.setTags).toHaveBeenCalledWith({
      placa: 'ABC123',
      sesionId: 's1',
      vehiculoId: 'v1',
    });
  });

  it('con null limpia las tres etiquetas', () => {
    etiquetarSesionSentry(null);
    expect(sentry.setTags).toHaveBeenCalledWith({ placa: '', sesionId: '', vehiculoId: '' });
    expect(sentry.setContext).toHaveBeenCalledWith('outbox', null);
    expect(sentry.setTags).toHaveBeenCalledWith({ outboxAtrasado: '' });
  });

  it('un fallo de Sentry no se propaga', () => {
    sentry.setTags.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(() => etiquetarSesionSentry(null)).not.toThrow();
  });
});

describe('reportarSaludOutbox', () => {
  const AHORA = Date.parse('2026-10-22T20:00:00Z');

  it('calcula la edad del más viejo en minutos', () => {
    expect(edadMasViejoMin({ pendientes: 3, masViejoTs: '2026-10-22T19:30:00Z' }, AHORA)).toBe(30);
    expect(edadMasViejoMin({ pendientes: 0, masViejoTs: null }, AHORA)).toBeNull();
    expect(edadMasViejoMin({ pendientes: 1, masViejoTs: 'no-fecha' }, AHORA)).toBeNull();
  });

  it('adjunta contexto y etiquetas; sin pendientes no hay edad', () => {
    reportarSaludOutbox({ pendientes: 3, masViejoTs: '2026-10-22T19:30:00Z' }, AHORA);
    expect(sentry.setContext).toHaveBeenCalledWith('outbox', {
      pendientes: 3,
      edadMasViejoMin: 30,
    });
    expect(sentry.setTags).toHaveBeenCalledWith({ outboxAtrasado: '10-60min' });

    reportarSaludOutbox({ pendientes: 0, masViejoTs: null }, AHORA);
    expect(sentry.setTags).toHaveBeenLastCalledWith({ outboxAtrasado: 'no' });
  });
});

describe('bucketAtraso', () => {
  it('agrupa por antigüedad', () => {
    expect([null, 5, 10, 60, 61].map(bucketAtraso)).toEqual(['no', '<10min', '10-60min', '10-60min', '>60min']);
  });
});

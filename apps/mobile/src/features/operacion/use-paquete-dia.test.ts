import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ AppState: { addEventListener: vi.fn() } }));
vi.mock('@sentry/react-native', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('../../db/paquete-dia', () => ({}));
vi.mock('../../shared/api/paquete-dia-api', () => ({
  paqueteDiaApi: {},
  PaqueteDiaApiError: class extends Error {
    constructor(public kind: string, message: string) {
      super(message);
    }
  },
}));
vi.mock('../../shared/security/sesion-movil-store', () => ({}));

import type { PaqueteDia } from '@quivo/shared';
import { PaqueteDiaApiError } from '../../shared/api/paquete-dia-api';
import {
  MIN_ENTRE_REFRESCOS_MS,
  debeReportarFalloRefresco,
  mismoPaquete, perteneceAAsignacion,
  puedeRefrescarPaquete,
} from './use-paquete-dia';

describe('puedeRefrescarPaquete', () => {
  it('respeta el piso de 60 s entre descargas', () => {
    expect(puedeRefrescarPaquete(1_000, 1_000 + MIN_ENTRE_REFRESCOS_MS - 1)).toBe(false);
    expect(puedeRefrescarPaquete(1_000, 1_000 + MIN_ENTRE_REFRESCOS_MS)).toBe(true);
  });
});

describe('mismoPaquete / perteneceAAsignacion', () => {
  const p = { asignacion: { id: 'a1' }, x: 1 } as unknown as PaqueteDia;
  it('detecta contenido idéntico y distinto', () => {
    expect(mismoPaquete(null, p)).toBe(false);
    expect(mismoPaquete({ ...p } as PaqueteDia, p)).toBe(true);
    expect(mismoPaquete({ ...p, x: 2 } as unknown as PaqueteDia, p)).toBe(false);
  });
  it('compara contra la asignación de la sesión', () => {
    expect(perteneceAAsignacion(p, 'a1')).toBe(true);
    expect(perteneceAAsignacion(p, 'a2')).toBe(false);
    expect(perteneceAAsignacion(p, undefined)).toBe(false);
  });
});

describe('debeReportarFalloRefresco', () => {
  it('no reporta errores de red; sí los demás', () => {
    expect(debeReportarFalloRefresco(new PaqueteDiaApiError('network', 'x'))).toBe(false);
    expect(debeReportarFalloRefresco(new PaqueteDiaApiError('http', 'x'))).toBe(true);
    expect(debeReportarFalloRefresco(new Error('boom'))).toBe(true);
  });
});

import { describe, expect, it, vi } from 'vitest';

// Compuerta de hidratación de la semilla de cumplimientos (headless): sin PC no se lee el
// outbox ni se marca hidratada; con PC sí. Mismos mocks nativos que `headless-task.tarea.test.ts`.
vi.mock('react-native-background-geolocation', () => ({
  default: {
    getState: vi.fn().mockResolvedValue({ enabled: false }),
    stop: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@sentry/react-native', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

vi.mock('../db/outbox', () => ({
  abrirOutbox: vi.fn(),
  encolarEvento: vi.fn(),
  encolarEventoYLimpiarVisita: vi.fn(),
  guardarVisitaPendiente: vi.fn().mockResolvedValue(undefined),
  eliminarVisitaPendiente: vi.fn().mockResolvedValue(undefined),
  obtenerVisitasPendientes: vi.fn().mockResolvedValue([]),
  obtenerEventosPorTipo: vi.fn(),
}));

vi.mock('../db/paquete-dia', () => ({
  abrirPaqueteDiaDb: vi.fn(),
  obtenerPaqueteDiaLocal: vi.fn(),
}));

vi.mock('../features/operacion/drenaje-oportunista', () => ({
  intentarDrenarOportunista: vi.fn().mockResolvedValue(undefined),
}));

// Progreso de la vuelta (RF-GPS-054): su almacén toca SQLite real — se mockea; su lógica se prueba en
// `progreso-vuelta*.test.ts`.
vi.mock('../features/operacion/progreso-vuelta-store', () => ({
  registrarPasoEnVuelta: vi.fn().mockResolvedValue(undefined),
  // Fase del circuito (ida/regreso): sin filtro por defecto, todos los PC se detectan.
  puntosDeLaFaseActual: vi.fn(async (_db: unknown, _sesionId: string, puntosControl: unknown[]) => puntosControl),
}));

// REDISEÑO (anuncio de puntos de control): `anuncio-punto-control.ts` importa
// `expo-notifications`/`expo-speech`, que arrastran el paquete `expo` (su `async-require`
// referencia el global `__DEV__` de React Native, indefinido bajo vitest/Node) — se mockea
// entero para que `import './headless-task'` no lo evalúe de verdad. Este archivo no ejercita
// ningún camino con `contexto` no nulo, así que el contenido del mock no importa.
vi.mock('../features/operacion/anuncio-punto-control', () => ({
  anunciarDeteccionesDelTick: vi.fn().mockResolvedValue(undefined),
  anunciarLlegadaPuntoControl: vi.fn().mockResolvedValue(undefined),
  reintentarAnunciosLlegadaPendientes: vi.fn().mockResolvedValue(undefined),
}));

// `tareaHeadlessUbicacion` ya no llama directo al circuit breaker (hallazgo 4) — reusa
// `refrescar()` de `use-auth-movil.ts`, que este archivo no ejercita (no hay ningún caso acá
// con `contexto` no nulo que llegue a pedir un access token). Se mockea igual para que
// `import './headless-task'` no arrastre `use-auth-movil.ts` (React, `authMovilApi`, etc.)
// al evaluar el módulo.
vi.mock('../features/auth/use-auth-movil', () => ({
  refrescar: vi.fn(),
}));

vi.mock('../shared/security/sesion-movil-store', () => ({
  cargarSesionMovil: vi.fn(),
  hayLogoutSolicitado: vi.fn().mockResolvedValue(false),
  obtenerDeviceIdMovil: vi.fn(),
}));

import { obtenerEventosPorTipo } from '../db/outbox';
import { asegurarSemillaCumplimientos, estaSemillaHidratada } from './headless-task';

const obtenerEventosMock = obtenerEventosPorTipo as unknown as ReturnType<typeof vi.fn>;

describe('asegurarSemillaCumplimientos: compuerta de hidratación', () => {
  it('sin PC no lee el outbox ni hidrata; con PC hidrata una sola vez', async () => {
    obtenerEventosMock.mockReset().mockResolvedValue([]);
    const db = {} as never;
    const pc = { id: 'pc-1' } as never;

    await asegurarSemillaCumplimientos(db, 'sesion-semilla', []);
    expect(obtenerEventosMock).not.toHaveBeenCalled();
    expect(estaSemillaHidratada('sesion-semilla')).toBe(false);

    await asegurarSemillaCumplimientos(db, 'sesion-semilla', [pc]);
    expect(obtenerEventosMock).toHaveBeenCalledTimes(1);
    expect(estaSemillaHidratada('sesion-semilla')).toBe(true);

    await asegurarSemillaCumplimientos(db, 'sesion-semilla', [pc]);
    expect(obtenerEventosMock).toHaveBeenCalledTimes(1);
  });
});

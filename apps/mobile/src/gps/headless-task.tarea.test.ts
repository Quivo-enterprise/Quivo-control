import { describe, expect, it, vi, beforeEach } from 'vitest';

// Hallazgo 1 (CRÍTICO) y hallazgo 2 (MEDIO), code review de la Entrega 2
// (`docs/plan-correccion-post-piloto-2026-09-09.md`): `tareaHeadlessUbicacion` tenía un
// `return` dentro del `try` que salía de TODA la función cuando no había turno vigente
// (`contexto === null`) — el drenado del outbox, entonces al final del cuerpo, nunca corría
// en ese camino. Y solo procesaba el evento `location`, así que los `heartbeat` headless
// (el único enganche cuando el vehículo está quieto y ningún fix `location` llega) tampoco
// drenaban nunca. Este archivo cubre ambos: el drenado tiene que correr SIEMPRE, sea
// `location` con contexto nulo, o `heartbeat`.
//
// Mismos mocks que `headless-task.access-token.test.ts`/`headless-task.test.ts`:
// `expo-sqlite`/`expo-crypto`/`expo-secure-store` y `@sentry/react-native` no corren bajo
// vitest/Node.
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

import { abrirOutbox } from '../db/outbox';
import { intentarDrenarOportunista } from '../features/operacion/drenaje-oportunista';
import { cargarSesionMovil } from '../shared/security/sesion-movil-store';
import { tareaHeadlessUbicacion } from './headless-task';

const cargarSesionMovilMock = cargarSesionMovil as unknown as ReturnType<typeof vi.fn>;
const abrirOutboxMock = abrirOutbox as unknown as ReturnType<typeof vi.fn>;
const intentarDrenarOportunistaMock = intentarDrenarOportunista as unknown as ReturnType<
  typeof vi.fn
>;

describe('tareaHeadlessUbicacion — hallazgo 1 (drenado saltado por el return del contexto nulo)', () => {
  beforeEach(() => {
    cargarSesionMovilMock.mockReset().mockResolvedValue(null); // sin sesión → contexto null
    intentarDrenarOportunistaMock.mockClear();
    abrirOutboxMock.mockReset();
  });

  it('con evento `location` y contexto nulo (sin sesión), el drenado corre igual', async () => {
    await tareaHeadlessUbicacion({
      name: 'location',
      params: { coords: { latitude: -16.5, longitude: -68.15 } },
    } as never);

    // Antes del fix, el `return` de la rama `!contexto` (dentro del try) salía de TODA la
    // función y esta línea nunca se ejecutaba.
    expect(intentarDrenarOportunistaMock).toHaveBeenCalledTimes(1);
  });

  it('no intenta escribir un punto GPS cuando no hay contexto (sesión cerrada)', async () => {
    await tareaHeadlessUbicacion({
      name: 'location',
      params: { coords: { latitude: -16.5, longitude: -68.15 } },
    } as never);

    // Sin contexto, `abrirOutbox` no debería llegar a abrirse para registrar el punto — el
    // único llamador de `abrirOutbox` en este archivo es el camino de escritura del punto.
    expect(abrirOutboxMock).not.toHaveBeenCalled();
  });
});

describe('tareaHeadlessUbicacion — hallazgo 2 (heartbeat headless no drenaba)', () => {
  beforeEach(() => {
    cargarSesionMovilMock.mockReset();
    intentarDrenarOportunistaMock.mockClear();
    abrirOutboxMock.mockReset();
  });

  it('un evento `heartbeat` dispara el drenado, sin registrar ningún punto GPS', async () => {
    await tareaHeadlessUbicacion({ name: 'heartbeat', params: {} } as never);

    expect(intentarDrenarOportunistaMock).toHaveBeenCalledTimes(1);
    // FIX POST-REVISIÓN (bug 2, "un vehículo detenido nunca confirma" — este branch agrega
    // `manejarHeartbeatHeadless`, que SÍ consulta la sesión/contexto para poder confirmar
    // visitas pendientes por antigüedad): `heartbeat` YA NO es un no-op de evidencia — lo que
    // se mantiene es que nunca escribe un `gps_point` falso (sin `location.coords` real). Sin
    // sesión mockeada (`cargarSesionMovilMock` sin resolver nada), `obtenerContextoUbicacionPersistido`
    // devuelve `null` y `manejarHeartbeatHeadless` corta antes de abrir el outbox.
    expect(cargarSesionMovilMock).toHaveBeenCalled();
    expect(abrirOutboxMock).not.toHaveBeenCalled();
  });

  it('un evento que no es `location` ni `heartbeat` (p. ej. `motionchange`) NO dispara el drenado', async () => {
    await tareaHeadlessUbicacion({ name: 'motionchange', params: {} } as never);

    expect(intentarDrenarOportunistaMock).not.toHaveBeenCalled();
  });
});

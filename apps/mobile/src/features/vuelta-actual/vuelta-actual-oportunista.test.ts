import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VueltaActualMovil } from '@quivo/shared';
import { ESTADO_LOCAL_INICIAL, type EstadoLocalVuelta } from './vuelta-actual-core';

const V1 = '3f8d3c1e-7a52-4f0b-9a3e-1c2d4e5f6a7b';
const V2 = '7c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f';
const DESIGNADA_EN = '2026-10-14T13:05:00.000Z';
const CLAVE = `${V1}|${DESIGNADA_EN}`;
const SESION = 'sesion-1';

const mocks = vi.hoisted(() => ({
  filas: new Map<string, unknown>(),
  retenerBorrado: false,
  liberarBorrado: (() => undefined) as () => void,
  borrados: 0,
  obtener: vi.fn(),
  acusar: vi.fn(),
  anunciar: vi.fn(),
  descartar: vi.fn(),
  captura: vi.fn(),
}));

vi.mock('@sentry/react-native', () => ({ captureException: mocks.captura, addBreadcrumb: vi.fn() }));
vi.mock('../../db/vuelta-actual-local', () => ({
  leerEstadoVueltaLocal: async (id: string) => mocks.filas.get(id) ?? ESTADO_LOCAL_INICIAL,
  guardarEstadoVueltaLocal: async (id: string, e: unknown) => {
    mocks.filas.set(id, JSON.parse(JSON.stringify(e)));
  },
  borrarEstadoVueltaLocal: (id: string) => {
    mocks.borrados += 1;
    mocks.filas.delete(id);
    // Con `retenerBorrado` la sentencia queda pendiente hasta que el test la libere: sirve para
    // verificar que nada (limpiar, la consulta siguiente) la espera.
    if (!mocks.retenerBorrado) return Promise.resolve();
    return new Promise<void>((resolve) => (mocks.liberarBorrado = resolve));
  },
  borrarEstadosVueltaLocalDeOtrasSesiones: async (id: string) => {
    for (const k of [...mocks.filas.keys()]) if (k !== id) mocks.filas.delete(k);
  },
}));
vi.mock('../../shared/api/vuelta-actual-api', () => ({
  vueltaActualApi: { obtener: mocks.obtener, acusar: mocks.acusar },
}));
vi.mock('../../shared/security/sesion-movil-store', () => ({
  cargarSesionMovil: async () => ({ contexto: { sesionId: SESION } }),
}));
vi.mock('../operacion/anuncio-punto-control', () => ({
  anunciarAvisoEnCanal: mocks.anunciar,
  descartarNotificacionAviso: mocks.descartar,
}));

import {
  consultarVueltaActual,
  entenderCancelacion,
  entenderDesignacion,
  limpiarVueltaActual,
  limpiarVueltaActualDeOtrasSesiones,
  reiniciarPisoVueltaActualParaTests,
  suscribirEstadoVuelta,
} from './vuelta-actual-oportunista';

function vuelta(
  designacion: boolean,
  acuseEn: string | null = null,
  vueltaId: string = V1,
): VueltaActualMovil {
  return {
    vueltaId,
    numero: 1,
    designacion: designacion
      ? {
          varianteId: '9b1c2d3e-4f50-4a6b-8c7d-0e1f2a3b4c5d',
          nombre: 'Vía Molinos',
          designadaEn: DESIGNADA_EN,
          acuseEn,
          tramo: null,
          puntoEspera: {
            id: '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d',
            coord: { type: 'Point', coordinates: [-66.15, -17.38] },
            esperaMin: 30,
          },
        }
      : null,
    enEspera: null,
  };
}

const ok = (v: VueltaActualMovil) => v;
const token = async () => 'tok';
const estadoGuardado = () => mocks.filas.get(SESION) as EstadoLocalVuelta;

beforeEach(() => {
  mocks.filas.clear();
  mocks.retenerBorrado = false;
  mocks.liberarBorrado = () => undefined;
  mocks.borrados = 0;
  Object.values(mocks).forEach((m) => typeof m === 'function' && 'mockReset' in m && m.mockReset());
  mocks.anunciar.mockResolvedValue(true);
  mocks.descartar.mockResolvedValue(undefined);
  reiniciarPisoVueltaActualParaTests();
});

describe('anuncio de la designación', () => {
  it('marca la clave anunciada solo si el anuncio salió bien', async () => {
    mocks.obtener.mockResolvedValue(ok(vuelta(true)));
    await consultarVueltaActual(token, { forzar: true });
    expect(mocks.anunciar).toHaveBeenCalledTimes(1);
    expect(mocks.anunciar.mock.calls[0]?.[0]).toMatchObject({ identifier: `designacion|${CLAVE}` });
    expect(mocks.anunciar.mock.calls[0]?.[0].voz).toContain('30 minutos');
    expect(estadoGuardado().anunciadas).toEqual([CLAVE]);
  });

  it('si el anuncio falla, reintenta en las consultas siguientes y se rinde a los 3 intentos', async () => {
    mocks.anunciar.mockResolvedValue(false);
    mocks.obtener.mockResolvedValue(ok(vuelta(true)));
    for (let i = 0; i < 6; i += 1) await consultarVueltaActual(token, { forzar: true });
    expect(mocks.anunciar).toHaveBeenCalledTimes(3);
    expect(estadoGuardado().anunciadas).toEqual([]);
  });

  it('respuestas idénticas no reescriben ni emiten', async () => {
    mocks.obtener.mockResolvedValue(ok(vuelta(true)));
    await consultarVueltaActual(token, { forzar: true });
    const antes = estadoGuardado();
    const emitido = vi.fn();
    const { suscribirEstadoVuelta } = await import('./vuelta-actual-oportunista');
    const baja = suscribirEstadoVuelta(emitido);
    await consultarVueltaActual(token, { forzar: true });
    baja();
    expect(emitido).not.toHaveBeenCalled();
    expect(estadoGuardado()).toEqual(antes);
  });
});

describe('acuse', () => {
  async function conDesignacionCerrada() {
    mocks.obtener.mockResolvedValue(ok(vuelta(true)));
    await consultarVueltaActual(token, { forzar: true });
    mocks.acusar.mockRejectedValue({ kind: 'network' });
    await entenderDesignacion(token, SESION);
  }

  it('"Entendido" descarta la notificación y manda el acuse; usa el estado que devuelve', async () => {
    mocks.obtener.mockResolvedValue(ok(vuelta(true)));
    await consultarVueltaActual(token, { forzar: true });
    mocks.acusar.mockResolvedValue(ok(vuelta(true, '2026-10-14T13:06:00.000Z')));
    await entenderDesignacion(token, SESION);
    expect(mocks.descartar).toHaveBeenCalledWith(`designacion|${CLAVE}`);
    expect(mocks.acusar).toHaveBeenCalledTimes(1);
    expect(estadoGuardado().ultimo?.designacion?.acuseEn).toBe('2026-10-14T13:06:00.000Z');
    expect(mocks.obtener).toHaveBeenCalledTimes(1); // sin GET extra: el acuse trajo el estado
  });

  it('red y 5xx siguen reintentando en cada consulta, sin reportar', async () => {
    await conDesignacionCerrada();
    mocks.acusar.mockRejectedValue({ kind: 'http', status: 503 });
    await consultarVueltaActual(token, { forzar: true });
    await consultarVueltaActual(token, { forzar: true });
    expect(mocks.acusar).toHaveBeenCalledTimes(3);
    expect(mocks.captura).not.toHaveBeenCalled();
  });

  it('429 y 408 también reintentan', async () => {
    await conDesignacionCerrada();
    mocks.acusar.mockRejectedValue({ kind: 'http', status: 429 });
    await consultarVueltaActual(token, { forzar: true });
    mocks.acusar.mockRejectedValue({ kind: 'http', status: 408 });
    await consultarVueltaActual(token, { forzar: true });
    expect(mocks.acusar).toHaveBeenCalledTimes(3);
    expect(mocks.captura).not.toHaveBeenCalled();
  });

  it('un 4xx permanente corta el reintento y se reporta a Sentry una vez', async () => {
    await conDesignacionCerrada();
    mocks.acusar.mockRejectedValue({ kind: 'http', status: 403 });
    await consultarVueltaActual(token, { forzar: true });
    await consultarVueltaActual(token, { forzar: true });
    await consultarVueltaActual(token, { forzar: true });
    expect(mocks.acusar).toHaveBeenCalledTimes(2); // 1 en "Entendido" (red) + 1 que dio 403
    expect(mocks.captura).toHaveBeenCalledTimes(1);
    expect(estadoGuardado().acusesAbandonados).toEqual([CLAVE]);
  });

  it('si el acuse no trae el estado, se pide un GET; con una consulta en vuelo queda pendiente y corre al terminar', async () => {
    mocks.obtener.mockResolvedValue(ok(vuelta(true)));
    await consultarVueltaActual(token, { forzar: true });
    mocks.acusar.mockResolvedValue(null);
    // GET lento en vuelo cuando se toca "Entendido".
    let liberar: () => void = () => undefined;
    mocks.obtener.mockImplementationOnce(
      () => new Promise((resolve) => (liberar = () => resolve(ok(vuelta(true))))),
    );
    const enVuelo = consultarVueltaActual(token, { forzar: true });
    await vi.waitFor(() => expect(mocks.obtener).toHaveBeenCalledTimes(2));
    mocks.obtener.mockResolvedValue(ok(vuelta(true, '2026-10-14T13:06:00.000Z')));
    await entenderDesignacion(token, SESION);
    expect(mocks.obtener).toHaveBeenCalledTimes(2); // todavía no: había una consulta en vuelo
    liberar();
    await enVuelo;
    await vi.waitFor(() => expect(mocks.obtener).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(estadoGuardado().ultimo?.designacion?.acuseEn).not.toBeNull());
  });
});

describe('cancelación', () => {
  it('"Entendido" de la cancelación descarta su notificación', async () => {
    mocks.obtener.mockResolvedValue(ok(vuelta(true)));
    await consultarVueltaActual(token, { forzar: true });
    mocks.obtener.mockResolvedValue(ok(vuelta(false)));
    await consultarVueltaActual(token, { forzar: true });
    expect(mocks.descartar).toHaveBeenCalledWith(`designacion|${CLAVE}`);
    await entenderCancelacion(SESION);
    expect(mocks.descartar).toHaveBeenCalledWith(`cancelada|${CLAVE}`);
    expect(estadoGuardado().cancelacionPendiente).toBeNull();
  });
});

describe('limpiarVueltaActual (generación)', () => {
  it('una respuesta cuya consulta empezó antes de limpiar se descarta: no persiste ni emite ni anuncia ni acusa', async () => {
    let liberar: () => void = () => undefined;
    mocks.obtener.mockImplementationOnce(
      () => new Promise((resolve) => (liberar = () => resolve(ok(vuelta(true))))),
    );
    const emitido = vi.fn();
    const baja = suscribirEstadoVuelta(emitido);
    const enVuelo = consultarVueltaActual(token, { forzar: true });
    await vi.waitFor(() => expect(mocks.obtener).toHaveBeenCalledTimes(1));
    limpiarVueltaActual(SESION); // fin/inicio de recorrido mientras la consulta sigue en vuelo
    emitido.mockClear();
    liberar();
    await enVuelo;
    baja();
    expect(mocks.filas.has(SESION)).toBe(false);
    expect(emitido).not.toHaveBeenCalled();
    expect(mocks.anunciar).not.toHaveBeenCalled();
    expect(mocks.acusar).not.toHaveBeenCalled();
  });

  it('limpiar no bloquea: devuelve sincrónico y la DB queda pendiente sin trabar nada', async () => {
    mocks.retenerBorrado = true;
    mocks.filas.set(SESION, ESTADO_LOCAL_INICIAL);
    expect(limpiarVueltaActual(SESION)).toBeUndefined(); // no hay promesa que esperar
    expect(mocks.borrados).toBe(1); // el borrado se disparó (una sentencia), pero sigue pendiente
    // El borrado pendiente no traba la consulta siguiente.
    mocks.obtener.mockResolvedValue(ok(vuelta(true)));
    await consultarVueltaActual(token, { forzar: true });
    expect(mocks.obtener).toHaveBeenCalledTimes(1);
    mocks.liberarBorrado();
  });

  it('la consulta del recorrido nuevo corre sin esperar el piso ni la consulta colgada del anterior', async () => {
    mocks.obtener.mockReturnValueOnce(new Promise<VueltaActualMovil>(() => undefined));
    void consultarVueltaActual(token, { forzar: true });
    await vi.waitFor(() => expect(mocks.obtener).toHaveBeenCalledTimes(1));
    limpiarVueltaActual(SESION);
    mocks.obtener.mockResolvedValue(ok(vuelta(true)));
    await consultarVueltaActual(token); // sin forzar: el piso se reinició
    expect(mocks.obtener).toHaveBeenCalledTimes(2);
    expect(estadoGuardado().ultimo?.designacion).not.toBeNull();
  });

  it('descarta las notificaciones del cache borrado (best-effort)', async () => {
    mocks.obtener.mockResolvedValue(ok(vuelta(true)));
    await consultarVueltaActual(token, { forzar: true });
    mocks.descartar.mockClear();
    limpiarVueltaActual(SESION);
    await vi.waitFor(() => expect(mocks.descartar).toHaveBeenCalledWith(`designacion|${CLAVE}`));
    expect(mocks.filas.has(SESION)).toBe(false);
  });
});

describe('limpieza de otras sesiones', () => {
  it('borra la fila de otras sesiones', async () => {
    mocks.filas.set('otra-sesion', ESTADO_LOCAL_INICIAL);
    mocks.filas.set(SESION, ESTADO_LOCAL_INICIAL);
    await limpiarVueltaActualDeOtrasSesiones(SESION);
    expect(mocks.filas.has('otra-sesion')).toBe(false);
    expect(mocks.filas.has(SESION)).toBe(true);
  });
});

describe('cadencia y consulta colgada', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('el piso tolera 1 s de jitter: a 19,5 s consulta; a 18,5 s no', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T13:00:00.000Z'));
    mocks.obtener.mockResolvedValue(ok(vuelta(false)));
    await consultarVueltaActual(token);
    expect(mocks.obtener).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-10-14T13:00:18.500Z'));
    await consultarVueltaActual(token);
    expect(mocks.obtener).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-10-14T13:00:19.500Z'));
    await consultarVueltaActual(token);
    expect(mocks.obtener).toHaveBeenCalledTimes(2);
  });

  it('el piso se mide desde que se dispara la llamada, no desde que terminan las lecturas previas', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T13:00:00.000Z'));
    mocks.obtener.mockImplementation(async () => {
      // La consulta tarda 3 s en responder.
      vi.setSystemTime(new Date('2026-10-14T13:00:03.000Z'));
      return ok(vuelta(false));
    });
    await consultarVueltaActual(token);
    // 19,2 s después del disparo anterior (16,2 s después de su fin): ya toca.
    vi.setSystemTime(new Date('2026-10-14T13:00:19.200Z'));
    await consultarVueltaActual(token);
    expect(mocks.obtener).toHaveBeenCalledTimes(2);
  });

  it('una diferencia de reloj negativa (el reloj retrocedió) cuenta la consulta en vuelo como vencida', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T13:00:00.000Z'));
    mocks.obtener.mockReturnValueOnce(new Promise<VueltaActualMovil>(() => undefined));
    void consultarVueltaActual(token, { forzar: true });
    await vi.waitFor(() => expect(mocks.obtener).toHaveBeenCalledTimes(1));
    vi.setSystemTime(new Date('2026-10-14T12:30:00.000Z')); // el reloj retrocede 30 min
    mocks.obtener.mockResolvedValueOnce(ok(vuelta(false, null, V2)));
    await consultarVueltaActual(token, { forzar: true });
    expect(mocks.obtener).toHaveBeenCalledTimes(2);
  });

  it('una consulta colgada vence a los 60 s: se permite una nueva y la respuesta vieja se descarta', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T13:00:00.000Z'));
    let resolverVieja: (v: VueltaActualMovil) => void = () => undefined;
    mocks.obtener.mockReturnValueOnce(new Promise<VueltaActualMovil>((r) => (resolverVieja = r)));
    const colgada = consultarVueltaActual(token, { forzar: true });
    await vi.waitFor(() => expect(mocks.obtener).toHaveBeenCalledTimes(1));

    // Antes de 60 s sigue bloqueada.
    vi.setSystemTime(new Date('2026-10-14T13:00:59.000Z'));
    await consultarVueltaActual(token, { forzar: true });
    expect(mocks.obtener).toHaveBeenCalledTimes(1);

    // Pasados los 60 s se permite una consulta nueva.
    mocks.obtener.mockResolvedValueOnce(ok(vuelta(false, null, V2)));
    vi.setSystemTime(new Date('2026-10-14T13:01:01.000Z'));
    await consultarVueltaActual(token, { forzar: true });
    expect(mocks.obtener).toHaveBeenCalledTimes(2);
    expect(estadoGuardado().ultimo?.vueltaId).toBe(V2);

    // La respuesta vieja llega tarde: se descarta (no pisa el estado de la nueva).
    resolverVieja(ok(vuelta(true)));
    await colgada;
    expect(estadoGuardado().ultimo?.vueltaId).toBe(V2);
    expect(mocks.anunciar).not.toHaveBeenCalled();
  });
});

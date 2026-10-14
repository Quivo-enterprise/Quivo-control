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
  recorrido: 'rec-1' as string | null,
  errorLectura: false,
  obtener: vi.fn(),
  acusar: vi.fn(),
  anunciar: vi.fn(),
  descartar: vi.fn(),
  captura: vi.fn(),
}));

vi.mock('@sentry/react-native', () => ({ captureException: mocks.captura, addBreadcrumb: vi.fn() }));
vi.mock('../../db/recorrido-actual', () => ({
  leerRecorridoActual: async () =>
    mocks.errorLectura ? { ok: false } : { ok: true, recorridoId: mocks.recorrido },
}));
vi.mock('../../db/vuelta-actual-local', () => ({
  leerEstadoVueltaLocal: async (id: string) => mocks.filas.get(id) ?? ESTADO_LOCAL_INICIAL,
  guardarEstadoVueltaLocal: async (id: string, e: unknown) => {
    mocks.filas.set(id, JSON.parse(JSON.stringify(e)));
  },
  borrarEstadoVueltaLocal: async (id: string) => {
    mocks.filas.delete(id);
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
  mocks.recorrido = 'rec-1';
  mocks.errorLectura = false;
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

describe('recorrido vs consulta en vuelo', () => {
  it('una respuesta cuya consulta empezó antes de limpiar se descarta: no persiste ni emite ni anuncia', async () => {
    let liberar: () => void = () => undefined;
    mocks.obtener.mockImplementationOnce(
      () => new Promise((resolve) => (liberar = () => resolve(ok(vuelta(true))))),
    );
    const emitido = vi.fn();
    const baja = suscribirEstadoVuelta(emitido);
    const enVuelo = consultarVueltaActual(token, { forzar: true });
    await vi.waitFor(() => expect(mocks.obtener).toHaveBeenCalledTimes(1));
    mocks.recorrido = null; // fin del recorrido mientras la consulta sigue en vuelo
    emitido.mockClear();
    liberar();
    await enVuelo;
    baja();
    expect(mocks.filas.has(SESION)).toBe(false);
    expect(emitido).not.toHaveBeenCalled();
    expect(mocks.anunciar).not.toHaveBeenCalled();
    expect(mocks.acusar).not.toHaveBeenCalled();
  });

  it('una respuesta en vuelo de un recorrido anterior se descarta aunque haya otro recorrido activo', async () => {
    let liberar: () => void = () => undefined;
    mocks.obtener.mockImplementationOnce(
      () => new Promise((resolve) => (liberar = () => resolve(ok(vuelta(true))))),
    );
    const emitido = vi.fn();
    const baja = suscribirEstadoVuelta(emitido);
    const enVuelo = consultarVueltaActual(token, { forzar: true });
    await vi.waitFor(() => expect(mocks.obtener).toHaveBeenCalledTimes(1));
    mocks.recorrido = 'rec-2'; // el recorrido terminó y empezó otro mientras la consulta seguía en vuelo
    liberar();
    await enVuelo;
    baja();
    expect(mocks.filas.has(SESION)).toBe(false);
    expect(emitido).not.toHaveBeenCalled();
    expect(mocks.anunciar).not.toHaveBeenCalled();
    expect(mocks.acusar).not.toHaveBeenCalled();
  });

  it('sin recorrido activo no se consulta', async () => {
    mocks.recorrido = null;
    mocks.obtener.mockResolvedValue(ok(vuelta(true)));
    await consultarVueltaActual(token, { forzar: true });
    expect(mocks.obtener).not.toHaveBeenCalled();
    expect(mocks.filas.has(SESION)).toBe(false);
    mocks.recorrido = 'rec-1';
    await consultarVueltaActual(token, { forzar: true });
    expect(estadoGuardado().ultimo?.designacion).not.toBeNull();
    expect(estadoGuardado().recorridoId).toBe('rec-1');
  });

  it('el cache de otro recorrido no se hidrata: la consulta del recorrido nuevo parte de cero', async () => {
    mocks.obtener.mockResolvedValue(ok(vuelta(true)));
    await consultarVueltaActual(token, { forzar: true });
    expect(mocks.anunciar).toHaveBeenCalledTimes(1);
    mocks.recorrido = 'rec-2';
    mocks.obtener.mockResolvedValue(ok(vuelta(false)));
    await consultarVueltaActual(token, { forzar: true });
    expect(estadoGuardado().recorridoId).toBe('rec-2');
    expect(estadoGuardado().ultimo?.designacion).toBeNull();
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

describe('lectura del recorrido con error', () => {
  it('un error de lectura no se interpreta como "sin recorrido": no consulta ni toca el cache', async () => {
    mocks.obtener.mockResolvedValue(ok(vuelta(true)));
    await consultarVueltaActual(token, { forzar: true });
    const antes = estadoGuardado();
    mocks.obtener.mockClear();
    mocks.errorLectura = true;
    await consultarVueltaActual(token, { forzar: true });
    expect(mocks.obtener).not.toHaveBeenCalled();
    expect(mocks.filas.has(SESION)).toBe(true);
    expect(estadoGuardado()).toEqual(antes);
  });

  it('si la lectura falla mientras la consulta está en vuelo, la respuesta se descarta sin tocar el cache', async () => {
    mocks.obtener.mockResolvedValue(ok(vuelta(true)));
    await consultarVueltaActual(token, { forzar: true });
    const antes = estadoGuardado();
    let liberar: () => void = () => undefined;
    mocks.obtener.mockImplementationOnce(
      () => new Promise((resolve) => (liberar = () => resolve(ok(vuelta(false))))),
    );
    const enVuelo = consultarVueltaActual(token, { forzar: true });
    await vi.waitFor(() => expect(mocks.obtener).toHaveBeenCalledTimes(2));
    mocks.errorLectura = true;
    liberar();
    await enVuelo;
    expect(estadoGuardado()).toEqual(antes);
  });
});

describe('cache de otro recorrido / filas viejas', () => {
  function filaConDesignacion(recorridoId: string | null): EstadoLocalVuelta {
    return {
      ...ESTADO_LOCAL_INICIAL,
      ultimo: vuelta(true),
      anunciadas: [CLAVE],
      actualizadoEn: Date.now(),
      recorridoId,
    };
  }

  it('el cache de otro recorrido se reemplaza dentro de la cola y descarta las notificaciones viejas', async () => {
    mocks.filas.set(SESION, filaConDesignacion('rec-viejo'));
    mocks.obtener.mockResolvedValue(ok(vuelta(false, null, V2)));
    const emitido = vi.fn();
    const baja = suscribirEstadoVuelta(emitido);
    await consultarVueltaActual(token, { forzar: true });
    baja();
    expect(mocks.descartar).toHaveBeenCalledWith(`designacion|${CLAVE}`);
    expect(estadoGuardado().recorridoId).toBe('rec-1');
    expect(estadoGuardado().ultimo?.vueltaId).toBe(V2);
    expect(emitido).toHaveBeenCalled();
  });

  it('una fila vieja sin recorridoId se adopta como del recorrido actual: no se borra ni se vuelve a anunciar', async () => {
    mocks.filas.set(SESION, filaConDesignacion(null));
    mocks.obtener.mockResolvedValue(ok(vuelta(true)));
    await consultarVueltaActual(token, { forzar: true });
    expect(mocks.anunciar).not.toHaveBeenCalled();
    expect(mocks.descartar).not.toHaveBeenCalled();
    expect(estadoGuardado().recorridoId).toBe('rec-1');
    expect(estadoGuardado().ultimo?.designacion).not.toBeNull();
    expect(estadoGuardado().anunciadas).toEqual([CLAVE]);
  });
});

describe('consulta sin recorrido registrado', () => {
  it('sin recorrido (o lectura fallida) no consume el piso ni marca en vuelo: la siguiente consulta no forzada sí corre', async () => {
    mocks.obtener.mockResolvedValue(ok(vuelta(true)));
    mocks.recorrido = null;
    await consultarVueltaActual(token);
    mocks.errorLectura = true;
    await consultarVueltaActual(token);
    expect(mocks.obtener).not.toHaveBeenCalled();
    mocks.errorLectura = false;
    mocks.recorrido = 'rec-1';
    await consultarVueltaActual(token); // sin forzar: el piso no se gastó
    expect(mocks.obtener).toHaveBeenCalledTimes(1);
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

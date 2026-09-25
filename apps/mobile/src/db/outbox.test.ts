import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * FIX POST-REVISIÓN (R2, hallazgo de revisión SERIO — "atomicidad rota por recuperación de
 * handle", verify-fix ronda 3): `encolarEventoYLimpiarVisita` (`outbox.ts`) abre una transacción
 * SQLite (`withTransactionAsync`) para encolar el `cumplimiento_punto_control` y borrar su fila
 * de `visitas_pendientes` como una sola unidad atómica. El bug: la transacción se abría sobre el
 * handle recibido mientras el INSERT/DELETE de adentro (`encolarEvento`/`eliminarVisitaPendiente`)
 * tenían SU PROPIA recuperación de handle muerto (`conReintentoSiHandleMuerto`) — si el handle
 * moría a mitad de la transacción, esa recuperación interna reabría una conexión NUEVA y corría
 * la escritura AHÍ, fuera de la transacción de la conexión vieja (ya zombi), mientras el `COMMIT`
 * implícito seguía apuntando al handle muerto. El fix mueve la transacción ENTERA dentro de
 * `conReintentoSiHandleMuerto`: si el handle muere en cualquier punto, se reintenta la operación
 * COMPLETA (BEGIN + INSERT + DELETE + COMMIT) una sola vez, contra UNA única conexión fresca.
 *
 * `expo-sqlite`/`expo-crypto`/`@sentry/react-native` se mockean porque son dependencias nativas
 * que rompen bajo vitest/Node (mismo motivo documentado en `headless-task.test.ts` y
 * `outbox-ddl.test.ts`) — acá se controlan directamente los handles falsos (`dbVieja`/`dbNueva`)
 * para poder inyectar el fallo "handle muerto a mitad de transacción" de forma determinística,
 * sin depender de un motor SQLite real (que nunca reproduce ese bug — es un bug de orquestación
 * JS, no de SQL).
 */
const openDatabaseAsyncMock = vi.fn();

vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: (...args: unknown[]) => openDatabaseAsyncMock(...args),
}));

vi.mock('expo-crypto', () => ({
  getRandomBytesAsync: vi.fn().mockResolvedValue(new Uint8Array(10).fill(7)),
}));

vi.mock('@sentry/react-native', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
}));

import {
  ANUNCIO_MAX_INTENTOS,
  ANUNCIO_PROGRAMANDO_STALE_MS,
  ANUNCIO_TTL_MS,
  encolarEventoYLimpiarVisita,
  marcarAnuncioProgramado,
  marcarAnuncioProgramando,
  obtenerAnunciosPendientesDeProgramar,
  reclamarIntencionAnuncio,
  type EventoOutboxNuevo,
} from './outbox';

/** Handle SQLite falso — solo los métodos que `outbox.ts` realmente usa en el camino bajo
 * prueba (`runAsync`, `withTransactionAsync`, `execAsync` para el DDL de una reapertura,
 * `getFirstAsync` para lecturas puras como `anuncioYaRegistrado`). */
interface HandleFalso {
  runAsync: ReturnType<typeof vi.fn>;
  withTransactionAsync: ReturnType<typeof vi.fn>;
  execAsync: ReturnType<typeof vi.fn>;
  getFirstAsync?: ReturnType<typeof vi.fn>;
}

/** Error con la MISMA forma que el NPE nativo real de `expo-sqlite@16.0.10` sobre un handle
 * zombi (ver `esHandleNativoMuerto`, `outbox.ts`) — `code: 'ERR_UNEXPECTED'` es el único
 * indicador confiable documentado ahí. */
function errorHandleMuerto(): Error & { code: string } {
  const error = new Error('NullPointerException: handle zombi') as Error & { code: string };
  error.code = 'ERR_UNEXPECTED';
  return error;
}

/** `withTransactionAsync` falso REALISTA: corre el `task` y, si rechaza, propaga el rechazo tal
 * cual (mismo comportamiento que el real: un `task` que lanza hace fallar la transacción
 * entera) — nunca sigue ejecutando nada después de un fallo dentro del `task`. */
function crearHandleFalso(runAsyncImpl: ReturnType<typeof vi.fn>): HandleFalso {
  return {
    runAsync: runAsyncImpl,
    withTransactionAsync: vi.fn(async (task: () => Promise<void>) => {
      await task();
    }),
    execAsync: vi.fn().mockResolvedValue(undefined),
  };
}

function eventoDePrueba(eventId?: string): EventoOutboxNuevo {
  return {
    deviceId: 'device-1',
    tipo: 'cumplimiento_punto_control',
    payload: { sesionId: 'sesion-1', puntoControlId: 'pc-1', pasada: 1 },
    eventId,
  };
}

beforeEach(() => {
  openDatabaseAsyncMock.mockReset();
});

describe('encolarEventoYLimpiarVisita — camino feliz (sin handle muerto)', () => {
  it('encola y borra la visita pendiente dentro de UNA sola transacción, sin reabrir nada', async () => {
    const runAsync = vi.fn().mockResolvedValue({ changes: 1 });
    const db = crearHandleFalso(runAsync);

    const resultado = await encolarEventoYLimpiarVisita(
      db as unknown as Parameters<typeof encolarEventoYLimpiarVisita>[0],
      eventoDePrueba('evt-fijo-1'),
      'clave-1',
    );

    expect(resultado).toEqual({ eventId: 'evt-fijo-1', insertado: true });
    expect(db.withTransactionAsync).toHaveBeenCalledTimes(1);
    expect(db.runAsync).toHaveBeenCalledTimes(2); // INSERT + DELETE
    expect(openDatabaseAsyncMock).not.toHaveBeenCalled(); // nunca hizo falta reabrir
  });
});

describe('encolarEventoYLimpiarVisita — R2 (handle muere A MITAD de la transacción)', () => {
  it('reintenta la transacción COMPLETA en una única conexión nueva — nunca reparte el INSERT y el DELETE entre dos conexiones', async () => {
    // dbVieja: el handle "recibido" — CUALQUIER `runAsync` sobre él revienta con el NPE nativo
    // (handle zombi), simulando que murió justo al entrar a la transacción.
    const runAsyncVieja = vi.fn().mockRejectedValue(errorHandleMuerto());
    const dbVieja = crearHandleFalso(runAsyncVieja);

    // dbNueva: la conexión que produce la reapertura (`SQLite.openDatabaseAsync`) — sana.
    const runAsyncNueva = vi.fn().mockResolvedValue({ changes: 1 });
    const dbNueva = crearHandleFalso(runAsyncNueva);
    openDatabaseAsyncMock.mockResolvedValue(dbNueva);

    const resultado = await encolarEventoYLimpiarVisita(
      dbVieja as unknown as Parameters<typeof encolarEventoYLimpiarVisita>[0],
      eventoDePrueba('evt-fijo-2'),
      'clave-2',
    );

    // El resultado final es correcto — la operación SÍ terminó completándose, en la conexión
    // nueva.
    expect(resultado).toEqual({ eventId: 'evt-fijo-2', insertado: true });

    // dbVieja: la transacción se abrió UNA vez y abortó en el PRIMER runAsync (el INSERT) — el
    // DELETE nunca llegó a intentarse sobre el handle muerto (el `task` de la transacción
    // aborta apenas el INSERT rechaza).
    expect(dbVieja.withTransactionAsync).toHaveBeenCalledTimes(1);
    expect(dbVieja.runAsync).toHaveBeenCalledTimes(1);

    // La reapertura pasó por el único canal real (`SQLite.openDatabaseAsync`), UNA sola vez.
    expect(openDatabaseAsyncMock).toHaveBeenCalledTimes(1);

    // dbNueva: la transacción COMPLETA (INSERT + DELETE) se reintentó de una sola vez, en una
    // ÚNICA transacción de la conexión nueva — nunca dos conexiones distintas para el INSERT y
    // el DELETE de la MISMA operación (eso es justo la ruptura de atomicidad que R2 cierra).
    expect(dbNueva.withTransactionAsync).toHaveBeenCalledTimes(1);
    expect(dbNueva.runAsync).toHaveBeenCalledTimes(2);
  });

  it('si el handle NUEVO también muere, propaga el error (no lo traga en silencio)', async () => {
    const dbVieja = crearHandleFalso(vi.fn().mockRejectedValue(errorHandleMuerto()));
    const dbNueva = crearHandleFalso(vi.fn().mockRejectedValue(errorHandleMuerto()));
    openDatabaseAsyncMock.mockResolvedValue(dbNueva);

    await expect(
      encolarEventoYLimpiarVisita(
        dbVieja as unknown as Parameters<typeof encolarEventoYLimpiarVisita>[0],
        eventoDePrueba('evt-fijo-3'),
        'clave-3',
      ),
    ).rejects.toThrow();
  });
});

/**
 * REDISEÑO (decisión del CTO, ronda posterior al veredicto `partial` de Codex `verify-fix` del
 * 2026-09-23, punto 3 del brief — "intención durable ANTES de programar"): `reclamarIntencionAnuncio`
 * hace el `INSERT OR IGNORE` (estado `'pendiente'`) — la identidad `{sesionId, puntoControlId,
 * pasada}` reclamada; `marcarAnuncioProgramado` la pasa a `'programado'` tras el schedule;
 * `obtenerAnunciosPendientesDeProgramar` lista lo que quedó `'pendiente'` para reintentar.
 */
describe('reclamarIntencionAnuncio', () => {
  it('hace un INSERT OR IGNORE en estado "pendiente" con la identidad completa', async () => {
    const runAsync = vi.fn().mockResolvedValue({ changes: 1 });
    const db = { ...crearHandleFalso(runAsync) };

    const resultado = await reclamarIntencionAnuncio(
      db as unknown as Parameters<typeof reclamarIntencionAnuncio>[0],
      'sesion-1',
      'pc-1',
      1,
      'proximidad',
    );

    expect(resultado).toEqual({ reclamado: true, clave: 'sesion-1:pc-1:1' });
    expect(runAsync).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR IGNORE'),
      ['sesion-1:pc-1:1', expect.any(String), 'proximidad', 'sesion-1', 'pc-1', 1],
    );
  });

  it('reclamado: false cuando la identidad ya estaba reclamada (changes: 0)', async () => {
    const runAsync = vi.fn().mockResolvedValue({ changes: 0 });
    const db = { ...crearHandleFalso(runAsync) };

    const resultado = await reclamarIntencionAnuncio(
      db as unknown as Parameters<typeof reclamarIntencionAnuncio>[0],
      'sesion-1',
      'pc-1',
      1,
      'proximidad',
    );

    expect(resultado.reclamado).toBe(false);
  });
});

describe('marcarAnuncioProgramado', () => {
  it('actualiza el estado a "programado" por clave', async () => {
    const runAsync = vi.fn().mockResolvedValue({ changes: 1 });
    const db = { ...crearHandleFalso(runAsync) };

    await marcarAnuncioProgramado(
      db as unknown as Parameters<typeof marcarAnuncioProgramado>[0],
      'sesion-1:pc-1:1',
    );

    expect(runAsync).toHaveBeenCalledWith(expect.stringContaining("estado = 'programado'"), [
      'sesion-1:pc-1:1',
    ]);
  });
});

/** Hallazgo 1 (code review, "'pendiente' mezcla reclamado-programando con reclamado-falló"):
 * `marcarAnuncioProgramando` es el paso NUEVO entre reclamar la intención y programar la
 * notificación — deja la fila en un estado transitorio propio, con su marca de tiempo e intentos
 * incrementados. */
describe('marcarAnuncioProgramando (hallazgo 1)', () => {
  it('actualiza el estado a "programando", incrementa intentos y marca el intento actual', async () => {
    const runAsync = vi.fn().mockResolvedValue({ changes: 1 });
    const db = { ...crearHandleFalso(runAsync) };

    await marcarAnuncioProgramando(
      db as unknown as Parameters<typeof marcarAnuncioProgramando>[0],
      'sesion-1:pc-1:1',
    );

    expect(runAsync).toHaveBeenCalledWith(
      expect.stringMatching(/estado = 'programando'[\s\S]*intentos = intentos \+ 1/),
      [expect.any(String), 'sesion-1:pc-1:1'],
    );
  });
});

describe('obtenerAnunciosPendientesDeProgramar', () => {
  it('devuelve las filas "pendiente" de LA SESIÓN pedida, con identidad completa', async () => {
    const getAllAsync = vi.fn().mockResolvedValue([
      {
        clave: 'sesion-1:pc-1:1',
        sesion_id: 'sesion-1',
        punto_control_id: 'pc-1',
        pasada: 1,
        motivo: 'proximidad',
      },
    ]);
    const runAsync = vi.fn().mockResolvedValue({ changes: 0 });
    const db = { ...crearHandleFalso(runAsync), getAllAsync };

    const resultado = await obtenerAnunciosPendientesDeProgramar(
      db as unknown as Parameters<typeof obtenerAnunciosPendientesDeProgramar>[0],
      'sesion-1',
    );

    expect(resultado).toEqual([
      { clave: 'sesion-1:pc-1:1', sesionId: 'sesion-1', puntoControlId: 'pc-1', pasada: 1, motivo: 'proximidad' },
    ]);
    // FIX (hallazgo 5): filtra por sesión — nunca trae filas de OTRA sesión.
    expect(getAllAsync).toHaveBeenCalledWith(expect.stringContaining('sesion_id = ?'), [
      'sesion-1',
      expect.any(String),
    ]);
  });

  it('descarta filas legado sin identidad reconstruible (sesion_id/punto_control_id/pasada/motivo en NULL)', async () => {
    const getAllAsync = vi.fn().mockResolvedValue([
      { clave: 'vieja:clave', sesion_id: null, punto_control_id: null, pasada: null, motivo: null },
    ]);
    const runAsync = vi.fn().mockResolvedValue({ changes: 0 });
    const db = { ...crearHandleFalso(runAsync), getAllAsync };

    const resultado = await obtenerAnunciosPendientesDeProgramar(
      db as unknown as Parameters<typeof obtenerAnunciosPendientesDeProgramar>[0],
      'sesion-1',
    );

    expect(resultado).toEqual([]);
  });

  /** FIX POST-REVISIÓN (hallazgo 5, "reintenta filas de días/sesiones anteriores para siempre"):
   * antes de listar, purga filas vencidas por antigüedad (`ANUNCIO_TTL_MS`) o por intentos
   * agotados (`ANUNCIO_MAX_INTENTOS`) — sin importar la sesión (esa purga es global). */
  it('purga filas vencidas por antigüedad o por intentos agotados ANTES de listar', async () => {
    const getAllAsync = vi.fn().mockResolvedValue([]);
    const runAsync = vi.fn().mockResolvedValue({ changes: 3 });
    const db = { ...crearHandleFalso(runAsync), getAllAsync };
    const ahoraMs = Date.parse('2026-09-25T12:00:00.000Z');

    await obtenerAnunciosPendientesDeProgramar(
      db as unknown as Parameters<typeof obtenerAnunciosPendientesDeProgramar>[0],
      'sesion-1',
      ahoraMs,
    );

    expect(runAsync).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM anuncios_punto_control'), [
      new Date(ahoraMs - ANUNCIO_TTL_MS).toISOString(),
      ANUNCIO_MAX_INTENTOS,
    ]);
  });

  /** FIX POST-REVISIÓN (hallazgo 1, "un reintento reclama un intento que ya está en vuelo"): una
   * fila `'programando'` con un intento FRESCO no se ofrece — solo cuando `ultimo_intento_ts`
   * quedó viejo (`ANUNCIO_PROGRAMANDO_STALE_MS`). */
  it('filtra "programando" fresco por SQL — la consulta exige `ultimo_intento_ts` vencido o nulo', async () => {
    const getAllAsync = vi.fn().mockResolvedValue([]);
    const runAsync = vi.fn().mockResolvedValue({ changes: 0 });
    const db = { ...crearHandleFalso(runAsync), getAllAsync };
    const ahoraMs = Date.parse('2026-09-25T12:00:00.000Z');

    await obtenerAnunciosPendientesDeProgramar(
      db as unknown as Parameters<typeof obtenerAnunciosPendientesDeProgramar>[0],
      'sesion-1',
      ahoraMs,
    );

    expect(getAllAsync).toHaveBeenCalledWith(expect.stringMatching(/estado = 'programando'[\s\S]*ultimo_intento_ts/), [
      'sesion-1',
      new Date(ahoraMs - ANUNCIO_PROGRAMANDO_STALE_MS).toISOString(),
    ]);
  });
});

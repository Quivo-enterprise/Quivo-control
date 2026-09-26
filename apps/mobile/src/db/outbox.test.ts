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
 * JS, no de SQL). A diferencia de `outbox-ddl.test.ts`, ACÁ no se mockea `./outbox` en sí — es
 * justo el módulo real bajo prueba.
 */
const openDatabaseAsyncMock = vi.fn();

vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: (...args: unknown[]) => openDatabaseAsyncMock(...args),
}));

vi.mock('expo-crypto', () => ({
  getRandomBytesAsync: vi.fn().mockResolvedValue(new Uint8Array(10).fill(7)),
  randomUUID: vi.fn(),
}));

vi.mock('@sentry/react-native', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
}));

import {
  ANUNCIO_MAX_INTENTOS,
  ANUNCIO_PROGRAMANDO_STALE_MS,
  ANUNCIO_TTL_MS,
  COTA_SANIDAD_LEASE_MS,
  TTL_LEASE_DRENAJE_MS,
  construirAdquirirLease,
  construirLiberarLeaseConCooldown,
  construirRecuperarEnviadosHuerfanos,
  construirRevertirAPendiente,
  encolarEventoYLimpiarVisita,
  marcarAnuncioProgramado,
  marcarAnuncioProgramando,
  obtenerAnunciosPendientesDeProgramar,
  reclamarIntencionAnuncio,
  type EstadoOutbox,
  type EventoOutboxNuevo,
} from './outbox';

/** Handle SQLite falso — solo los métodos que `outbox.ts` realmente usa en el camino bajo
 * prueba (`runAsync`, `withTransactionAsync`, `execAsync` para el DDL de una reapertura,
 * `getAllAsync` para lecturas). */
interface HandleFalso {
  runAsync: ReturnType<typeof vi.fn>;
  withTransactionAsync: ReturnType<typeof vi.fn>;
  execAsync: ReturnType<typeof vi.fn>;
  getAllAsync?: ReturnType<typeof vi.fn>;
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
 * hace el `INSERT OR IGNORE` — la identidad `{sesionId, puntoControlId, pasada}` reclamada;
 * `marcarAnuncioProgramado` la pasa a `'programado'` tras el schedule;
 * `obtenerAnunciosPendientesDeProgramar` lista lo que quedó `'programando'` viejo para
 * reintentar.
 *
 * FIX POST-REVISIÓN (code review, "doble llegaste"): el claim ya NO pasa por `'pendiente'` — el
 * mismo INSERT deja la fila en `'programando'` con `ultimo_intento_ts` puesto, ver el docblock
 * de `reclamarIntencionAnuncio` en `outbox.ts`.
 */
describe('reclamarIntencionAnuncio', () => {
  it('hace un INSERT OR IGNORE en estado "programando" (claim atómico, con ultimo_intento_ts) con la identidad completa', async () => {
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
      expect.stringMatching(/INSERT OR IGNORE[\s\S]*ultimo_intento_ts[\s\S]*'programando'/),
      ['sesion-1:pc-1:1', expect.any(String), 'proximidad', 'sesion-1', 'pc-1', 1, expect.any(String)],
    );
    // Nunca escribe 'pendiente' — ver el fix del "doble llegaste".
    expect(runAsync).not.toHaveBeenCalledWith(expect.stringContaining("'pendiente'"), expect.anything());
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

/**
 * FIX POST-REVISIÓN (code review, "doble llegaste" — vibración+notificación duplicadas):
 * reproduce la RACE descrita en el hallazgo con un fake de tabla en memoria que respeta la
 * semántica real de las dos consultas (`reclamarIntencionAnuncio` y
 * `obtenerAnunciosPendientesDeProgramar`) contra el MISMO storage — no dos funciones mockeadas
 * por separado, que no podrían reproducir la interacción entre ellas. El fake lee el estado
 * literal (`'pendiente'`/`'programando'`) del texto SQL, igual que haría SQLite real, así que
 * corre distinto según la implementación vigente de `outbox.ts`:
 * - ANTES del fix (claim en dos pasos, `'pendiente'` sin `ultimo_intento_ts`): el `SELECT` de
 *   reintento, corrido acá ENTRE el `INSERT` del claim y `marcarAnuncioProgramando`, SÍ devuelve
 *   la fila recién reclamada (la rama `estado = 'pendiente'` no chequea antigüedad) — el caller
 *   real (`reintentarAnunciosLlegadaPendientes`) la programaría de nuevo, doble vibración +
 *   notificación para la MISMA llegada.
 * - DESPUÉS del fix (claim atómico en `'programando'` con `ultimo_intento_ts` fresco): la misma
 *   consulta, en el mismo punto, NO la devuelve — sigue protegida por `ANUNCIO_PROGRAMANDO_STALE_MS`
 *   desde el instante del claim.
 */
interface FilaAnuncioFalsa {
  clave: string;
  ts: string;
  estado: string;
  motivo: string | null;
  sesion_id: string | null;
  punto_control_id: string | null;
  pasada: number | null;
  intentos: number;
  ultimo_intento_ts: string | null;
}

function crearTablaAnunciosFalsa() {
  const filas = new Map<string, FilaAnuncioFalsa>();

  const runAsync = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('INSERT OR IGNORE INTO anuncios_punto_control')) {
      const [clave, ts, motivo, sesionId, puntoControlId, pasada, ultimoIntentoTs] = params as [
        string,
        string,
        string,
        string,
        string,
        number,
        string | undefined,
      ];
      if (filas.has(clave)) return { changes: 0 };
      // Lee el estado LITERAL del texto SQL — igual que haría el motor real: el estado nunca es
      // un parámetro ligado en `reclamarIntencionAnuncio`, es texto fijo en la sentencia.
      const estado = sql.includes("'pendiente'") ? 'pendiente' : 'programando';
      filas.set(clave, {
        clave,
        ts,
        estado,
        motivo,
        sesion_id: sesionId,
        punto_control_id: puntoControlId,
        pasada,
        intentos: 0,
        ultimo_intento_ts: estado === 'programando' ? ultimoIntentoTs ?? null : null,
      });
      return { changes: 1 };
    }
    if (sql.includes("SET estado = 'programando'")) {
      const [ultimoIntentoTs, clave] = params as [string, string];
      const fila = filas.get(clave);
      if (!fila) return { changes: 0 };
      fila.estado = 'programando';
      fila.ultimo_intento_ts = ultimoIntentoTs;
      fila.intentos += 1;
      return { changes: 1 };
    }
    if (sql.includes("SET estado = 'programado'")) {
      const [clave] = params as [string];
      const fila = filas.get(clave);
      if (!fila) return { changes: 0 };
      fila.estado = 'programado';
      return { changes: 1 };
    }
    if (sql.includes('DELETE FROM anuncios_punto_control')) {
      const [vencidoIso, maxIntentos] = params as [string, number];
      for (const [clave, fila] of Array.from(filas.entries())) {
        if (fila.ts < vencidoIso || fila.intentos >= maxIntentos) filas.delete(clave);
      }
      return { changes: 0 };
    }
    throw new Error(`SQL no soportado por el fake de anuncios_punto_control: ${sql}`);
  });

  const getAllAsync = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('SELECT clave, sesion_id, punto_control_id, pasada, motivo')) {
      const [sesionId, staleIso] = params as [string, string];
      return Array.from(filas.values())
        .filter(
          (fila) =>
            fila.sesion_id === sesionId &&
            (fila.estado === 'pendiente' ||
              (fila.estado === 'programando' &&
                (fila.ultimo_intento_ts == null || fila.ultimo_intento_ts < staleIso))),
        )
        .map((fila) => ({
          clave: fila.clave,
          sesion_id: fila.sesion_id,
          punto_control_id: fila.punto_control_id,
          pasada: fila.pasada,
          motivo: fila.motivo,
        }));
    }
    throw new Error(`SQL no soportado por el fake de anuncios_punto_control: ${sql}`);
  });

  return { runAsync, getAllAsync, withTransactionAsync: vi.fn(), execAsync: vi.fn(), filas };
}

describe('reclamarIntencionAnuncio — claim atómico cierra la ventana "pendiente" (hallazgo "doble llegaste")', () => {
  it('el SELECT de reintento, corrido ENTRE el INSERT del claim y marcarAnuncioProgramando, no ve la fila recién reclamada', async () => {
    const tabla = crearTablaAnunciosFalsa();
    const db = { ...tabla } as unknown as Parameters<typeof reclamarIntencionAnuncio>[0];

    const claim = await reclamarIntencionAnuncio(db, 'sesion-1', 'pc-1', 1, 'proximidad');
    expect(claim.reclamado).toBe(true);

    // Simula la ventana de la race: `reintentarAnunciosLlegadaPendientes` corre fire-and-forget
    // desde `ejecutarEnColaRegistroGps` (`gps/headless-task.ts`) — acá corre su SELECT justo
    // ANTES de que el caller real llegue a `marcarAnuncioProgramando`/`programarNotificacionLlegada`.
    const pendientes = await obtenerAnunciosPendientesDeProgramar(
      db as unknown as Parameters<typeof obtenerAnunciosPendientesDeProgramar>[0],
      'sesion-1',
      Date.now(),
    );

    // Antes del fix esto devolvía la fila recién reclamada — el caller la reprogramaba y
    // disparaba una segunda vibración+notificación para la MISMA llegada.
    expect(pendientes).toEqual([]);
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

describe('construirRevertirAPendiente (Entrega 1 — guarda de estado)', () => {
  it('genera el UPDATE con el guard AND estado = \'enviado\' — acusado es terminal', () => {
    const { sql, params } = construirRevertirAPendiente(['a', 'b', 'c']);
    expect(sql).toBe(
      "UPDATE outbox SET estado = 'pendiente' WHERE event_id IN (?,?,?) AND estado = 'enviado'",
    );
    expect(params).toEqual(['a', 'b', 'c']);
  });

  it('un event_id solo genera un único placeholder', () => {
    const { sql, params } = construirRevertirAPendiente(['solo-uno']);
    expect(sql).toBe(
      "UPDATE outbox SET estado = 'pendiente' WHERE event_id IN (?) AND estado = 'enviado'",
    );
    expect(params).toEqual(['solo-uno']);
  });

  /**
   * Escenario obligatorio del encargo: sembrar 3 eventos, acusar 1, revertir los 3 → el
   * acusado sigue acusado. No hay forma de correr `expo-sqlite` bajo vitest/Node (el motivo
   * por el que el SQL se extrajo a función pura, igual que `construirPurgaAcusados`) — este
   * test interpreta el SQL/params que devuelve la función pura contra una tabla en memoria,
   * aplicando el MISMO predicado que ejecuta SQLite en producción (`estado = 'enviado'` como
   * única condición de transición), para probar la semántica del guard sin depender del
   * módulo nativo.
   */
  it('sembrar 3 eventos, acusar 1, revertir los 3 → el acusado sigue acusado', () => {
    const tabla = new Map<string, EstadoOutbox>([
      ['e1', 'enviado'], // se envió, el servidor todavía no lo confirmó
      ['e2', 'enviado'], // ídem
      ['e3', 'acusado'], // el servidor YA lo confirmó — terminal
    ]);

    const { params } = construirRevertirAPendiente(['e1', 'e2', 'e3']);
    // Interpretación fiel del UPDATE generado: solo transiciona las filas cuyo estado actual
    // es 'enviado', que es exactamente lo que impone el `AND estado = 'enviado'` del SQL.
    for (const eventId of params) {
      if (tabla.get(eventId) === 'enviado') tabla.set(eventId, 'pendiente');
    }

    expect(tabla.get('e1')).toBe('pendiente');
    expect(tabla.get('e2')).toBe('pendiente');
    expect(tabla.get('e3')).toBe('acusado'); // el bug de producción hacía que esto volviera a 'pendiente'
  });
});

describe('construirRecuperarEnviadosHuerfanos (Hallazgo 3 — code review de la Entrega 2)', () => {
  it('genera el UPDATE que recupera solo filas `enviado` más viejas que el umbral', () => {
    const { sql, params } = construirRecuperarEnviadosHuerfanos(new Date('2026-09-10T00:00:00.000Z'));
    expect(sql).toBe(
      "UPDATE outbox SET estado = 'pendiente' WHERE estado = 'enviado' AND COALESCE(enviado_at, ts) < ?",
    );
    expect(params).toEqual(['2026-09-10T00:00:00.000Z']);
  });

  /**
   * Escenario del hallazgo: un lote se marca `enviado` (con su `enviado_at`) y el proceso
   * muere a mitad del POST (Android mata la tarea headless) sin llegar al `catch` que
   * revertiría a `pendiente` — esa fila queda `enviado` PARA SIEMPRE sin este reproceso.
   * Interpreta el SQL/params generado contra una tabla en memoria, igual que el test
   * homólogo de `construirRevertirAPendiente` arriba, para no depender de `expo-sqlite`.
   */
  it('sembrar un lote enviado hace 5 min (proceso muerto a mitad del POST) → vuelve a pendiente con umbral de 90s', () => {
    const ahora = new Date('2026-09-10T12:00:00.000Z');
    const tabla = new Map<string, { estado: EstadoOutbox; enviadoAt: string | null }>([
      ['e1', { estado: 'enviado', enviadoAt: new Date(ahora.getTime() - 5 * 60_000).toISOString() }], // huérfano real
      ['e2', { estado: 'acusado', enviadoAt: new Date(ahora.getTime() - 5 * 60_000).toISOString() }], // terminal — no debe tocarse
      ['e3', { estado: 'enviado', enviadoAt: new Date(ahora.getTime() - 5_000).toISOString() }], // recién marcado — el POST puede seguir en vuelo
    ]);
    const umbral = new Date(ahora.getTime() - 90_000); // UMBRAL_RECUPERACION_ENVIADOS_MS

    const { params } = construirRecuperarEnviadosHuerfanos(umbral);
    const antesDeIso = params[0]!;
    for (const [eventId, fila] of tabla) {
      if (fila.estado === 'enviado' && fila.enviadoAt !== null && fila.enviadoAt < antesDeIso) {
        tabla.set(eventId, { ...fila, estado: 'pendiente' });
      }
    }

    expect(tabla.get('e1')?.estado).toBe('pendiente'); // recuperado: huérfano de verdad
    expect(tabla.get('e2')?.estado).toBe('acusado'); // guarda de estado respetada — terminal
    expect(tabla.get('e3')?.estado).toBe('enviado'); // todavía dentro del umbral — no se toca
  });

  it('una fila `enviado` SIN enviado_at (instalación de antes de esta columna) cae del lado seguro: se recupera igual', () => {
    // COALESCE(enviado_at, ts): sin `enviado_at`, se usa `ts` (siempre más vieja o igual que
    // el momento real de envío) como piso conservador — reenviar de más es seguro
    // (idempotencia por eventId), quedarse bloqueado para siempre no lo es.
    const ahora = new Date('2026-09-10T12:00:00.000Z');
    const tabla = new Map<string, { estado: EstadoOutbox; enviadoAt: string | null; ts: string }>([
      [
        'legado',
        {
          estado: 'enviado',
          enviadoAt: null,
          ts: new Date(ahora.getTime() - 10 * 60_000).toISOString(),
        },
      ],
    ]);
    const umbral = new Date(ahora.getTime() - 90_000);
    const { params } = construirRecuperarEnviadosHuerfanos(umbral);
    const antesDeIso = params[0]!;

    for (const [eventId, fila] of tabla) {
      const comparable = fila.enviadoAt ?? fila.ts; // COALESCE(enviado_at, ts)
      if (fila.estado === 'enviado' && comparable < antesDeIso) {
        tabla.set(eventId, { ...fila, estado: 'pendiente' });
      }
    }

    expect(tabla.get('legado')?.estado).toBe('pendiente');
  });
});

describe('construirAdquirirLease (Entrega 2 — mutex cross-contexto)', () => {
  it('el UPSERT toma la fila cuando no existe (INSERT normal, sin conflicto)', () => {
    const { sql, params } = construirAdquirirLease('drenaje-outbox', 'token-1', 1_000, 31_000);
    expect(sql).toContain('INSERT INTO sync_lease');
    expect(sql).toContain('ON CONFLICT(id) DO UPDATE');
    expect(sql).toContain('WHERE sync_lease.expira_at <= ?');
    // Hallazgo 4 (BAJO): segunda condición del OR — un `expira_at` demasiado lejos en el
    // futuro (salto de reloj hacia atrás) también libera el lease. Ver `COTA_SANIDAD_LEASE_MS`.
    expect(sql).toContain('OR sync_lease.expira_at > ?');
    expect(params).toEqual(['drenaje-outbox', 'token-1', 31_000, 1_000, 1_000 + COTA_SANIDAD_LEASE_MS]);
  });

  /** Simula el UPSERT completo: adquiere solo si la fila no existe o si `expira_at <= ahora`. */
  function simularAdquirir(
    tabla: Map<string, { owner: string; expiraAt: number }>,
    id: string,
    token: string,
    ahoraMs: number,
    ttlMs: number,
  ): boolean {
    const fila = tabla.get(id);
    if (!fila || fila.expiraAt <= ahoraMs) {
      tabla.set(id, { owner: token, expiraAt: ahoraMs + ttlMs });
      return true;
    }
    return false;
  }

  it('dos adquisiciones concurrentes → solo una consigue el lease (mutex)', () => {
    const tabla = new Map<string, { owner: string; expiraAt: number }>();
    const primeraGanó = simularAdquirir(tabla, 'drenaje-outbox', 'headless-token', 1_000, 30_000);
    const segundaGanó = simularAdquirir(tabla, 'drenaje-outbox', 'foreground-token', 1_500, 30_000);

    expect(primeraGanó).toBe(true);
    expect(segundaGanó).toBe(false);
    expect(tabla.get('drenaje-outbox')?.owner).toBe('headless-token');
  });

  it('un lease huérfano (TTL vencido, nadie liberó) se recupera solo — el TTL es obligatorio', () => {
    const tabla = new Map<string, { owner: string; expiraAt: number }>();
    simularAdquirir(tabla, 'drenaje-outbox', 'contexto-que-murió', 0, 30_000); // expira en 30_000

    // Antes de vencer el TTL: nadie más puede tomarlo.
    expect(simularAdquirir(tabla, 'drenaje-outbox', 'otro-contexto', 20_000, 30_000)).toBe(false);

    // Pasado el TTL sin liberación (el proceso murió a mitad de la operación): un nuevo
    // intento SÍ lo recupera — sin esto, el lease huérfano bloquearía el drenado para siempre.
    expect(simularAdquirir(tabla, 'drenaje-outbox', 'otro-contexto', 30_001, 30_000)).toBe(true);
    expect(tabla.get('drenaje-outbox')?.owner).toBe('otro-contexto');
  });

  describe('Hallazgo 4 (code review, BAJO): salto de reloj hacia atrás', () => {
    /** Interpreta el WHERE real generado por `construirAdquirirLease`: libre si `expira_at`
     * ya pasó O si está más allá de la cota de sanidad (`ahoraMs + COTA_SANIDAD_LEASE_MS`). */
    function simularAdquirirConCota(
      tabla: Map<string, { owner: string; expiraAt: number }>,
      id: string,
      token: string,
      ahoraMs: number,
      expiraAtMs: number,
    ): boolean {
      const fila = tabla.get(id);
      const libre = !fila || fila.expiraAt <= ahoraMs || fila.expiraAt > ahoraMs + COTA_SANIDAD_LEASE_MS;
      if (libre) {
        tabla.set(id, { owner: token, expiraAt: expiraAtMs });
        return true;
      }
      return false;
    }

    it('un lease vigente (expira_at razonable) NO se libera de más bajo reloj estable', () => {
      const tabla = new Map<string, { owner: string; expiraAt: number }>();
      // Adquirido en t=0 con el TTL real del lease (60s) — expira_at = 60_000.
      simularAdquirirConCota(tabla, 'drenaje-outbox', 'contexto-vivo', 0, TTL_LEASE_DRENAJE_MS);

      // 5s después, reloj estable: el lease sigue legítimamente tomado.
      expect(simularAdquirirConCota(tabla, 'drenaje-outbox', 'otro-contexto', 5_000, 999)).toBe(false);
      expect(tabla.get('drenaje-outbox')?.owner).toBe('contexto-vivo');
    });

    it('el reloj del teléfono salta hacia atrás más de la cota → el lease "del futuro" se libera solo', () => {
      const tabla = new Map<string, { owner: string; expiraAt: number }>();
      // El teléfono tenía el reloj ADELANTADO: adquiere el lease con `ahoraMs` ya corrido
      // 10 minutos hacia adelante respecto del reloj real — expira_at queda "en el futuro"
      // también respecto del reloj real, mucho más allá del TTL legítimo (60s).
      const relojAdelantadoMs = 10 * 60_000;
      simularAdquirirConCota(
        tabla,
        'drenaje-outbox',
        'contexto-con-reloj-adelantado',
        relojAdelantadoMs,
        relojAdelantadoMs + TTL_LEASE_DRENAJE_MS,
      );

      // El reloj se corrige (NTP, o el chofer lo ajusta) y salta hacia atrás a t=0 real — sin
      // el fix, `expira_at` (~10min + 60s en el futuro) seguiría "tomado" ~10 minutos enteros.
      // Con la cota (TTL + 60s = 120s), un `expira_at` tan lejos en el futuro es imposible bajo
      // un reloj estable — se trata como libre.
      expect(simularAdquirirConCota(tabla, 'drenaje-outbox', 'contexto-nuevo', 0, TTL_LEASE_DRENAJE_MS)).toBe(
        true,
      );
      expect(tabla.get('drenaje-outbox')?.owner).toBe('contexto-nuevo');
    });

    it('un salto de reloj hacia atrás CHICO (dentro de la cota) sigue respetando el lease vigente', () => {
      const tabla = new Map<string, { owner: string; expiraAt: number }>();
      // Reloj apenas adelantado (30s) al adquirir — dentro del margen que un TTL legítimo ya
      // explica, no debe tratarse como corrupto.
      const relojLevementeAdelantadoMs = 30_000;
      simularAdquirirConCota(
        tabla,
        'drenaje-outbox',
        'contexto-vivo',
        relojLevementeAdelantadoMs,
        relojLevementeAdelantadoMs + TTL_LEASE_DRENAJE_MS,
      );

      // Reloj corregido a t=0: expira_at (90_000) sigue dentro de la cota de sanidad
      // (0 + 120_000) — un lease legítimo recién adquirido no debe liberarse de más.
      expect(simularAdquirirConCota(tabla, 'drenaje-outbox', 'otro-contexto', 0, TTL_LEASE_DRENAJE_MS)).toBe(
        false,
      );
      expect(tabla.get('drenaje-outbox')?.owner).toBe('contexto-vivo');
    });
  });
});

describe('construirLiberarLeaseConCooldown (Entrega 2 — piso de 10s / backoff)', () => {
  it('genera el UPDATE condicionado por owner = token (solo el dueño legítimo libera)', () => {
    const { sql, params } = construirLiberarLeaseConCooldown(
      'drenaje-outbox',
      'token-1',
      5_000,
      10_000,
    );
    expect(sql).toBe('UPDATE sync_lease SET expira_at = ? WHERE id = ? AND owner = ?');
    expect(params).toEqual([15_000, 'drenaje-outbox', 'token-1']);
  });

  it('una liberación tardía (token viejo) no debe pisar el lease de un nuevo dueño', () => {
    const tabla = new Map<string, { owner: string; expiraAt: number }>([
      ['drenaje-outbox', { owner: 'contexto-nuevo', expiraAt: 999_999 }],
    ]);
    // Simula `UPDATE ... WHERE id = ? AND owner = ?`: el token viejo ya no matchea el owner
    // actual, así que la liberación no debe tener efecto.
    const fila = tabla.get('drenaje-outbox');
    const afecta = fila?.owner === 'contexto-viejo';
    if (afecta) tabla.set('drenaje-outbox', { owner: 'contexto-viejo', expiraAt: 10_000 });

    expect(afecta).toBe(false);
    expect(tabla.get('drenaje-outbox')).toEqual({ owner: 'contexto-nuevo', expiraAt: 999_999 });
  });
});

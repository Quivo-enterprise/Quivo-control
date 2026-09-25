import { describe, expect, it, vi } from 'vitest';

// `outbox.ts` importa `expo-sqlite`/`expo-crypto`/`@sentry/react-native` a nivel de módulo
// (para tipos y para las funciones que SÍ tocan SQLite/Sentry) — ninguna de las tres se
// invoca desde las funciones puras que este archivo prueba (`construirRevertirAPendiente`,
// `construirAdquirirLease`, `construirLiberarLeaseConCooldown`, solo arman `{sql, params}`),
// pero igual rompen la carga del módulo bajo vitest/Node si no se mockean: son wrappers de
// módulos nativos que arrastran `react-native` transitivamente (mismo motivo documentado en
// `gps/headless-task.test.ts` y `db/paquete-dia-local.ts`). A diferencia de esos archivos,
// ACÁ no se mockea `./outbox` en sí — es justo el módulo real bajo prueba.
vi.mock('expo-sqlite', () => ({}));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn() }));
vi.mock('@sentry/react-native', () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

import {
  COTA_SANIDAD_LEASE_MS,
  construirAdquirirLease,
  construirLiberarLeaseConCooldown,
  construirRecuperarEnviadosHuerfanos,
  construirRevertirAPendiente,
  TTL_LEASE_DRENAJE_MS,
  type EstadoOutbox,
} from './outbox';

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

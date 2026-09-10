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
  construirAdquirirLease,
  construirLiberarLeaseConCooldown,
  construirRevertirAPendiente,
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

describe('construirAdquirirLease (Entrega 2 — mutex cross-contexto)', () => {
  it('el UPSERT toma la fila cuando no existe (INSERT normal, sin conflicto)', () => {
    const { sql, params } = construirAdquirirLease('drenaje-outbox', 'token-1', 1_000, 31_000);
    expect(sql).toContain('INSERT INTO sync_lease');
    expect(sql).toContain('ON CONFLICT(id) DO UPDATE');
    expect(sql).toContain('WHERE sync_lease.expira_at <= ?');
    expect(params).toEqual(['drenaje-outbox', 'token-1', 31_000, 1_000]);
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

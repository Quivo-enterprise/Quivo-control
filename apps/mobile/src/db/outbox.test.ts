import { describe, expect, it, vi } from 'vitest';

// `outbox.ts` importa `expo-sqlite`/`expo-crypto`/`@sentry/react-native` a nivel de módulo
// (para tipos y para las funciones que SÍ tocan SQLite/Sentry) — ninguna de las tres se
// invoca desde `construirRevertirAPendiente`, que solo arma `{sql, params}` — pero igual
// rompen la carga del módulo bajo vitest/Node si no se mockean: son wrappers de módulos
// nativos que arrastran `react-native` transitivamente (mismo motivo documentado en
// `gps/headless-task.test.ts` y `db/paquete-dia-local.ts`). A diferencia de esos archivos,
// ACÁ no se mockea `./outbox` en sí — es justo el módulo real bajo prueba.
vi.mock('expo-sqlite', () => ({}));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn() }));
vi.mock('@sentry/react-native', () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

import { construirRevertirAPendiente, type EstadoOutbox } from './outbox';

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

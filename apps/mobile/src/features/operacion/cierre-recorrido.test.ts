import { describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/react-native', () => ({
  captureException: vi.fn(),
}));

import * as Sentry from '@sentry/react-native';
import { cerrarRecorridoEnOutbox } from './cierre-recorrido';
import { crearEstadoInicioRecorrido, reiniciarEstadoInicioRecorrido } from './inicio-recorrido-retry';

/**
 * REDISEÑO iniciar()/detener() (2026-09-25): `detener()` ya no espera a un `iniciar()` en
 * curso — el cierre real del recorrido (respaldo de `inicio_recorrido` + `fin_recorrido`) corre
 * en segundo plano, fuera del camino crítico de la UI. Estos tests cubren esa función pura, sin
 * SQLite ni React (mismo criterio que `inicio-recorrido-retry.test.ts`).
 */

function fakeDb() {
  return { esFake: true } as const;
}

function crearDependencias(overrides: Partial<Parameters<typeof cerrarRecorridoEnOutbox>[1]> = {}) {
  return {
    abrirOutbox: vi.fn(async () => fakeDb()),
    encolarEvento: vi.fn(async (_db: unknown, evento: { eventId: string }) => ({
      eventId: evento.eventId,
      insertado: true,
    })),
    generarEventId: vi.fn(async () => 'event-fin-generado'),
    ...overrides,
  };
}

describe('cerrarRecorridoEnOutbox', () => {
  it('encola el respaldo de inicio_recorrido ANTES que fin_recorrido, en ese orden', async () => {
    const orden: string[] = [];
    const estado = crearEstadoInicioRecorrido();
    reiniciarEstadoInicioRecorrido(estado, 'event-inicio', '2026-09-25T10:00:00.000Z');

    const deps = crearDependencias({
      encolarEvento: vi.fn(async (_db, evento) => {
        orden.push(evento.tipo);
        return { eventId: evento.eventId, insertado: true };
      }),
    });

    await cerrarRecorridoEnOutbox(
      estado,
      deps,
      { deviceId: 'device-1', sesionId: 'sesion-1' },
      '2026-09-25T10:05:00.000Z',
    );

    expect(orden).toEqual(['inicio_recorrido', 'fin_recorrido']);
  });

  it('fin_recorrido se encola con el ts (tsFin) pasado por el llamador, no con la hora del INSERT', async () => {
    const estado = crearEstadoInicioRecorrido();
    reiniciarEstadoInicioRecorrido(estado, 'event-inicio', '2026-09-25T10:00:00.000Z');
    const tsFin = '2026-09-25T10:00:05.000Z';

    // `encolarEvento` demorado a propósito (simula un INSERT tardío contra SQLite) — el `ts`
    // que finalmente se persiste tiene que seguir siendo el capturado por el llamador ANTES de
    // esta demora, nunca uno recalculado en el momento en que el INSERT por fin corre.
    let resolverDemora!: () => void;
    const demora = new Promise<void>((resolve) => {
      resolverDemora = resolve;
    });
    const encolarEvento = vi.fn(async (_db, evento) => {
      if (evento.tipo === 'fin_recorrido') await demora;
      return { eventId: evento.eventId, insertado: true };
    });
    const deps = crearDependencias({ encolarEvento });

    const promesa = cerrarRecorridoEnOutbox(estado, deps, { deviceId: 'device-1', sesionId: 'sesion-1' }, tsFin);
    await Promise.resolve();
    await Promise.resolve();
    resolverDemora();
    await promesa;

    expect(encolarEvento).toHaveBeenCalledWith(
      fakeDb(),
      expect.objectContaining({ tipo: 'fin_recorrido', ts: tsFin }),
    );
  });

  it('usa un eventId de fin_recorrido generado una sola vez (no uno por cada llamada a encolarEvento)', async () => {
    const estado = crearEstadoInicioRecorrido();
    reiniciarEstadoInicioRecorrido(estado, 'event-inicio', 'ts-1');
    const deps = crearDependencias();

    const resultado = await cerrarRecorridoEnOutbox(
      estado,
      deps,
      { deviceId: 'device-1', sesionId: 'sesion-1' },
      'ts-fin',
    );

    expect(deps.generarEventId).toHaveBeenCalledTimes(1);
    expect(resultado.eventIdFin).toBe('event-fin-generado');
    expect(deps.encolarEvento).toHaveBeenCalledWith(
      fakeDb(),
      expect.objectContaining({ tipo: 'fin_recorrido', eventId: 'event-fin-generado' }),
    );
  });

  it('eventId null (camino de re-enganche): no escribe inicio_recorrido, pero sí encola fin_recorrido', async () => {
    const estado = crearEstadoInicioRecorrido(); // eventId: null
    const deps = crearDependencias();

    await cerrarRecorridoEnOutbox(estado, deps, { deviceId: 'device-1', sesionId: 'sesion-1' }, 'ts-fin');

    expect(deps.encolarEvento).toHaveBeenCalledTimes(1);
    expect(deps.encolarEvento).toHaveBeenCalledWith(
      fakeDb(),
      expect.objectContaining({ tipo: 'fin_recorrido' }),
    );
  });

  // B (hallazgo de revisión 3, 2026-09-25): antes, un respaldo de inicio_recorrido que rechazaba
  // cortaba la función entera y `fin_recorrido` nunca se encolaba — un recorrido sin forma de
  // cerrar solo porque el respaldo (que además puede ser puramente redundante, si `onLocation`/
  // heartbeat ya lo confirmaron) falló. Ahora ese fallo se reporta a Sentry y NO impide el paso
  // 2: `fin_recorrido` se escribe SIEMPRE.
  it('si el respaldo de inicio_recorrido rechaza: se reporta a Sentry y de todos modos encola fin_recorrido', async () => {
    const estado = crearEstadoInicioRecorrido();
    reiniciarEstadoInicioRecorrido(estado, 'event-inicio', 'ts-1');
    const errorRespaldo = new Error('SQLite sin espacio');
    const encolarEvento = vi.fn(async (_db, evento) => {
      if (evento.tipo === 'inicio_recorrido') throw errorRespaldo;
      return { eventId: evento.eventId, insertado: true };
    });
    const deps = crearDependencias({ encolarEvento });

    const resultado = await cerrarRecorridoEnOutbox(
      estado,
      deps,
      { deviceId: 'device-1', sesionId: 'sesion-1' },
      'ts-fin',
    );

    expect(resultado.eventIdFin).toBe('event-fin-generado');
    expect(encolarEvento).toHaveBeenCalledTimes(2);
    expect(encolarEvento).toHaveBeenCalledWith(
      fakeDb(),
      expect.objectContaining({ tipo: 'fin_recorrido', ts: 'ts-fin' }),
    );
    expect(Sentry.captureException).toHaveBeenCalledWith(
      errorRespaldo,
      expect.objectContaining({
        tags: expect.objectContaining({ paso: 'cierre-respaldo-inicio-recorrido' }),
      }),
    );
  });
});

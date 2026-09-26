import { describe, expect, it, vi } from 'vitest';
import {
  asegurarInicioRecorrido,
  crearEstadoInicioRecorrido,
  reiniciarEstadoInicioRecorrido,
  type EstadoInicioRecorrido,
} from './inicio-recorrido-retry';

/**
 * LOW-MED (hallazgo de revisión, QUI-247): si escribir `inicio_recorrido` fallaba dentro de
 * `iniciar()`, `tracking` quedaba en `true` pero nada volvía a intentar escribir el marcador —
 * un recorrido con `fin_recorrido` pero sin `inicio_recorrido` rompe la reconstrucción. Estos
 * tests cubren la parte pura del reintento: sin SQLite ni `expo-crypto` real, con
 * `abrirOutbox`/`encolarEvento` como fakes en memoria (mismo criterio que
 * `seguimiento-continuo.test.ts` con `SdkSeguimientoContinuo`).
 */

function fakeDb() {
  return { esFake: true } as const;
}

describe('crearEstadoInicioRecorrido / reiniciarEstadoInicioRecorrido', () => {
  it('estado inicial: eventId null, no confirmado, ts null', () => {
    expect(crearEstadoInicioRecorrido()).toEqual({ eventId: null, confirmado: false, ts: null });
  });

  it('reiniciar asigna el eventId, el ts y resetea confirmado, incluso si ya estaba confirmado', () => {
    const estado: EstadoInicioRecorrido = { eventId: 'viejo', confirmado: true, ts: 'ts-viejo' };
    reiniciarEstadoInicioRecorrido(estado, 'nuevo-event-id', 'ts-nuevo');
    expect(estado).toEqual({ eventId: 'nuevo-event-id', confirmado: false, ts: 'ts-nuevo' });
  });

  // H2 (hallazgo de revisión, 2026-09-25): el `ts` capturado al arrancar el intento tiene que
  // sobrevivir intacto hasta el `encolarEvento` real, sin importar cuándo se ejecute la
  // escritura — es la garantía que cierra la carrera con `fin_recorrido` documentada en
  // `EstadoInicioRecorrido.ts`.
  it('el ts capturado al arrancar es anterior a un ts de escritura simulado más tardío', () => {
    const estado = crearEstadoInicioRecorrido();
    reiniciarEstadoInicioRecorrido(estado, 'event-1', '2026-09-25T10:00:00.000Z');
    const tsFinSimulado = '2026-09-25T10:00:11.000Z'; // p. ej. tras 10s+ de timeout en detener()
    expect(Date.parse(estado.ts as string)).toBeLessThan(Date.parse(tsFinSimulado));
  });
});

describe('asegurarInicioRecorrido', () => {
  it('eventId null (camino de re-enganche, QUI-247): no toca el outbox — no debe escribir un inicio_recorrido nuevo', async () => {
    const estado = crearEstadoInicioRecorrido();
    const abrirOutbox = vi.fn(async () => fakeDb());
    const encolarEvento = vi.fn(async () => ({ eventId: 'x', insertado: true }));

    await asegurarInicioRecorrido(
      estado,
      { abrirOutbox, encolarEvento },
      { deviceId: 'device-1', sesionId: 'sesion-1' },
    );

    expect(abrirOutbox).not.toHaveBeenCalled();
    expect(encolarEvento).not.toHaveBeenCalled();
    expect(estado.confirmado).toBe(false);
  });

  it('ya confirmado: es un no-op, no vuelve a tocar el outbox (guarda barata para reintentos repetidos)', async () => {
    const estado: EstadoInicioRecorrido = { eventId: 'event-1', confirmado: true, ts: 'ts-1' };
    const abrirOutbox = vi.fn(async () => fakeDb());
    const encolarEvento = vi.fn(async () => ({ eventId: 'event-1', insertado: true }));

    await asegurarInicioRecorrido(
      estado,
      { abrirOutbox, encolarEvento },
      { deviceId: 'device-1', sesionId: 'sesion-1' },
    );

    expect(abrirOutbox).not.toHaveBeenCalled();
    expect(encolarEvento).not.toHaveBeenCalled();
  });

  it('primer intento con éxito: escribe inicio_recorrido con el eventId estable, el ts capturado y marca confirmado', async () => {
    const estado: EstadoInicioRecorrido = {
      eventId: 'event-estable',
      confirmado: false,
      ts: '2026-09-25T10:00:00.000Z',
    };
    const abrirOutbox = vi.fn(async () => fakeDb());
    const encolarEvento = vi.fn(async () => ({ eventId: 'event-estable', insertado: true }));

    await asegurarInicioRecorrido(
      estado,
      { abrirOutbox, encolarEvento },
      { deviceId: 'device-1', sesionId: 'sesion-1' },
    );

    expect(encolarEvento).toHaveBeenCalledTimes(1);
    expect(encolarEvento).toHaveBeenCalledWith(fakeDb(), {
      deviceId: 'device-1',
      tipo: 'inicio_recorrido',
      payload: { sesionId: 'sesion-1' },
      eventId: 'event-estable',
      ts: '2026-09-25T10:00:00.000Z',
    });
    expect(estado.confirmado).toBe(true);
  });

  it('el intento falla: propaga el error, NO marca confirmado (el llamador puede reintentar)', async () => {
    const estado: EstadoInicioRecorrido = { eventId: 'event-1', confirmado: false, ts: 'ts-1' };
    const abrirOutbox = vi.fn(async () => fakeDb());
    const encolarEvento = vi.fn(async () => {
      throw new Error('SQLite sin espacio');
    });

    await expect(
      asegurarInicioRecorrido(
        estado,
        { abrirOutbox, encolarEvento },
        { deviceId: 'device-1', sesionId: 'sesion-1' },
      ),
    ).rejects.toThrow('SQLite sin espacio');

    expect(estado.confirmado).toBe(false);
  });

  // EL CASO REAL del hallazgo: `iniciar()` falla al escribir el marcador, pero un reintento
  // posterior (`onLocation`, heartbeat o `detener()`) sí lo logra — usando el MISMO eventId en
  // los dos intentos (idempotencia vía `INSERT OR IGNORE` en `db/outbox.ts`).
  it('reintento tras un fallo: usa el MISMO eventId que el intento anterior y termina confirmado', async () => {
    const estado: EstadoInicioRecorrido = {
      eventId: 'event-estable',
      confirmado: false,
      ts: 'ts-1',
    };
    const abrirOutbox = vi.fn(async () => fakeDb());
    const encolarEvento = vi
      .fn()
      .mockRejectedValueOnce(new Error('handle zombi'))
      .mockResolvedValueOnce({ eventId: 'event-estable', insertado: true });

    await expect(
      asegurarInicioRecorrido(
        estado,
        { abrirOutbox, encolarEvento },
        { deviceId: 'device-1', sesionId: 'sesion-1' },
      ),
    ).rejects.toThrow('handle zombi');
    expect(estado.confirmado).toBe(false);

    // Reintento (mismo objeto de estado, mismo eventId — nunca se regenera entre reintentos).
    await asegurarInicioRecorrido(
      estado,
      { abrirOutbox, encolarEvento },
      { deviceId: 'device-1', sesionId: 'sesion-1' },
    );

    expect(estado.confirmado).toBe(true);
    expect(encolarEvento).toHaveBeenCalledTimes(2);
    expect(encolarEvento.mock.calls[0]?.[1].eventId).toBe('event-estable');
    expect(encolarEvento.mock.calls[1]?.[1].eventId).toBe('event-estable');
  });

  // Punto 6 (rediseño iniciar()/detener(), 2026-09-25): con `detener()` ya no esperando a un
  // `iniciar()` en curso, un intento invalidado puede seguir colgado en este `await
  // encolarEvento` mientras un `iniciar()` NUEVO ya reinició `estado` para el recorrido
  // siguiente. El intento viejo, al resolver tarde, NO debe marcar `confirmado = true` — eso
  // pisaría el estado "sin confirmar" del recorrido nuevo.
  it('confirmado no se pisa si el eventId cambió mientras encolarEvento estaba en vuelo (intento invalidado que resuelve tarde)', async () => {
    const estado: EstadoInicioRecorrido = {
      eventId: 'event-viejo',
      confirmado: false,
      ts: 'ts-viejo',
    };
    const abrirOutbox = vi.fn(async () => fakeDb());
    // Mientras este `encolarEvento` está "en vuelo", el recorrido nuevo ya reinició `estado`.
    const encolarEvento = vi.fn(async () => {
      reiniciarEstadoInicioRecorrido(estado, 'event-nuevo', 'ts-nuevo');
      return { eventId: 'event-viejo', insertado: true };
    });

    await asegurarInicioRecorrido(
      estado,
      { abrirOutbox, encolarEvento },
      { deviceId: 'device-1', sesionId: 'sesion-1' },
    );

    // El evento del intento viejo SÍ se escribió (el `encolarEvento` corrió con su eventId),
    // pero `estado` ya no le pertenece — no debe quedar `confirmado`.
    expect(encolarEvento).toHaveBeenCalledWith(fakeDb(), expect.objectContaining({ eventId: 'event-viejo' }));
    expect(estado.eventId).toBe('event-nuevo');
    expect(estado.confirmado).toBe(false);
  });

  it('reiniciar para un recorrido NUEVO usa un eventId (y ts) distinto al del recorrido anterior', () => {
    const estado = crearEstadoInicioRecorrido();
    reiniciarEstadoInicioRecorrido(estado, 'recorrido-1', 'ts-1');
    estado.confirmado = true;

    reiniciarEstadoInicioRecorrido(estado, 'recorrido-2', 'ts-2');

    expect(estado.eventId).toBe('recorrido-2');
    expect(estado.ts).toBe('ts-2');
    expect(estado.confirmado).toBe(false);
  });
});

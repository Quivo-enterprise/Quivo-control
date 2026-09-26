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
  it('estado inicial: eventId null, no confirmado', () => {
    expect(crearEstadoInicioRecorrido()).toEqual({ eventId: null, confirmado: false });
  });

  it('reiniciar asigna el eventId y resetea confirmado, incluso si ya estaba confirmado', () => {
    const estado: EstadoInicioRecorrido = { eventId: 'viejo', confirmado: true };
    reiniciarEstadoInicioRecorrido(estado, 'nuevo-event-id');
    expect(estado).toEqual({ eventId: 'nuevo-event-id', confirmado: false });
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
    const estado: EstadoInicioRecorrido = { eventId: 'event-1', confirmado: true };
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

  it('primer intento con éxito: escribe inicio_recorrido con el eventId estable y marca confirmado', async () => {
    const estado: EstadoInicioRecorrido = { eventId: 'event-estable', confirmado: false };
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
    });
    expect(estado.confirmado).toBe(true);
  });

  it('el intento falla: propaga el error, NO marca confirmado (el llamador puede reintentar)', async () => {
    const estado: EstadoInicioRecorrido = { eventId: 'event-1', confirmado: false };
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
    const estado: EstadoInicioRecorrido = { eventId: 'event-estable', confirmado: false };
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

  it('reiniciar para un recorrido NUEVO usa un eventId distinto al del recorrido anterior', () => {
    const estado = crearEstadoInicioRecorrido();
    reiniciarEstadoInicioRecorrido(estado, 'recorrido-1');
    estado.confirmado = true;

    reiniciarEstadoInicioRecorrido(estado, 'recorrido-2');

    expect(estado.eventId).toBe('recorrido-2');
    expect(estado.confirmado).toBe(false);
  });
});

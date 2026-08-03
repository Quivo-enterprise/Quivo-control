import { BadRequestException } from '@nestjs/common';
import type { EventoSync } from '@quivo/shared';
import { describe, expect, it, vi } from 'vitest';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';
import type { SyncQueueService } from './sync-queue.service.js';
import { SyncController } from './sync.controller.js';

function evento(overrides: Partial<EventoSync> = {}): EventoSync {
  return {
    eventId: '018e6e6a-0000-7000-8000-000000000000',
    deviceId: 'device-1',
    ts: new Date().toISOString(),
    tipo: 'gps_point',
    payload: { lat: -17.78, lng: -63.18 },
    ...overrides,
  };
}

const sesion: SesionMovilAutenticada = {
  sesionId: 's-1',
  sindicatoId: 'sind-1',
  asignacionId: 'asig-1',
  vehiculoId: 'veh-1',
  conductorId: 'cond-1',
  deviceId: 'device-1',
};

describe('SyncController', () => {
  it('encola el lote con el tenant/dispositivo de la sesión y acusa todos los event_id', async () => {
    const encolarLote = vi.fn().mockResolvedValue(undefined);
    const controller = new SyncController({ encolarLote } as unknown as SyncQueueService);
    const eventos = [evento()];

    const respuesta = await controller.recibirLote({ eventos }, sesion);

    expect(encolarLote).toHaveBeenCalledWith({
      sindicatoId: 'sind-1',
      deviceId: 'device-1',
      eventos,
    });
    expect(respuesta.aceptados).toEqual([eventos[0]!.eventId]);
  });

  it('rechaza el lote completo si algún evento no es del dispositivo de la sesión', async () => {
    const encolarLote = vi.fn();
    const controller = new SyncController({ encolarLote } as unknown as SyncQueueService);

    await expect(
      controller.recibirLote({ eventos: [evento({ deviceId: 'otro-device' })] }, sesion),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(encolarLote).not.toHaveBeenCalled();
  });
});

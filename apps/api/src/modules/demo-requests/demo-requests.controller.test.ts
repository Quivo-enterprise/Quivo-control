import { describe, expect, it, vi } from 'vitest';
import { DemoRequestsController } from './demo-requests.controller.js';
import type { DemoRequestsService } from './demo-requests.service.js';

describe('DemoRequestsController', () => {
  it('delega la solicitud pública al servicio', async () => {
    const create = vi.fn().mockResolvedValue({
      ok: true,
      message: 'mensaje',
      whatsappUrl: 'https://wa.me/59168482323?text=mensaje',
    });
    const controller = new DemoRequestsController({ create } as unknown as DemoRequestsService);
    const body = {
      name: 'Jairo',
      line: 'Sindicato del 120',
      city: 'Cochabamba',
      lineCount: 1,
      website: '',
    };

    await expect(controller.create(body as never)).resolves.toEqual({
      ok: true,
      message: 'mensaje',
      whatsappUrl: 'https://wa.me/59168482323?text=mensaje',
    });
    expect(create).toHaveBeenCalledWith(body);
  });
});

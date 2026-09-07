import { describe, expect, it, vi } from 'vitest';
import { PublicMobilityController } from './public-mobility.controller.js';
import type { PublicMobilityService } from './public-mobility.service.js';

describe('PublicMobilityController', () => {
  it('delega GET /public/mobility/lines con el query ya parseado, sin requerir contexto administrativo', async () => {
    const listarLineas = vi.fn().mockResolvedValue([]);
    const controller = new PublicMobilityController({ listarLineas } as unknown as PublicMobilityService);

    const query = { cityId: 'cochabamba', limit: 50 };
    await expect(controller.listarLineas(query)).resolves.toEqual([]);
    expect(listarLineas).toHaveBeenCalledWith(query);
    expect(listarLineas).toHaveBeenCalledOnce();
  });
});

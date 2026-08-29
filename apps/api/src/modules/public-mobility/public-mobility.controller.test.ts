import { describe, expect, it, vi } from 'vitest';
import { PublicMobilityController } from './public-mobility.controller.js';
import type { JourneyService } from './journey.service.js';
import type { PublicMobilityService } from './public-mobility.service.js';

describe('PublicMobilityController', () => {
  it('delega la búsqueda de líneas sin requerir contexto administrativo', async () => {
    const listarLineas = vi.fn().mockResolvedValue({ items: [] });
    const controller = new PublicMobilityController(
      { listarLineas } as unknown as PublicMobilityService,
      { buscarViajes: vi.fn() } as unknown as JourneyService,
    );

    await expect(controller.listarLineas('120', '12', 'cochabamba')).resolves.toEqual({ items: [] });
    expect(listarLineas).toHaveBeenCalledWith('120', '12', 'cochabamba');
  });

  it('expone el catálogo de ciudades', async () => {
    const listarCiudades = vi.fn().mockResolvedValue({ items: [] });
    const controller = new PublicMobilityController(
      { listarCiudades } as unknown as PublicMobilityService,
      { buscarViajes: vi.fn() } as unknown as JourneyService,
    );

    await expect(controller.listarCiudades()).resolves.toEqual({ items: [] });
    expect(listarCiudades).toHaveBeenCalledOnce();
  });

  it('delega los recursos públicos por id', async () => {
    const obtenerLinea = vi.fn().mockResolvedValue({ id: 'linea-1' });
    const obtenerRuta = vi.fn().mockResolvedValue({ id: 'ruta-1' });
    const obtenerParada = vi.fn().mockResolvedValue({ id: 'parada-1' });
    const listarParadas = vi.fn().mockResolvedValue({ items: [{ id: 'parada-1' }] });
    const resolverQrVehiculo = vi.fn().mockResolvedValue({ lineId: 'linea-1' });
    const controller = new PublicMobilityController({
      obtenerLinea,
      obtenerRuta,
      obtenerParada,
      listarParadas,
      resolverQrVehiculo,
    } as unknown as PublicMobilityService, { buscarViajes: vi.fn() } as unknown as JourneyService);

    await expect(controller.obtenerLinea('linea-1', 'cochabamba')).resolves.toEqual({ id: 'linea-1' });
    await expect(controller.obtenerRuta('ruta-1', 'cochabamba')).resolves.toEqual({ id: 'ruta-1' });
    await expect(controller.obtenerParada('parada-1', 'cochabamba')).resolves.toEqual({ id: 'parada-1' });
    await expect(controller.listarParadas('plaza', '10', 'cochabamba')).resolves.toEqual({ items: [{ id: 'parada-1' }] });
    expect(listarParadas).toHaveBeenCalledWith('plaza', '10', 'cochabamba');
    await expect(controller.resolverQrVehiculo('opaque-token')).resolves.toEqual({ lineId: 'linea-1' });
    expect(resolverQrVehiculo).toHaveBeenCalledWith('opaque-token');
  });
});

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageService } from '../storage/storage.service.js';

const orden: string[] = [];
const tx = {
  sesionOperativa: { findUnique: vi.fn() },
  vehiculo: { update: vi.fn(), findUnique: vi.fn() },
  $queryRaw: vi.fn(),
};
vi.mock('@quivo/db', () => ({
  withTenantContext: vi.fn(async (_c: unknown, fn: (t: typeof tx) => unknown) => {
    orden.push('tx:begin');
    const r = await fn(tx);
    orden.push('tx:commit');
    return r;
  }),
}));

const { VehiculoFotoService } = await import('./vehiculo-foto.service.js');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const sesion = {
  sesionId: 's1',
  sindicatoId: 'sin1',
  asignacionId: 'a1',
  vehiculoId: 'CLIENTE-NO-USAR',
  conductorId: 'c1',
  deviceId: 'd1',
};
const body = (buf: Buffer, contentType: 'image/jpeg' | 'image/webp' = 'image/jpeg') => ({
  imagenBase64: buf.toString('base64'),
  contentType,
});

describe('VehiculoFotoService', () => {
  const storage = { subir: vi.fn(), borrar: vi.fn() };
  const service = new VehiculoFotoService(storage as unknown as StorageService);

  beforeEach(() => {
    orden.length = 0;
    vi.clearAllMocks();
    tx.sesionOperativa.findUnique.mockResolvedValue({ vehiculoId: 'veh-sesion', estado: 'activa', revokedAt: null });
    tx.$queryRaw.mockImplementation(async () => {
      orden.push('lock');
      return [{ fotoUrl: 'https://x/vehiculos/vieja.jpg' }];
    });
    tx.vehiculo.update.mockImplementation(async () => {
      orden.push('update');
    });
    storage.subir.mockImplementation(async () => {
      orden.push('subir');
      return { url: 'https://x/vehiculos/nueva.jpg', objeto: 'vehiculos/nueva.jpg' };
    });
    storage.borrar.mockImplementation(async (u: string) => {
      orden.push(`borrar:${u}`);
    });
  });

  it('rechaza más de 2 MB decodificados', async () => {
    const grande = Buffer.concat([JPEG, Buffer.alloc(2 * 1024 * 1024)]);
    await expect(service.subirDesdeMovil(sesion, body(grande))).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.subir).not.toHaveBeenCalled();
  });

  it('rechaza firma que no coincide con el contentType', async () => {
    await expect(service.subirDesdeMovil(sesion, body(JPEG, 'image/webp'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(storage.subir).not.toHaveBeenCalled();
  });

  it('409 si la sesión no está activa', async () => {
    tx.sesionOperativa.findUnique.mockResolvedValue({ vehiculoId: 'v', estado: 'cerrada', revokedAt: null });
    await expect(service.subirDesdeMovil(sesion, body(JPEG))).rejects.toBeInstanceOf(ConflictException);
    // Nunca se llegó al lock ni al UPDATE: el objeto subido se limpia.
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.vehiculo.update).not.toHaveBeenCalled();
    expect(storage.borrar).toHaveBeenCalledWith('vehiculos/nueva.jpg');
  });

  it('valida la sesión y bloquea el vehículo en UNA sola transacción', async () => {
    const { withTenantContext } = await import('@quivo/db');
    await service.subirDesdeMovil(sesion, body(JPEG));
    expect(withTenantContext).toHaveBeenCalledTimes(1);
    expect(orden.indexOf('lock')).toBeGreaterThan(orden.indexOf('tx:begin'));
    expect(orden.filter((o) => o === 'tx:begin')).toHaveLength(1);
  });

  it('usa el vehículo de la sesión en base y borra la foto previa recién tras el commit', async () => {
    const r = await service.subirDesdeMovil(sesion, body(JPEG));
    expect(r.fotoUrl).toBe('https://x/vehiculos/nueva.jpg');
    expect(tx.vehiculo.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'veh-sesion' } }),
    );
    const i = (k: string) => orden.indexOf(k);
    // lock (FOR UPDATE) antes del update; borrado de la previa después del commit.
    expect(i('lock')).toBeLessThan(i('update'));
    expect(orden.lastIndexOf('tx:commit')).toBeLessThan(i('borrar:https://x/vehiculos/vieja.jpg'));
    expect(storage.borrar).toHaveBeenCalledTimes(1);
  });

  it('borra exactamente la URL que leyó bajo lock (subidas concurrentes serializadas)', async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([{ fotoUrl: 'A' }])
      .mockResolvedValueOnce([{ fotoUrl: 'B' }]);
    storage.subir
      .mockResolvedValueOnce({ url: 'B', objeto: 'vehiculos/b.jpg' })
      .mockResolvedValueOnce({ url: 'C', objeto: 'vehiculos/c.jpg' });
    await service.subirDesdeMovil(sesion, body(JPEG));
    await service.subirDesdeMovil(sesion, body(JPEG));
    expect(storage.borrar.mock.calls.map((c) => c[0])).toEqual(['A', 'B']);
  });

  it('si el update falla y la fila no apunta al objeto nuevo, lo borra (no la foto previa)', async () => {
    tx.vehiculo.update.mockRejectedValue(new Error('db'));
    tx.vehiculo.findUnique.mockResolvedValue({ fotoUrl: 'https://x/vehiculos/vieja.jpg' });
    await expect(service.subirDesdeMovil(sesion, body(JPEG))).rejects.toThrow('db');
    expect(storage.borrar).toHaveBeenCalledTimes(1);
    expect(storage.borrar).toHaveBeenCalledWith('vehiculos/nueva.jpg');
  });

  it('si el error llega con el COMMIT ya aplicado (la fila apunta al objeto nuevo) NO lo borra', async () => {
    tx.vehiculo.update.mockRejectedValue(new Error('conexión cortada al confirmar'));
    tx.vehiculo.findUnique.mockResolvedValue({ fotoUrl: 'https://x/vehiculos/nueva.jpg' });
    await expect(service.subirDesdeMovil(sesion, body(JPEG))).rejects.toThrow('conexión');
    expect(storage.borrar).not.toHaveBeenCalled();
  });

  it('si la relectura también falla NO borra (un huérfano es mejor que un puntero roto)', async () => {
    tx.vehiculo.update.mockRejectedValue(new Error('db'));
    tx.vehiculo.findUnique.mockRejectedValue(new Error('db caída'));
    await expect(service.subirDesdeMovil(sesion, body(JPEG))).rejects.toThrow('db');
    expect(storage.borrar).not.toHaveBeenCalled();
  });

  it('quitar sin foto: 404, sin UPDATE ni borrado', async () => {
    tx.$queryRaw.mockResolvedValue([{ fotoUrl: null }]);
    await expect(
      service.quitar({ userId: 'u', rol: 'admin_quivo', sindicatoId: null }, 'veh1'),
    ).rejects.toThrow(new NotFoundException('El vehículo no tiene foto'));
    expect(tx.vehiculo.update).not.toHaveBeenCalled();
    expect(storage.borrar).not.toHaveBeenCalled();
  });

  it('quitar: lock, update y borrado de la URL reemplazada después del commit', async () => {
    tx.vehiculo.update.mockImplementation(async () => {
      orden.push('update');
      return null;
    });
    await expect(
      service.quitar({ userId: 'u', rol: 'admin_quivo', sindicatoId: null }, 'veh1'),
    ).rejects.toBeDefined(); // toVehiculo(null) falla tras el commit; el orden es lo que se verifica
    const i = (k: string) => orden.indexOf(k);
    expect(i('lock')).toBeLessThan(i('update'));
    expect(i('tx:commit')).toBeLessThan(i('borrar:https://x/vehiculos/vieja.jpg'));
  });
});

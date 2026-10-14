import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { StorageService } from '../storage/storage.service.js';
import { MediaService } from './media.service.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function crear() {
  const subir = vi.fn().mockResolvedValue({ url: 'https://storage.googleapis.com/b/lineas/x.png', objeto: 'lineas/x.png' });
  return { subir, service: new MediaService({ subir } as unknown as StorageService) };
}

describe('MediaService logos', () => {
  it('delega el guardado en StorageService con prefijo lineas', async () => {
    const { subir, service } = crear();
    const r = await service.guardarLogoLinea({
      mimeType: 'image/png',
      contenido: `data:image/png;base64,${PNG.toString('base64')}`,
    });
    expect(r.url).toBe('https://storage.googleapis.com/b/lineas/x.png');
    expect(subir).toHaveBeenCalledWith({ buffer: PNG, contentType: 'image/png', prefijo: 'lineas' });
  });

  it('rechaza firma que no coincide, prefijo incorrecto y tamaño excesivo', async () => {
    const { subir, service } = crear();
    await expect(
      service.guardarLogoLinea({
        mimeType: 'image/jpeg',
        contenido: `data:image/jpeg;base64,${PNG.toString('base64')}`,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.guardarLogoLinea({ mimeType: 'image/png', contenido: 'data:image/jpeg;base64,AAAA' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const grande = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
    await expect(
      service.guardarLogoLinea({
        mimeType: 'image/png',
        contenido: `data:image/png;base64,${grande.toString('base64')}`,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(subir).not.toHaveBeenCalled();
  });
});

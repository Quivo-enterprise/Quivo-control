import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StorageService } from '../storage/storage.service.js';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MIME_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const;
export type SupportedMimeType = keyof typeof MIME_TYPES;

export interface UploadLineaLogo {
  mimeType: SupportedMimeType;
  contenido: string;
}

@Injectable()
export class MediaService {
  private readonly mediaDirectory = fileURLToPath(new URL('../../../media/', import.meta.url));

  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  /** `url` es absoluta con GCS y relativa (`/v1/media/lineas/...`) con el driver de disco. */
  async guardarLogoLinea(upload: UploadLineaLogo): Promise<{ url: string }> {
    const prefix = `data:${upload.mimeType};base64,`;
    if (!upload.contenido.startsWith(prefix))
      throw new BadRequestException('El contenido no coincide con el tipo de imagen.');
    const data = Buffer.from(upload.contenido.slice(prefix.length), 'base64');
    if (
      data.length === 0 ||
      data.length > MAX_LOGO_BYTES ||
      !coincideFirma(data, upload.mimeType)
    ) {
      throw new BadRequestException('Sube una imagen PNG, JPG o WebP válida de hasta 2 MB.');
    }
    const { url } = await this.storage.subir({
      buffer: data,
      contentType: upload.mimeType,
      prefijo: 'lineas',
    });
    return { url };
  }

  /** Sirve archivos del driver de disco (dev) y los logos ya guardados antes de GCS. */
  obtenerArchivoLocal(
    carpeta: 'lineas' | 'vehiculos',
    filename: string,
  ): { path: string; mimeType: SupportedMimeType } {
    if (!/^[a-z0-9][a-z0-9-]*\.(png|jpe?g|webp)$/i.test(filename))
      throw new NotFoundException('Imagen no encontrada.');
    const path = join(this.mediaDirectory, carpeta, filename);
    if (!existsSync(path)) throw new NotFoundException('Imagen no encontrada.');
    const extension = filename.split('.').pop()?.toLowerCase();
    return {
      path,
      mimeType:
        extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg',
    };
  }
}

export function coincideFirma(data: Buffer, mimeType: SupportedMimeType): boolean {
  if (mimeType === 'image/png')
    return data
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === 'image/jpeg') return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  return (
    data.subarray(0, 4).toString('ascii') === 'RIFF' &&
    data.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}

import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { createReadStream } from 'node:fs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { MediaService, type UploadLineaLogo } from './media.service.js';

class UploadLineaLogoDto extends createZodDto(
  z.object({
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    contenido: z.string().min(1).max(2_800_000),
  }),
) {}

@Controller('media')
export class MediaController {
  constructor(@Inject(MediaService) private readonly mediaService: MediaService) {}

  /**
   * Sirve archivos del driver de disco (dev) y los logos guardados antes de GCS; en producción
   * las fotos se leen directo del bucket. `carpeta` se valida contra una lista cerrada.
   */
  @Get(':carpeta/:filename')
  obtenerImagen(
    @Param('carpeta') carpeta: string,
    @Param('filename') filename: string,
    @Res() reply: FastifyReply,
  ) {
    const imagen = this.mediaService.obtenerArchivoLocal(carpeta, filename);
    reply
      .header('Cache-Control', 'public, max-age=86400')
      .type(imagen.mimeType)
      .send(createReadStream(imagen.path));
  }

  @Post('lineas/logo')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin_quivo', 'admin_sindicato', 'operador')
  async subirLogo(
    @CurrentUser() _actor: AuthenticatedUser,
    @Body() body: UploadLineaLogoDto,
    @Req() request: FastifyRequest,
  ) {
    const { url } = await this.mediaService.guardarLogoLinea(body as UploadLineaLogo);
    // Absoluta (GCS o `MEDIA_PUBLIC_BASE_URL`): tal cual. Relativa: sin base configurada, se
    // deriva del request como antes.
    if (/^https?:\/\//i.test(url)) return { url };
    const forwarded = request.headers['x-forwarded-proto'];
    const protocol = typeof forwarded === 'string' ? forwarded.split(',')[0] : request.protocol;
    return { url: `${protocol}://${request.headers.host}${url}` };
  }
}

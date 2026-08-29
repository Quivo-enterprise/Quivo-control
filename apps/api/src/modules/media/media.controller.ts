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

  @Get('lineas/:filename')
  obtenerLogo(@Param('filename') filename: string, @Res() reply: FastifyReply) {
    const logo = this.mediaService.obtenerLogoLinea(filename);
    reply
      .header('Cache-Control', 'public, max-age=86400')
      .type(logo.mimeType)
      .send(createReadStream(logo.path));
  }

  @Post('lineas/logo')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin_quivo', 'admin_sindicato', 'operador')
  subirLogo(
    @CurrentUser() _actor: AuthenticatedUser,
    @Body() body: UploadLineaLogoDto,
    @Req() request: FastifyRequest,
  ) {
    const { filename } = this.mediaService.guardarLogoLinea(body as UploadLineaLogo);
    const forwarded = request.headers['x-forwarded-proto'];
    const protocol = typeof forwarded === 'string' ? forwarded.split(',')[0] : request.protocol;
    return { url: `${protocol}://${request.headers.host}/v1/media/lineas/${filename}` };
  }
}

import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { AuthMovilGuard } from '../auth-movil/auth-movil.guard.js';
import { CurrentMobileSession } from '../auth-movil/current-mobile-session.decorator.js';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';
import { PaqueteDiaService } from './paquete-dia.service.js';

@Controller('mobile')
export class PaqueteDiaController {
  constructor(@Inject(PaqueteDiaService) private readonly paqueteDiaService: PaqueteDiaService) {}

  @Get('asignacion-del-dia')
  @UseGuards(AuthMovilGuard)
  obtener(@CurrentMobileSession() sesion: SesionMovilAutenticada) {
    return this.paqueteDiaService.obtenerPaqueteDelDia(sesion);
  }
}

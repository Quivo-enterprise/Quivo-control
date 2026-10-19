import { Controller, Get, Inject } from '@nestjs/common';
import { CurrentMobileSession } from '../auth-movil/current-mobile-session.decorator.js';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';
import { LimitePorDispositivo } from '../auth-movil/limite-por-dispositivo.decorator.js';
import { PaqueteDiaService } from './paquete-dia.service.js';

@Controller('mobile')
export class PaqueteDiaController {
  constructor(@Inject(PaqueteDiaService) private readonly paqueteDiaService: PaqueteDiaService) {}

  @Get('asignacion-del-dia')
  @LimitePorDispositivo(10)
  obtener(@CurrentMobileSession() sesion: SesionMovilAutenticada) {
    return this.paqueteDiaService.obtenerPaqueteDelDia(sesion);
  }
}

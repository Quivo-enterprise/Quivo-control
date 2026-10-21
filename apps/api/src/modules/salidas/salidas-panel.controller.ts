import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  BaseFrecuenciaSchema,
  CrearFrecuenciaReglaSchema,
  type BaseFrecuencia,
  type CrearFrecuenciaRegla,
} from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { Auditable } from '../../common/audit/audit.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { FilaService } from './fila.service.js';
import { FrecuenciasService } from './frecuencias.service.js';

class CrearFrecuenciaReglaDto extends createZodDto(CrearFrecuenciaReglaSchema) {}
class BaseFrecuenciaDto extends createZodDto(BaseFrecuenciaSchema) {}

/**
 * Panel de la fila de salida de una terminal. Roles (decisión del CTO, 20/10): admin y control
 * (`operador`) manejan la fila y las frecuencias. Toda ruta valida que la terminal sea de una
 * línea del sindicato del usuario (404 si no). Los GET son de poll (panel cada 5 s): sin
 * `@Auditable`, y el tope por IP se sube como en `reportes/en-vivo` (varios operadores por NAT).
 */
@Controller('salidas/:puntoControlId')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_quivo', 'admin_sindicato', 'operador')
@Throttle({ default: { limit: 600, ttl: 60_000 } })
export class SalidasPanelController {
  constructor(
    @Inject(FilaService) private readonly filaService: FilaService,
    @Inject(FrecuenciasService) private readonly frecuenciasService: FrecuenciasService,
  ) {}

  @Get('fila')
  fila(@CurrentUser() actor: AuthenticatedUser, @Param('puntoControlId') pcId: string) {
    return this.filaService.estadoPanel(actor, pcId);
  }

  @Post('fila/:filaId/despachar')
  @HttpCode(200)
  @Auditable('fila_salida', 'despachar')
  despachar(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('puntoControlId') pcId: string,
    @Param('filaId') filaId: string,
  ) {
    return this.filaService.despachar(actor, pcId, filaId);
  }

  @Post('fila/:filaId/mover-al-final')
  @HttpCode(200)
  @Auditable('fila_salida', 'mover_al_final')
  moverAlFinal(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('puntoControlId') pcId: string,
    @Param('filaId') filaId: string,
  ) {
    return this.filaService.moverAlFinal(actor, pcId, filaId);
  }

  @Post('fila/:filaId/retirar')
  @HttpCode(200)
  @Auditable('fila_salida', 'retirar')
  retirar(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('puntoControlId') pcId: string,
    @Param('filaId') filaId: string,
  ) {
    return this.filaService.retirar(actor, pcId, filaId);
  }

  @Get('reglas')
  reglas(@CurrentUser() actor: AuthenticatedUser, @Param('puntoControlId') pcId: string) {
    return this.frecuenciasService.listar(actor, pcId);
  }

  @Post('reglas')
  @Auditable('frecuencia_regla')
  crearRegla(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('puntoControlId') pcId: string,
    @Body() body: CrearFrecuenciaReglaDto,
  ) {
    return this.frecuenciasService.crear(actor, pcId, body as CrearFrecuenciaRegla);
  }

  @Delete('reglas/:reglaId')
  @Auditable('frecuencia_regla')
  anularRegla(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('puntoControlId') pcId: string,
    @Param('reglaId') reglaId: string,
  ) {
    return this.frecuenciasService.anular(actor, pcId, reglaId);
  }

  @Put('base')
  @Auditable('punto_control', 'fijar_frecuencia_base')
  fijarBase(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('puntoControlId') pcId: string,
    @Body() body: BaseFrecuenciaDto,
  ) {
    return this.frecuenciasService.fijarBase(actor, pcId, body as BaseFrecuencia);
  }
}

import { Body, Controller, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  ActualizarSindicatoSchema,
  CrearSindicatoSchema,
  type ActualizarSindicato,
  type CrearSindicato,
} from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { Auditable } from '../../common/audit/audit.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { SindicatosService } from './sindicatos.service.js';

class CrearSindicatoDto extends createZodDto(CrearSindicatoSchema) {}
class ActualizarSindicatoDto extends createZodDto(ActualizarSindicatoSchema) {}

/** RF-01..04 — CRUD de sindicatos, solo `admin_quivo` (QUI-220): los sindicatos son el
 * tenant, no algo que un `admin_sindicato` pueda dar de alta o editar sobre sí mismo. */
@Controller('sindicatos')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_quivo')
export class SindicatosController {
  constructor(@Inject(SindicatosService) private readonly sindicatosService: SindicatosService) {}

  @Get()
  listar(@CurrentUser() actor: AuthenticatedUser) {
    return this.sindicatosService.listar(actor);
  }

  @Get(':id')
  obtener(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.sindicatosService.obtener(actor, id);
  }

  @Post()
  @Auditable('sindicato')
  crear(@CurrentUser() actor: AuthenticatedUser, @Body() body: CrearSindicatoDto) {
    // `body` ya pasó por ZodValidationPipe (CrearSindicatoSchema, con default de `estado`
    // aplicado) — el cast es solo porque `createZodDto` infiere el tipo de entrada del
    // schema (estado opcional), no el de salida (estado con default ya resuelto).
    return this.sindicatosService.crear(actor, body as CrearSindicato);
  }

  @Patch(':id')
  @Auditable('sindicato')
  actualizar(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: ActualizarSindicatoDto,
  ) {
    return this.sindicatosService.actualizar(actor, id, body as ActualizarSindicato);
  }
}

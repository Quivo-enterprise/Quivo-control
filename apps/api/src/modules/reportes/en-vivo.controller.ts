import { Body, Controller, Get, Inject, Param, Put, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  DesignarVueltaSchema,
  TrazaEnVivoQuerySchema,
  type DesignarVuelta,
  type TrazaEnVivoQuery,
} from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { Auditable } from '../../common/audit/audit.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { VueltasService } from '../vueltas/vueltas.service.js';
import { EnVivoUsuarioThrottlerGuard } from './en-vivo-usuario-throttler.guard.js';
import { EnVivoService } from './en-vivo.service.js';

class TrazaEnVivoQueryDto extends createZodDto(TrazaEnVivoQuerySchema) {}
class DesignarVueltaDto extends createZodDto(DesignarVueltaSchema) {}

/**
 * ENTREGA 3 — mapa en vivo `/en-vivo`. Solo lectura, misma pila de guards/roles que
 * `recorridos.controller.ts`.
 *
 * Rate limit propio de 600 req/min POR USUARIO (no por IP): el límite global
 * (`app.module.ts`, QUI-251) es 100 req/min/IP compartido con TODO el panel, y cada pestaña
 * de esta pantalla hace ~30 req/min de posiciones (poll de 2 s) + ~6 de traza (poll de 10 s;
 * más con `hayMas`). Por IP, varios operadores o pestañas detrás del mismo NAT se darían 429 entre
 * sí. El throttler global ('default', que corre ANTES de la auth y por eso solo puede
 * usar la IP) se sube acá a 1000/min/IP con `@Throttle({ default })`: sigue siendo el único
 * freno pre-auth (cada request inválida pega al JwtAuthGuard/jwks) pero holgado para NAT. Y `EnVivoUsuarioThrottlerGuard` —DESPUÉS de
 * `JwtAuthGuard`, cuando `req.user` ya existe— aplica el cupo por `userId`. Misma forma
 * que `DispositivoThrottlerGuard` en `POST /sync/batches`. El límite
 * por usuario (600/min, nombre 'usuario') vive SOLO en el constructor del guard, y su key es por
 * usuario en todo el controller (no por handler).
 *
 * Roles (decisión del CTO, 2026-10-13): `operador` (el control) ve el mapa en vivo —lista,
 * posiciones, contexto, traza y las infracciones de la sesión en SOLO LECTURA— y designa la vuelta
 * a Molinos. Atender/descartar/sancionar infracciones sigue siendo solo de los admins
 * (`InfraccionesController`, 403 para `operador`).
 *
 * Ninguno de estos GET lleva `@Auditable`: son endpoints de poll y el interceptor de
 * auditoría solo actúa sobre handlers decorados — si escribieran, serían ~500 filas
 * basura por hora en `audit_log`.
 */
@Controller('reportes/en-vivo')
@UseGuards(JwtAuthGuard, EnVivoUsuarioThrottlerGuard, RolesGuard)
@Roles('admin_quivo', 'admin_sindicato', 'operador')
@Throttle({ default: { limit: 1000, ttl: 60_000 } })
export class EnVivoController {
  constructor(
    @Inject(EnVivoService) private readonly enVivoService: EnVivoService,
    @Inject(VueltasService) private readonly vueltasService: VueltasService,
  ) {}

  @Get()
  listar(@CurrentUser() actor: AuthenticatedUser) {
    return this.enVivoService.listarHoy(actor);
  }

  /**
   * ENTREGA 10 — última posición conocida de TODOS los vehículos con sesión activa, en
   * una sola query (ver `EnVivoService.obtenerPosiciones`). Ruta declarada ANTES de
   * `:sesionId/contexto` en el código fuente por legibilidad, aunque no hay colisión
   * real: `posiciones` es un segmento literal de un solo nivel bajo `reportes/en-vivo`,
   * mientras que las rutas con `:sesionId` tienen dos segmentos — Nest las distingue por
   * forma, no por orden de declaración.
   */
  @Get('posiciones')
  posicionesTodas(@CurrentUser() actor: AuthenticatedUser) {
    return this.enVivoService.obtenerPosiciones(actor);
  }

  /** Resumen de Molinos por línea (HUD + sugerencia de envío). Ver `VueltasService.resumenMolinos`. */
  @Get('molinos')
  molinos(@CurrentUser() actor: AuthenticatedUser) {
    return this.vueltasService.resumenMolinos(actor);
  }

  /**
   * Designa (o cancela con `varianteId: null`) la vuelta en curso de la sesión a una variante
   * con punto de espera (Molinos). 409 si no hay vuelta en curso o ya llegó al punto de espera.
   * Lleva `@Auditable`: cada cambio queda en el log (entidad `vuelta`, el `id` de la respuesta).
   */
  @Put(':sesionId/vuelta-actual/designacion')
  @Auditable('vuelta', 'designar')
  designar(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('sesionId') sesionId: string,
    @Body() body: DesignarVueltaDto,
  ) {
    return this.vueltasService.designar(actor, sesionId, (body as DesignarVuelta).varianteId);
  }

  @Get(':sesionId/contexto')
  contexto(@CurrentUser() actor: AuthenticatedUser, @Param('sesionId') sesionId: string) {
    return this.enVivoService.obtenerContexto(actor, sesionId);
  }

  /** docs/plan-en-vivo-alertas.md PR A — infracciones de la sesión (abiertas primero). */
  @Get(':sesionId/infracciones')
  infracciones(@CurrentUser() actor: AuthenticatedUser, @Param('sesionId') sesionId: string) {
    return this.enVivoService.listarInfraccionesSesion(actor, sesionId);
  }

  @Get(':sesionId/posiciones')
  posiciones(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('sesionId') sesionId: string,
    @Query() query: TrazaEnVivoQueryDto,
  ) {
    return this.enVivoService.obtenerTraza(actor, sesionId, query as TrazaEnVivoQuery);
  }
}

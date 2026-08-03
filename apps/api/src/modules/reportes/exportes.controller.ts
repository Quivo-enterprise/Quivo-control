import { Controller, Get, Header, Inject, Query, StreamableFile, UseGuards } from '@nestjs/common';
import {
  ExportarActividadQuerySchema,
  ExportarRecorridosQuerySchema,
  ExportarSancionesQuerySchema,
  type ExportarActividadQuery,
  type ExportarRecorridosQuery,
  type ExportarSancionesQuery,
} from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard, type AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { crearCsvStream } from './csv.util.js';
import { ExportesService } from './exportes.service.js';

class ExportarRecorridosQueryDto extends createZodDto(ExportarRecorridosQuerySchema) {}
class ExportarSancionesQueryDto extends createZodDto(ExportarSancionesQuerySchema) {}
class ExportarActividadQueryDto extends createZodDto(ExportarActividadQuerySchema) {}

/** RF-78..80 (QUI-249) — reportes exportables en CSV, mismo patrón de roles que el resto de
 * `reportes`. Ver `exportes.service.ts` para el porqué de paginar en transacciones cortas. */
@Controller('reportes/exportar')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_quivo', 'admin_sindicato')
export class ExportesController {
  constructor(@Inject(ExportesService) private readonly exportesService: ExportesService) {}

  @Get('recorridos')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="recorridos.csv"')
  exportarRecorridos(@CurrentUser() actor: AuthenticatedUser, @Query() query: ExportarRecorridosQueryDto) {
    const q = query as ExportarRecorridosQuery;
    const stream = crearCsvStream(
      ['inicio', 'fin', 'linea', 'vehiculo', 'conductor', 'estado', 'puntosCumplidos', 'puntosTotales'],
      () => this.exportesService.recorridosPorPeriodo(actor, q),
    );
    return new StreamableFile(stream);
  }

  @Get('sanciones')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="sanciones.csv"')
  exportarSanciones(@CurrentUser() actor: AuthenticatedUser, @Query() query: ExportarSancionesQueryDto) {
    const q = query as ExportarSancionesQuery;
    const stream = crearCsvStream(
      ['fechaHecho', 'regla', 'sujetoTipo', 'sujetoId', 'motivo', 'estado'],
      () => this.exportesService.sancionesPorSujetoEstado(actor, q),
    );
    return new StreamableFile(stream);
  }

  @Get('actividad')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="actividad.csv"')
  exportarActividad(@CurrentUser() actor: AuthenticatedUser, @Query() query: ExportarActividadQueryDto) {
    const q = query as ExportarActividadQuery;
    const stream = crearCsvStream(
      ['id', 'nombre', 'recorridos', 'horasOperadas', 'puntosCumplidos', 'puntosTotales'],
      () => this.exportesService.actividadPorVehiculoConductor(actor, q),
    );
    return new StreamableFile(stream);
  }
}

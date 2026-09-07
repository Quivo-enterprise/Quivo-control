import { Controller, Get, Header, Inject, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { MobilityCityIdSchema } from '@quivo/shared';
import { z } from 'zod';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { PublicMobilityService } from './public-mobility.service.js';

/**
 * `limit` no lleva `.max(500)`: el contrato es "se topea en 500", no "se rechaza arriba de
 * 500" — el tope lo aplica el service (`parseLimite`). Acá sólo se exige entero positivo.
 */
const ListarLineasPublicasQuerySchema = z.object({
  cityId: MobilityCityIdSchema.optional(),
  since: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).optional(),
  afterId: z.string().uuid().optional(),
});

class ListarLineasPublicasDto extends createZodDto(ListarLineasPublicasQuerySchema) {}

/**
 * Catálogo de sincronización masiva para QUIVO Rutas (producto/repo aparte). Un único
 * endpoint — los siete que tenía el catálogo de lectura pública anterior (`cities`,
 * `lines/:id`, `routes/:id`, `stops`, `stops/:id`, `vehicles/:token`, `journeys/search`)
 * no vuelven: ese contrato era de la app de pasajeros, que ya no vive en este repo.
 *
 * Sin guarda de tenant — es intencional (mismo criterio que tenía el catálogo anterior):
 * la proyección Zod (`PublicLineDetailSchema`) es la única defensa, filtrando explícito
 * cada recurso por `publicStatus = 'publicado'` en cada nivel (línea/ruta/variante/parada).
 *
 * Ver el docstring de `PublicMobilityService` para la limitación de tombstones: una baja
 * no se informa, sólo deja de aparecer.
 */
@Controller('public/mobility')
export class PublicMobilityController {
  constructor(@Inject(PublicMobilityService) private readonly publicMobility: PublicMobilityService) {}

  @Get('lines')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Header('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')
  listarLineas(@Query() query: ListarLineasPublicasDto) {
    return this.publicMobility.listarLineas(query);
  }
}

import { Body, Controller, Get, Header, Inject, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JourneySearchRequestSchema, type JourneySearchRequest } from '@quivo/shared';
import { createZodDto } from '../../common/validation/zod-dto.js';
import { JourneyService } from './journey.service.js';
import { PublicMobilityService } from './public-mobility.service.js';

class JourneySearchDto extends createZodDto(JourneySearchRequestSchema) {}

/**
 * Catálogo de transporte apto para pasajeros. No usa guardas de tenant porque el servicio
 * filtra explícitamente cada recurso por `publicStatus = publicado` y proyecta DTOs públicos.
 */
@Controller('public/mobility')
export class PublicMobilityController {
  constructor(
    @Inject(PublicMobilityService) private readonly publicMobility: PublicMobilityService,
    @Inject(JourneyService) private readonly journeys: JourneyService,
  ) {}

  @Get('cities')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')
  listarCiudades() {
    return this.publicMobility.listarCiudades();
  }

  @Get('lines')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Header('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')
  listarLineas(@Query('q') query?: string, @Query('limit') limit?: string, @Query('cityId') cityId?: string) {
    return this.publicMobility.listarLineas(query, limit, cityId);
  }

  @Get('lines/:id')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Header('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')
  obtenerLinea(@Param('id') id: string, @Query('cityId') cityId?: string) {
    return this.publicMobility.obtenerLinea(id, cityId);
  }

  @Get('routes/:id')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Header('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')
  obtenerRuta(@Param('id') id: string, @Query('cityId') cityId?: string) {
    return this.publicMobility.obtenerRuta(id, cityId);
  }

  @Get('stops')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Header('Cache-Control', 'public, max-age=120, stale-while-revalidate=600')
  listarParadas(@Query('q') query?: string, @Query('limit') limit?: string, @Query('cityId') cityId?: string) {
    return this.publicMobility.listarParadas(query, limit, cityId);
  }

  @Get('stops/:id')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Header('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')
  obtenerParada(@Param('id') id: string, @Query('cityId') cityId?: string) {
    return this.publicMobility.obtenerParada(id, cityId);
  }

  @Get('vehicles/:token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  resolverQrVehiculo(@Param('token') token: string) {
    return this.publicMobility.resolverQrVehiculo(token);
  }

  @Post('journeys/search')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  buscarViajes(@Body() body: JourneySearchDto) {
    return this.journeys.buscarViajes(body as JourneySearchRequest);
  }
}

import { BadRequestException, Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { AuthMovilGuard } from '../auth-movil/auth-movil.guard.js';
import { RuteoService } from './ruteo.service.js';

@Controller('mobile')
export class RuteoController {
  constructor(@Inject(RuteoService) private readonly ruteoService: RuteoService) {}

  @Get('ruta-a-punto')
  @UseGuards(AuthMovilGuard)
  async obtener(
    @Query('origenLat') origenLat: string,
    @Query('origenLng') origenLng: string,
    @Query('destinoLat') destinoLat: string,
    @Query('destinoLng') destinoLng: string,
  ) {
    const oLat = Number(origenLat);
    const oLng = Number(origenLng);
    const dLat = Number(destinoLat);
    const dLng = Number(destinoLng);
    if ([oLat, oLng, dLat, dLng].some((valor) => Number.isNaN(valor))) {
      throw new BadRequestException('origenLat/origenLng/destinoLat/destinoLng deben ser números');
    }
    return this.ruteoService.rutaEntrePuntos({ lat: oLat, lng: oLng }, { lat: dLat, lng: dLng });
  }
}
